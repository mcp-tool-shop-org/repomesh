// FC5 — verify-all: batch-verify many releases against ONE ledger load.
//
//   repomesh verify-all (--manifest <file> | --from-registry)
//
// --manifest: a JSON array of {repo,version} (or a newline list of "org/repo@version").
// --from-registry: every release listed in registry/trust.json.
//
// Discipline: load the ledger EXACTLY ONCE, then reuse computeVerifyResult() per release with
// the preloaded events as a batch row. Aggregate; the process exit code is the WORST row per
// --fail-on. Output respects --format (text summary / json array / sarif merged / markdown table).
//
// ADDITIVE: each row's verdict is the identical Stage A computeVerifyResult() verdict — verify-all
// does not introduce any new trust logic, it only fans out + aggregates.
import fs from "node:fs";
import path from "node:path";
import { isRepoMeshCheckout } from "../mode.mjs";
import { fetchText } from "../http.mjs";
import { DEFAULT_LEDGER_URL, DEFAULT_TRUST_URL } from "../remote-defaults.mjs";
import { parseStrictJson } from "./safe-json.mjs";
import { computeVerifyResult } from "./verify-release.mjs";
import {
  exitCodeForStatus, normalizeFailOn, normalizeFormat,
  buildSarif, buildMarkdownBatch,
} from "./format.mjs";

const TRUST_FETCH_OPTS = { manualRedirect: true };

// Status precedence: ERROR is worst (a row couldn't even be evaluated), then FAIL, then
// UNVERIFIED, then PASS. The aggregate status is the worst row's status; the aggregate EXIT
// is derived from that aggregate status under --fail-on (so --fail-on=fail relaxes UNVERIFIED).
const STATUS_RANK = { PASS: 0, UNVERIFIED: 1, FAIL: 2, ERROR: 3 };
function worstStatus(statuses) {
  let worst = "PASS";
  for (const s of statuses) {
    if ((STATUS_RANK[s] ?? 3) > (STATUS_RANK[worst] ?? 0)) worst = s;
  }
  return worst;
}

function resolveLocal({ local, localDir }) {
  const explicitLocal = local === true || (localDir !== undefined && localDir !== null);
  const useLocal = explicitLocal ? true : isRepoMeshCheckout();
  const root = explicitLocal ? (localDir || process.cwd()) : process.cwd();
  return { useLocal, root };
}

function parseJsonlLines(lines) {
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { out.push(parseStrictJson(line)); } catch { /* skip malformed */ }
  }
  return out;
}

// Load the ledger events ONCE for the entire batch (local file or remote fetch).
async function loadEventsOnce({ useLocal, root, ledgerUrl }) {
  if (useLocal) {
    const p = path.join(root, "ledger", "events", "events.jsonl");
    if (!fs.existsSync(p)) return [];
    return parseJsonlLines(fs.readFileSync(p, "utf8").split("\n"));
  }
  const url = ledgerUrl || DEFAULT_LEDGER_URL;
  const text = await fetchText(url, TRUST_FETCH_OPTS);
  return parseJsonlLines(text.split("\n"));
}

// Parse a --manifest file: either a JSON array of {repo,version} or a newline list of org/repo@version.
function parseManifest(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const arr = parseStrictJson(trimmed);
    if (!Array.isArray(arr)) throw new Error("manifest must be a JSON array of {repo,version}");
    return arr.map(x => ({ repo: x.repo, version: x.version }));
  }
  // newline list
  const items = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const at = l.lastIndexOf("@");
    if (at <= 0) throw new Error(`manifest line not in 'org/repo@version' form: ${l}`);
    items.push({ repo: l.slice(0, at), version: l.slice(at + 1) });
  }
  return items;
}

// Resolve the release list (repo,version) from either --manifest or --from-registry.
async function resolveReleaseList(args, { useLocal, root }) {
  if (args.manifest) {
    const raw = fs.readFileSync(args.manifest, "utf8");
    return parseManifest(raw);
  }
  // --from-registry: read trust.json (local or remote) and extract release coordinates.
  let trust;
  if (useLocal) {
    const p = path.join(root, "registry", "trust.json");
    if (!fs.existsSync(p)) throw new Error(`registry/trust.json not found under ${root}`);
    trust = parseStrictJson(fs.readFileSync(p, "utf8"));
  } else {
    const url = args.trustUrl || DEFAULT_TRUST_URL;
    trust = parseStrictJson(await fetchText(url, TRUST_FETCH_OPTS));
  }
  return extractReleasesFromTrust(trust);
}

