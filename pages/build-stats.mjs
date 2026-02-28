#!/usr/bin/env node
// Build-time stats for the Astro landing page.
// Reads registry JSON artifacts and writes site/src/stats.json.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function readJSON(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const nodes = readJSON("registry/nodes.json") || [];
const trust = readJSON("registry/trust.json") || [];
const verifiers = readJSON("registry/verifiers.json") || { verifiers: [] };
const anchors = readJSON("registry/anchors.json") || { partitions: [], releaseAnchors: {} };

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
