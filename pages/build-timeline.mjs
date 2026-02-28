#!/usr/bin/env node
// Build timeline of anchors + releases for the dashboard.
// Output: registry/timeline.json

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function readJSON(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const trust = readJSON("registry/trust.json") || [];
const anchors = readJSON("registry/anchors.json") || { partitions: [], releaseAnchors: {} };

const events = [];

// Add releases
for (const entry of trust) {
  const anchorKey = `${entry.repo}@${entry.version}`;
  const anchor = anchors.releaseAnchors?.[anchorKey];
  events.push({
    type: "release",
    ts: entry.timestamp,
    label: `${entry.repo}@${entry.version}`,
    repo: entry.repo,
    version: entry.version,
    commit: entry.commit,
    integrity: entry.integrityScore,
    assurance: entry.assuranceScore,
    anchored: !!anchor,
    anchorPartition: anchor?.partitionId || null,
  });
}

// Add anchors
for (const p of anchors.partitions) {
  // Use manifestHash timestamp or partition date as ts
  const ts = p.partitionId.startsWith("since:")
    ? p.partitionId.slice(6)
    : `${p.partitionId}T00:00:00.000Z`;
  events.push({
    type: "anchor",
    ts,
    label: `Anchor: ${p.partitionId}`,
    partitionId: p.partitionId,
    root: p.root,
    manifestHash: p.manifestHash,
    count: p.count,
    txHash: p.txHash || null,
    network: p.network,
    prev: p.prev || null,
  });
}

// Sort by timestamp (newest first)
events.sort((a, b) => new Date(b.ts) - new Date(a.ts));

const timeline = { events, generatedAt: new Date().toISOString() };
const outPath = path.join(ROOT, "registry", "timeline.json");
fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2), "utf8");
console.log(`Timeline built: ${events.length} events (${trust.length} releases, ${anchors.partitions.length} anchors).`);