// trust.json may take several shapes. Support, in order:
//   1. a TOP-LEVEL array of release records [{repo,version,...}]  (the shape build-trust.mjs emits today)
//   2. a .releases[] array of {repo,version}                      (forward-compatible / FC9 query shape)
//   3. a per-repo map { repos: { "org/repo": { releases|versions|version } } }
// Each row reduces to {repo,version}; everything else is ignored. Read-only — verify-all never
// writes trust.json (that's Domain 3's build-trust.mjs).
function extractReleasesFromTrust(trust) {
  // 1. top-level array of release records.
  if (Array.isArray(trust)) {
    return trust.map(r => ({ repo: r.repo, version: r.version })).filter(r => r.repo && r.version);
  }
  // 2. { releases: [...] }
  if (Array.isArray(trust?.releases)) {
    return trust.releases.map(r => ({ repo: r.repo, version: r.version })).filter(r => r.repo && r.version);
  }
  // 3. per-repo map.
  const out = [];
  const repos = trust?.repos || {};
  for (const [repo, info] of Object.entries(repos)) {
    const versions = info?.releases || info?.versions || [];
    if (Array.isArray(versions)) {
      for (const v of versions) out.push({ repo, version: typeof v === "string" ? v : v.version });
    } else if (info?.version) {
      out.push({ repo, version: info.version });
    }
  }
  return out.filter(r => r.repo && r.version);
}

function emitText(rows, overall, failOn) {
  for (const row of rows) {
    const status = row?.gate?.status || (row?.ok ? "PASS" : (row?.error ? "ERROR" : "FAIL"));
    const first = (row?.gate?.failures || [])[0];
    const reason = status === "PASS" ? "ok" : (first?.reason || row?.error || "—");
    console.log(`  ${status.padEnd(11)} ${row.repo}@${row.version}${status === "PASS" ? "" : ` — ${reason}`}`);
  }
  console.log(`\n  verify-all: ${overall} (${rows.length} release${rows.length === 1 ? "" : "s"}, --fail-on=${failOn})`);
}

export async function verifyAll(args = {}) {
  const failOn = normalizeFailOn(args.failOn);
  const format = normalizeFormat({ format: args.format, json: args.json });
  const human = format === "text";

  if (!args.manifest && !args.fromRegistry) {
    if (human) console.error("Error: verify-all requires --manifest <file> or --from-registry");
    else console.log(JSON.stringify({ ok: false, error: "verify-all requires --manifest <file> or --from-registry" }, null, 2));
    process.exit(2);
  }

  const { useLocal, root } = resolveLocal(args);

  let releaseList;
  try {
    releaseList = await resolveReleaseList(args, { useLocal, root });
  } catch (e) {
    if (human) console.error(`Error: ${e.message}`);
    else console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
    process.exit(2);
  }

  if (!releaseList || releaseList.length === 0) {
    if (human) console.error("Error: no releases to verify (empty manifest/registry).");
    else console.log(JSON.stringify({ ok: false, error: "no releases to verify" }, null, 2));
    process.exit(2);
  }

  // Load the ledger ONCE for the whole batch.
  let events;
  try {
    events = await loadEventsOnce({ useLocal, root, ledgerUrl: args.ledgerUrl });
  } catch (e) {
    if (human) console.error(`Error loading ledger: ${e.message}`);
    else console.log(JSON.stringify({ ok: false, error: `ledger load failed: ${e.message}` }, null, 2));
    process.exit(2);
  }
  if (typeof args.onLedgerLoad === "function") args.onLedgerLoad(); // test hook: assert single load

  if (events.length === 0) {
    if (human) console.error("Error: No ledger events found.");
    else console.log(JSON.stringify({ ok: false, error: "No ledger events found." }, null, 2));
    process.exit(2);
  }

  // Fan out: reuse computeVerifyResult per release with the SAME preloaded events. Each row is
  // the identical Stage A verdict — never re-load, never re-derive trust.
  const rows = [];
  const statuses = [];
  for (const { repo, version } of releaseList) {
    const { result, status } = await computeVerifyResult({
      repo, version,
      anchored: args.anchored,
      anchoredOrLocal: args.anchoredOrLocal,
      local: useLocal, localDir: useLocal ? root : undefined,
      human: false, // batch rows never print progressive text
      preloadedEvents: events,
    });
    // Ensure a gate.status is present even on ERROR rows (release-not-found etc.) for aggregation.
    if (!result.gate) result.gate = { status, failures: result.error ? [{ check: "release", reason: result.error, hint: result.hint || "" }] : [] };
    rows.push(result);
    statuses.push(status);
  }

  const overall = worstStatus(statuses);
  const exitCode = exitCodeForStatus(overall, failOn);

  // Single emit path per --format.
  if (format === "json") {
    console.log(JSON.stringify({ ok: overall === "PASS", overall, failOn, releases: rows }, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(rows), null, 2)); // merged single run (FC5)
  } else if (format === "markdown") {
    console.log(buildMarkdownBatch(rows, overall));
  } else {
    emitText(rows, overall, failOn);
    if (overall === "UNVERIFIED" && failOn === "fail") {
      console.error("Warning: worst status is UNVERIFIED but --fail-on=fail treats the batch as success (exit 0).");
    }
  }

  process.exit(exitCode);
}
