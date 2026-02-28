// RepoMesh Verifier — SBOM fetcher + CycloneDX parser.
// Fetches SBOM from release event attestation URIs with retry.

import crypto from "node:crypto";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetries(url, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { "accept": "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(250 * (i + 1));
    }
  }
  throw lastErr;
}

export function findSbomUriFromReleaseEvent(releaseEvent) {
  const ats = Array.isArray(releaseEvent?.attestations) ? releaseEvent.attestations : [];
  const sb = ats.find(a => a?.type === "sbom");
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

export async function fetchCycloneDxComponents(sbomUri) {
  const data = await fetchWithRetries(sbomUri, { retries: 3 });

  // CycloneDX JSON: components[] at root
  const comps = Array.isArray(data?.components) ? data.components : [];
  return comps.map(c => ({
    name: c?.name || "",
    version: c?.version || "",
    purl: c?.purl || "",
    licenses: extractLicenses(c)
  }));
}

export function sha256Json(obj) {
  const s = JSON.stringify(obj);
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
