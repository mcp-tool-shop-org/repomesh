#!/usr/bin/env node
// Build-time stats for the Astro landing page.
// Reads registry JSON artifacts and writes site/src/stats.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

// B-1: Safe JSON loading with try-catch and descriptive errors
function readJSON(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    console.error(`[stats] Warning: Failed to parse ${rel}: ${err.message}. Using default.`);
    return null;
  }
}

// SB-PAGES-01: coerce wrong-type artifacts (truncated/half-written JSON that parses but is
// the wrong top-level type) to safe defaults so the reductions/lengths below can't crash.
const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// STGB-SP-003 (Stage C honesty fix) — average a numeric trust field while excluding any
// missing/non-numeric score, so a single incomplete entry can't poison a headline stat with
// NaN. Mirrors build-metrics.mjs averageScore (same contract): sum/count only finite numbers,
// return 0 (not NaN) for an empty / all-missing set, tolerate a non-array argument.
export function averageScore(entries, field) {
  const list = Array.isArray(entries) ? entries : [];
  let sum = 0;
  let count = 0;
  for (const e of list) {
    const v = e?.[field];
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

// Guard a single score for display — a missing/non-numeric score renders as 0, never NaN/undefined.
const safeScore = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {

const nodes = asArray(readJSON("registry/nodes.json"));
const trust = asArray(readJSON("registry/trust.json"));
const verifiersRaw = asObject(readJSON("registry/verifiers.json"));
const verifiers = { verifiers: asArray(verifiersRaw.verifiers) };
const anchorsRaw = asObject(readJSON("registry/anchors.json"));
const anchors = { partitions: asArray(anchorsRaw.partitions), releaseAnchors: asObject(anchorsRaw.releaseAnchors) };

// Unique repos from trust entries
const repos = [...new Set(trust.map(t => t.repo))];

// Releases with 100/100 integrity
const perfectIntegrity = trust.filter(t => t.integrityScore === 100).length;

// STGB-SP-001 (Stage C honesty): a release is "anchored" only when its partition record carries
// a real on-chain txHash — NOT merely by existing in releaseAnchors. Counting bare membership
// advertised 100% anchor coverage while every txHash was null. Count only the on-chain ones.
const anchoredCount = Object.values(anchors.releaseAnchors || {}).filter(r => r && r.txHash).length;
const totalReleases = trust.length;

// Verifier count
const verifierCount = verifiers.verifiers?.length || 0;

// Latest release
const latest = trust.length > 0
  ? trust.reduce((a, b) => new Date(a.timestamp) > new Date(b.timestamp) ? a : b)
  : null;

const stats = {
  nodeCount: nodes.length,
  repoCount: repos.length,
  releaseCount: totalReleases,
  verifierCount,
  partitionCount: anchors.partitions?.length || 0,
  anchoredCount,
  anchorCoverage: totalReleases > 0 ? Math.round((anchoredCount / totalReleases) * 100) : 0,
  perfectIntegrity,
  // STGB-SP-003: NaN-guarded headline averages — a release missing a score is excluded.
  avgIntegrity: averageScore(trust, "integrityScore"),
  avgAssurance: averageScore(trust, "assuranceScore"),
  latestRelease: latest ? {
    repo: latest.repo,
    version: latest.version,
    integrity: safeScore(latest.integrityScore),
    assurance: safeScore(latest.assuranceScore),
  } : null,
  generatedAt: new Date().toISOString(),
};

const outPath = path.join(ROOT, "site", "src", "stats.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(stats, null, 2));
console.log(`Stats built: ${nodes.length} nodes, ${repos.length} repos, ${totalReleases} releases, ${verifierCount} verifiers, ${anchors.partitions?.length || 0} partitions.`);

} // end if (isMain)
