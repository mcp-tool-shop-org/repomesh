#!/usr/bin/env node
// Build-time stats for the Astro landing page.
// Reads registry JSON artifacts and writes site/src/stats.json.

import fs from "node:fs";
import path from "node:path";

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

// Anchor coverage — entries in releaseAnchors are anchored by virtue of existing
const anchoredCount = Object.keys(anchors.releaseAnchors || {}).length;
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
  latestRelease: latest ? {
    repo: latest.repo,
    version: latest.version,
    integrity: latest.integrityScore,
    assurance: latest.assuranceScore,
  } : null,
  generatedAt: new Date().toISOString(),
};

const outPath = path.join(ROOT, "site", "src", "stats.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(stats, null, 2));
console.log(`Stats built: ${nodes.length} nodes, ${repos.length} repos, ${totalReleases} releases, ${verifierCount} verifiers, ${anchors.partitions?.length || 0} partitions.`);
