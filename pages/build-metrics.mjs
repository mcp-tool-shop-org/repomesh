#!/usr/bin/env node
// Build metrics history for dashboard sparklines and deltas.
// Reads current registry data + previous metrics.json (if exists) to track history.
// Output: registry/metrics.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const METRICS_PATH = path.join(ROOT, "registry", "metrics.json");

// B-1: Safe JSON loading with try-catch and descriptive errors
function readJSON(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    console.error(`[metrics] Warning: Failed to parse ${rel}: ${err.message}. Using default.`);
    return null;
  }
}

// SB-PAGES-01: coerce wrong-type artifacts (truncated/half-written JSON that parses but is
// the wrong top-level type) to safe defaults so the reductions/lengths below can't crash.
const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// STGB-SP-003 (Stage C honesty fix) — average a numeric field across trust entries WITHOUT
// letting one missing/non-numeric score poison the headline stat. The previous reducer did
// `s + t.integrityScore` over the whole list and divided by `trust.length`; a single entry
// missing the field made the whole sum (and the rounded average) NaN — a broken, untrustworthy
// number in a trust dashboard. Here we sum and count only the values that are real finite
// numbers, divide by THAT count, and return 0 (not NaN) when nothing is present. A missing
// score is excluded from the average, never silently treated as 0 (which would understate it).
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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {

const nodes = asArray(readJSON("registry/nodes.json"));
const trust = asArray(readJSON("registry/trust.json"));
const verifiersRaw = asObject(readJSON("registry/verifiers.json"));
const verifiers = { verifiers: asArray(verifiersRaw.verifiers) };
const anchorsRaw = asObject(readJSON("registry/anchors.json"));
const anchors = { partitions: asArray(anchorsRaw.partitions), releaseAnchors: asObject(anchorsRaw.releaseAnchors) };

// Current snapshot
const repos = [...new Set(trust.map(t => t.repo))];
const anchoredCount = Object.keys(anchors.releaseAnchors || {}).length;
const anchorCoverage = trust.length > 0 ? Math.round((anchoredCount / trust.length) * 100) : 0;
// STGB-SP-003: NaN-guarded averages — a release missing a score is excluded, not summed as NaN.
const avgIntegrity = averageScore(trust, "integrityScore");
const avgAssurance = averageScore(trust, "assuranceScore");

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
// STGB-SP-001: carry the honest three-state anchor status so the dashboard hero never shows
// on-chain finality that does not exist. `anchored` stays for back-compat but now means
// ON-CHAIN anchored (record present AND real txHash), matching the rest of the dashboard.
const latestRec = latest ? (anchors.releaseAnchors?.[`${latest.repo}@${latest.version}`] ?? null) : null;
const latestAnchorState = !latestRec ? "none" : (latestRec.txHash ? "anchored" : "pending");
metrics.latestRelease = latest ? {
  repo: latest.repo,
  version: latest.version,
  integrity: latest.integrityScore,
  assurance: latest.assuranceScore,
  anchored: latestAnchorState === "anchored",
  anchorState: latestAnchorState,
  timestamp: latest.timestamp,
  commit: latest.commit,
} : null;

fs.writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2), "utf8");
console.log(`Metrics built: ${metrics.history.length} snapshots, changed=${changed}.`);

} // end if (isMain)
