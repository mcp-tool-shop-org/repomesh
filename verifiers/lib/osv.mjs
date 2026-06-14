// RepoMesh Verifier — OSV.dev client + CVSS severity decoding (SEC-001, SEC-007, SEC-010).
//
// The original code queried /v1/querybatch, which returns only {id, modified} per vuln — no
// severity, no aliases. severityBucket() therefore always returned "unknown", "unknown" was never
// in the fail set, and security.scan could NEVER emit "fail" even for a critical CVE.
//
// Fix:
//   - Query /v1/query per package (full vuln objects with severity[] + aliases).
//   - Decode CVSS VECTOR strings to a base score (never Number(vector)), or read
//     database_specific.severity, to bucket each vuln.
//   - Treat an unknown/unscored vuln as FAILING (default policy) — absence of a severity is not
//     evidence of safety. Callers may downgrade to warn-with-zero-assurance, but never to pass.
//   - Match ignoreVulns against the UNION {id, ...aliases} (SEC-007), needing full vuln objects.
//   - Assert results align 1:1 with queries and carry the package name with every result (SEC-010).

import { OsvCache, osvCacheKey } from "./osv-cache.mjs";

// Re-export the cache surface so a future verifier-plugin (#7, FC11 forward-compat) imports the
// cache + key derivation from the same place it imports osvQueryAll.
export { OsvCache, osvCacheKey };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// FC11: 429 backoff knobs. Exponential base * 2^attempt, capped, used only when OSV does not send a
// Retry-After header. A present Retry-After (delta-seconds or HTTP-date) always wins.
const RATE_LIMIT_BASE_MS = 500;
const RATE_LIMIT_MAX_MS = 8000;

// Parse a Retry-After header value -> milliseconds, or null if absent/unparseable.
// Supports the two RFC 7231 forms: delta-seconds ("2") and an HTTP-date.
export function parseRetryAfterMs(value, now = Date.now()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "") return null;
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const when = Date.parse(s);
  if (!Number.isNaN(when)) return Math.max(0, when - now);
  return null;
}

// STGB-VER-005: pin the OSV endpoint behind a named constant + a documented response-shape note,
// and send an identifying User-Agent so OSV.dev can attribute (and, if needed, rate-limit) us
// distinctly rather than as anonymous traffic.
//
// OSV.dev /v1/query response shape (as of 2026-06, schema v1.6.x):
//   { vulns?: Array<{ id, modified, aliases?: string[], severity?: Array<{type, score}>,
//                     database_specific?: { severity?: string },
//                     affected?: Array<{ database_specific?: { severity?: string } }> }> }
// A missing `vulns` key means "no known vulnerabilities for this package@version" (treated as []).
// If OSV ever changes this shape, severityBucket()/osvQueryAll() degrade to 'unknown' buckets
// (which FAIL by default per SEC-001) rather than silently passing.
export const OSV_QUERY_ENDPOINT = "https://api.osv.dev/v1/query";
export const OSV_USER_AGENT = "repomesh-verifier/1.0 (+https://github.com/mcp-tool-shop-org/repomesh)";

// ---- CVSS vector decoding ----------------------------------------------------------------------

// CVSS v3.0 / v3.1 base-score metric weights.
const CVSS3 = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR_unchanged: { N: 0.85, L: 0.62, H: 0.27 },
  PR_changed: { N: 0.85, L: 0.68, H: 0.5 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0.0 },
  I: { H: 0.56, L: 0.22, N: 0.0 },
  A: { H: 0.56, L: 0.22, N: 0.0 },
};

function roundUp1(x) {
  // CVSS spec "Roundup": round up to one decimal place.
  const i = Math.round(x * 100000);
  if (i % 10000 === 0) return i / 100000;
  return (Math.floor(i / 10000) + 1) / 10;
}

