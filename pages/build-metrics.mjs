#!/usr/bin/env node
// Build metrics history for dashboard sparklines and deltas.
// Reads current registry data + previous metrics.json (if exists) to track history.
// Output: registry/metrics.json

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const METRICS_PATH = path.join(ROOT, "registry", "metrics.json");

function readJSON(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const nodes = readJSON("registry/nodes.json") || [];
const trust = readJSON("registry/trust.json") || [];
const verifiers = readJSON("registry/verifiers.json") || { verifiers: [] };
const anchors = readJSON("registry/anchors.json") || { partitions: [], releaseAnchors: {} };

// Current snapshot
const repos = [...new Set(trust.map(t => t.repo))];
const anchoredCount = Object.keys(anchors.releaseAnchors || {}).length;
const anchorCoverage = trust.length > 0 ? Math.round((anchoredCount / trust.length) * 100) : 0;
const avgIntegrity = trust.length > 0 ? Math.round(trust.reduce((s, t) => s + t.integrityScore, 0) / trust.length) : 0;
const avgAssurance = trust.length > 0 ? Math.round(trust.reduce((s, t) => s + t.assuranceScore, 0) / trust.length) : 0;

const current = {
  ts: new Date().toISOString(),
  nodes: nodes.length,
  repos: repos.length,
  releases: trust.length,
  verifiers: verifiers.verifiers?.length || 0,
  partitions: anchors.partitions?.length || 0,
  anchored: anchoredCount,
  anchorCoverage,
  avgIntegrity,
  avgAssurance,
};

// Load existing metrics history (keep last 20 snapshots)
let metrics = { history: [] };
if (fs.existsSync(METRICS_PATH)) {
  try { metrics = JSON.parse(fs.readFileSync(METRICS_PATH, "utf8")); } catch { /* fresh start */ }
}

// Deduplicate: don't add if values haven't changed
const prev = metrics.history.length > 0 ? metrics.history[metrics.history.length - 1] : null;
const changed = !prev || Object.keys(current).some(k => k !== "ts" && current[k] !== prev[k]);

if (changed) {
  metrics.history.push(current);
}

// Keep last 20
if (metrics.history.length > 20) {
  metrics.history = metrics.history.slice(-20);
}

// Compute deltas (vs previous snapshot)
const deltas = {};
if (prev) {
  for (const k of ["nodes", "repos", "releases", "verifiers", "partitions", "anchored", "anchorCoverage", "avgIntegrity", "avgAssurance"]) {
    deltas[k] = current[k] - (prev[k] || 0);
  }
} else {
  for (const k of ["nodes", "repos", "releases", "verifiers", "partitions", "anchored", "anchorCoverage", "avgIntegrity", "avgAssurance"]) {
    deltas[k] = 0;
  }
}

// Latest release info
const latest = trust.length > 0
  ? trust.reduce((a, b) => new Date(a.timestamp) > new Date(b.timestamp) ? a : b)
  : null;

metrics.current = current;
metrics.deltas = deltas;
metrics.latestRelease = latest ? {
  repo: latest.repo,
  version: latest.version,
  integrity: latest.integrityScore,
  assurance: latest.assuranceScore,
  anchored: !!anchors.releaseAnchors?.[`${latest.repo}@${latest.version}`],
  timestamp: latest.timestamp,
  commit: latest.commit,
} : null;

fs.writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2), "utf8");
console.log(`Metrics built: ${metrics.history.length} snapshots, changed=${changed}.`);
