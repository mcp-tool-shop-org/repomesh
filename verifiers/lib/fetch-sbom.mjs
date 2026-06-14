// RepoMesh Verifier — SBOM fetcher + CycloneDX parser.
// Fetches SBOM from release event attestation URIs with retry.

import crypto from "node:crypto";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// STGB-VER-004: a hung SBOM URI must not stall the scan forever. Mirror osv.mjs's 10s per-attempt
// AbortSignal.timeout so each fetch attempt has a hard ceiling; on timeout the attempt rejects with
// an AbortError, retries exhaust, and fetchRawWithRetries throws — which the caller maps to an
// 'unscored' result (cannot certify on un-fetchable SBOM), never a silent hang or a clean pass.
const SBOM_FETCH_TIMEOUT_MS = 10000;

// Fetch the RAW bytes of the SBOM so the caller can bind trust to a committed digest (D6 / SEC-002).
// Returns { bytes: Buffer, sha256: hex }. We hash exactly what came off the wire — never a
// re-serialized object — so the digest matches what the publisher committed in the attestation.
async function fetchRawWithRetries(url, { retries = 3, timeoutMs = SBOM_FETCH_TIMEOUT_MS } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "accept": "application/json" },
        // STGB-VER-004: hard per-attempt timeout — a hung URI aborts instead of stalling forever.
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const ab = await res.arrayBuffer();
      const bytes = Buffer.from(ab);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      return { bytes, sha256 };
    } catch (e) {
      lastErr = e;
      await sleep(250 * (i + 1));
    }
  }
  throw lastErr;
}

// Locate the sbom attestation on a ReleasePublished event, returning the full object so
// callers can read the committed { uri, sha256 } (SEC-002 digest binding).
export function findSbomAttestation(releaseEvent) {
  const ats = Array.isArray(releaseEvent?.attestations) ? releaseEvent.attestations : [];
  return ats.find(a => a?.type === "sbom") || null;
}

export function findSbomUriFromReleaseEvent(releaseEvent) {
  const sb = findSbomAttestation(releaseEvent);
  return sb?.uri || null;
}

function normalizeLicenseToken(x) {
  if (!x) return null;
  if (typeof x === "string") return x.trim();
  if (typeof x === "object") {
    // CycloneDX variants:
    // {license:{id,name}}, {expression:"MIT OR Apache-2.0"}
    if (x.expression) return String(x.expression).trim();
    if (x.license?.id) return String(x.license.id).trim();
    if (x.license?.name) return String(x.license.name).trim();
    if (x.id) return String(x.id).trim();
    if (x.name) return String(x.name).trim();
  }
  return null;
}

function extractLicenses(component) {
  const out = [];
  const lic = component?.licenses;
  if (Array.isArray(lic)) {
    for (const item of lic) {
      const tok = normalizeLicenseToken(item);
      if (tok) out.push(tok);
      const inner = normalizeLicenseToken(item?.license);
      if (inner) out.push(inner);
    }
  }
  const expr = normalizeLicenseToken(component?.license);
  if (expr) out.push(expr);

  return [...new Set(out)].filter(Boolean);
}

function parseCycloneDxComponents(data) {
  // CycloneDX JSON: components[] at root
  const comps = Array.isArray(data?.components) ? data.components : [];
  return comps.map(c => ({
    name: c?.name || "",
    version: c?.version || "",
    purl: c?.purl || "",
    licenses: extractLicenses(c)
  }));
}

// SEC-002 / D6: fetch the SBOM, hash the RAW bytes, and bind trust to a committed digest.
// `expectedSha256` is the attestation's `sha256` field (may be undefined for grandfathered events).
// Returns { components, sha256, digestStatus }:
//   digestStatus.bound   — true only when expectedSha256 was present AND matched the fetched bytes.
//   digestStatus.reason  — machine-readable reason when NOT bound ("missing" | "mismatch").
// Callers MUST refuse to certify (warn/fail, no presence points) when digestStatus.bound is false.
export async function fetchCycloneDxComponentsBound(sbomUri, expectedSha256) {
  const { bytes, sha256 } = await fetchRawWithRetries(sbomUri, { retries: 3 });

  let data;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    const err = new Error(`SBOM is not valid JSON: ${e.message}`);
    err.code = "REPOMESH_SBOM_PARSE_ERROR";
    throw err;
  }

  const components = parseCycloneDxComponents(data);

  let digestStatus;
  if (!expectedSha256) {
    digestStatus = { bound: false, reason: "missing", expected: null, actual: sha256 };
  } else if (String(expectedSha256).toLowerCase() !== sha256.toLowerCase()) {
    digestStatus = { bound: false, reason: "mismatch", expected: expectedSha256, actual: sha256 };
  } else {
    digestStatus = { bound: true, reason: null, expected: expectedSha256, actual: sha256 };
  }

  return { components, sha256, digestStatus };
}

// Back-compat thin wrapper (returns components only). New code should use
// fetchCycloneDxComponentsBound so SBOM trust is bound to the committed digest.
export async function fetchCycloneDxComponents(sbomUri, expectedSha256) {
  const { components } = await fetchCycloneDxComponentsBound(sbomUri, expectedSha256);
  return components;
}

export function sha256Json(obj) {
  const s = JSON.stringify(obj);
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