function parseVectorMetrics(vector) {
  const out = {};
  for (const part of String(vector).split("/")) {
    const [k, v] = part.split(":");
    if (k && v) out[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  return out;
}

// Compute a CVSS v3.x base score from a vector string. Returns a number or null if undecodable.
export function cvss3BaseScore(vector) {
  const m = parseVectorMetrics(vector);
  const AV = CVSS3.AV[m.AV];
  const AC = CVSS3.AC[m.AC];
  const UI = CVSS3.UI[m.UI];
  const C = CVSS3.C[m.C];
  const I = CVSS3.I[m.I];
  const A = CVSS3.A[m.A];
  const scopeChanged = m.S === "C";
  const PR = (scopeChanged ? CVSS3.PR_changed : CVSS3.PR_unchanged)[m.PR];
  if ([AV, AC, UI, C, I, A, PR].some(x => x === undefined)) return null;

  const iss = 1 - (1 - C) * (1 - I) * (1 - A);
  let impact;
  if (scopeChanged) {
    impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  } else {
    impact = 6.42 * iss;
  }
  const exploitability = 8.22 * AV * AC * PR * UI;

  if (impact <= 0) return 0;
  let base;
  if (scopeChanged) {
    base = Math.min(1.08 * (impact + exploitability), 10);
  } else {
    base = Math.min(impact + exploitability, 10);
  }
  return roundUp1(base);
}

// Best-effort CVSS v2 base score from a vector. Returns a number or null.
export function cvss2BaseScore(vector) {
  const m = parseVectorMetrics(vector);
  const AV = { L: 0.395, A: 0.646, N: 1.0 }[m.AV];
  const AC = { H: 0.35, M: 0.61, L: 0.71 }[m.AC];
  const Au = { M: 0.45, S: 0.56, N: 0.704 }[m.AU];
  const C = { N: 0.0, P: 0.275, C: 0.66 }[m.C];
  const I = { N: 0.0, P: 0.275, C: 0.66 }[m.I];
  const A = { N: 0.0, P: 0.275, C: 0.66 }[m.A];
  if ([AV, AC, Au, C, I, A].some(x => x === undefined)) return null;
  const impact = 10.41 * (1 - (1 - C) * (1 - I) * (1 - A));
  const exploitability = 20 * AV * AC * Au;
  const fImpact = impact === 0 ? 0 : 1.176;
  const base = ((0.6 * impact) + (0.4 * exploitability) - 1.5) * fImpact;
  return Math.round(base * 10) / 10;
}

export function scoreToBucket(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return "unknown";
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "moderate";
  if (score > 0) return "low";
  return "low";
}

const SEVERITY_WORD_TO_BUCKET = {
  critical: "critical",
  high: "high",
  moderate: "moderate",
  medium: "moderate",
  low: "low",
};

// Decode the severity bucket for a full OSV vuln object.
// Prefers a numeric CVSS vector (severity[].type CVSS_V3 / CVSS_V2 with a vector string),
// then falls back to database_specific.severity (a word). Returns one of
// critical|high|moderate|low|unknown.
export function severityBucket(vuln) {
  const sev = Array.isArray(vuln?.severity) ? vuln.severity : [];
  // 1) CVSS vector strings (the authoritative source).
  for (const s of sev) {
    const type = String(s?.type || "").toUpperCase();
    const score = String(s?.score || "").trim();
    if (!score) continue;
    if (type.includes("CVSS_V3") || score.startsWith("CVSS:3")) {
      const n = cvss3BaseScore(score);
      const b = scoreToBucket(n);
      if (b !== "unknown") return b;
    } else if (type.includes("CVSS_V2")) {
      const n = cvss2BaseScore(score);
      const b = scoreToBucket(n);
      if (b !== "unknown") return b;
    }
  }
  // 2) database_specific.severity word (GHSA-style).
  const word = String(vuln?.database_specific?.severity || "").trim().toLowerCase();
  if (word && SEVERITY_WORD_TO_BUCKET[word]) return SEVERITY_WORD_TO_BUCKET[word];

  // 3) Ecosystem-specific severity (e.g. affected[].database_specific) — best effort.
  const affected = Array.isArray(vuln?.affected) ? vuln.affected : [];
  for (const a of affected) {
    const w = String(a?.database_specific?.severity || "").trim().toLowerCase();
    if (w && SEVERITY_WORD_TO_BUCKET[w]) return SEVERITY_WORD_TO_BUCKET[w];
  }

  return "unknown";
}

// STGB-VER-007: when a vuln buckets to "unknown", the operator needs to know WHY so they can decide
// whether to investigate or override. This returns { bucket, reason } where reason is a decodable
// human string naming the raw severity string(s) we could not parse (or noting their absence). For
// any non-unknown bucket the reason is null. Keeps severityBucket() pure for existing callers.
export function severityBucketWithReason(vuln) {
  const bucket = severityBucket(vuln);
  if (bucket !== "unknown") return { bucket, reason: null };

  const sev = Array.isArray(vuln?.severity) ? vuln.severity : [];
  const rawEntries = sev
    .map(s => {
      const type = String(s?.type || "").trim() || "(no type)";
      const score = String(s?.score || "").trim();
      return score ? `${type}=${score}` : null;
    })
    .filter(Boolean);

  const word = String(vuln?.database_specific?.severity || "").trim();
  if (rawEntries.length) {
    return {
      bucket,
      reason: `could not decode severity from ${rawEntries.length} entry(ies): ${rawEntries.join(", ")}`,
    };
  }
  if (word) {
    return { bucket, reason: `unrecognized database_specific.severity word: "${word}"` };
  }
  return { bucket, reason: "no severity[] vector and no database_specific.severity present" };
}

// SEC-007: the set of identifiers that can match an ignore entry = {id} ∪ aliases.
export function vulnIdentifiers(vuln) {
  const ids = new Set();
  if (vuln?.id) ids.add(String(vuln.id));
  for (const a of (Array.isArray(vuln?.aliases) ? vuln.aliases : [])) {
    if (a) ids.add(String(a));
  }
  return ids;
}

export function isIgnored(vuln, ignoreIdSet) {
  for (const id of vulnIdentifiers(vuln)) {
    if (ignoreIdSet.has(id)) return true;
  }
  return false;
}

// ---- OSV.dev queries ----------------------------------------------------------------------------

// FC11: 429 (rate-limit) gets a dedicated backoff path that HONORS Retry-After when OSV sends it,
// and otherwise backs off exponentially. Other transient errors keep the original linear retry.
// `sleepImpl` is injectable so tests can assert the backoff intervals without real wall-clock waits.
// `maxAttempts` defaults to 4 so a couple of 429s can clear before the package is declared a failure.
async function osvQueryOne(query, { fetchImpl = fetch, timeoutMs = 10000, sleepImpl = sleep, maxAttempts = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(OSV_QUERY_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "user-agent": OSV_USER_AGENT,
        },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        // Rate limited. Honor Retry-After if present; else exponential backoff (capped).
        const retryAfter = parseRetryAfterMs(res.headers?.get?.("retry-after"));
        const err = new Error("OSV HTTP 429 (rate limited)");
        if (attempt === maxAttempts - 1) throw err; // out of retries -> this package fails (isolated)
        const backoff = retryAfter != null
          ? retryAfter
          : Math.min(RATE_LIMIT_BASE_MS * Math.pow(2, attempt), RATE_LIMIT_MAX_MS);
        lastErr = err;
        await sleepImpl(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`OSV HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt === maxAttempts - 1) throw e;
      // Non-429 transient (network drop, timeout): keep the original linear backoff.
      await sleepImpl(300 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Query OSV /v1/query per package and return results aligned 1:1 with `queries`, each carrying the
// originating package name (SEC-010). Each result = { package, vulns: [...full vuln objects...] }.
//
// STGB-VER-002 (graceful degradation, real bug): a transient per-package error MUST NOT abort the
// whole scan and throw away criticals already found in OTHER packages. Each package query is wrapped
// in its own try/catch:
//   - on success  -> { package, vulns }
//   - on failure  -> { package, vulns: [], error: "<message>" } and the package name is recorded in
//                     the returned `failures` set so the caller can refuse to certify.
// The return is augmented with a non-enumerable-on-the-array contract: callers should read
// `result.results` and `result.failures` from the object form. For backward compatibility the
// returned value is still array-LIKE — existing callers that iterate the result get the per-package
// records — but the recommended shape is { results, failures }.
//
// CERTIFICATION RULE (Mike's unscored doctrine): if ANY package could not be scanned, the overall
// outcome is non-certifiable — the caller emits 'unscored' (0 assurance), never a clean pass. A
// partial scan that DID find criticals still surfaces those criticals (so the operator sees real
// danger) AND reports unscored (so a transient outage can't hide an unscanned package).
//
// FC11: the package queries are dispatched through a BOUNDED-CONCURRENCY pool (default 5) instead of
// a sequential for...of, and routed through an OsvCache keyed on (ecosystem,name,version). Effects:
//   - a coordinate queried twice (duplicate in one SBOM, or across releases sharing a `cache`) hits
//     the OSV network exactly once (idempotent);
//   - concurrent identical coordinates share one in-flight request (parallel-safe single-flight);
//   - a 429 backs off (Retry-After honored) inside osvQueryOne before the package is declared failed;
//   - per-package failure isolation is UNCHANGED: a failed coordinate is NOT cached, its slot gets
//     { vulns: [], error } and is recorded in `failures`, and sibling criticals survive.
// Output ordering is positional: results[i] always corresponds to queries[i] (SEC-010), regardless
// of which pool worker finished first.
//
// opts: { fetchImpl, timeoutMs, sleepImpl, maxAttempts, concurrency = 5, cache = new OsvCache() }
export async function osvQueryAll(queries, opts = {}) {
  const { concurrency = 5, cache = new OsvCache(), ...queryOpts } = opts;
  const results = new Array(queries.length);
  const failures = [];

  // Run one query (by index) through the cache; record success or an isolated per-package failure.
  const runIndex = async (i) => {
    const q = queries[i];
    const pkgName = q?.package?.name || null;
    try {
      // Cache by coordinate: identical (ecosystem,name,version) computes the OSV call once. A failed
      // compute is NOT cached (OsvCache drops it on rejection), so a transient error stays isolated
      // and retryable rather than poisoning the coordinate.
      const data = await cache.getOrCompute(osvCacheKey(q), () => osvQueryOne(q, queryOpts));
      const vulns = Array.isArray(data?.vulns) ? data.vulns : [];
      results[i] = { package: pkgName, vulns };
    } catch (e) {
      // Per-package failure: do NOT abort. Record an empty-vulns result tagged with the error so the
      // scan continues and criticals from sibling packages are preserved.
      const msg = String(e?.message || e);
      results[i] = { package: pkgName, vulns: [], error: msg };
      failures.push({ package: pkgName, error: msg });
    }
  };

  // Bounded pool: `concurrency` workers pull the next index off a shared cursor until exhausted.
  // bound >= 1; never spawn more workers than queries.
  const bound = Math.max(1, Math.min(concurrency, queries.length || 1));
  let cursor = 0;
  const worker = async () => {
    while (cursor < queries.length) {
      const i = cursor++;
      await runIndex(i);
    }
  };
  await Promise.all(Array.from({ length: bound }, () => worker()));

  // SEC-010: positional alignment must be exact — no silent drops, no holes.
  if (results.length !== queries.length || results.some(r => r === undefined)) {
    throw new Error(`OSV results length ${results.filter(Boolean).length} != queries length ${queries.length}`);
  }
  // Attach failures to the array for back-compat iteration; callers preferring the explicit shape
  // can also read osvQueryAllWithStatus().
  results.failures = failures;
  return results;
}

// Explicit-shape companion to osvQueryAll for callers that want to branch on degradation cleanly.
// Returns { results, failures } where failures is the list of { package, error } that could not be
// scanned. `failures.length > 0` ⇒ the overall scan is non-certifiable ('unscored').
export async function osvQueryAllWithStatus(queries, opts = {}) {
  const results = await osvQueryAll(queries, opts);
  const failures = results.failures || [];
  return { results, failures };
}
