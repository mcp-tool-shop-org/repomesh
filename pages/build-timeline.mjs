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

// Determine if a string is a valid ISO date (YYYY-MM-DD)
function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// Derive a timestamp for non-date partition IDs by looking at release events
// that were anchored into this partition. Falls back to a sentinel.
function resolvePartitionTimestamp(partitionId, releaseEvents) {
  if (partitionId.startsWith("since:")) {
    return partitionId.slice(6);
  }
  if (isIsoDate(partitionId)) {
    return `${partitionId}T00:00:00.000Z`;
  }
  // Non-date partition (e.g. "all", "genesis") — use earliest/latest release ts
  const anchored = releaseEvents.filter(e => e.anchorPartition === partitionId);
  if (anchored.length > 0) {
    // Use the earliest release timestamp from events in this partition
    const sorted = anchored.map(e => e.ts).filter(Boolean).sort();
    if (sorted.length > 0) return sorted[0];
  }
  // No anchored releases found — use sentinel with explanatory note
  return "1970-01-01T00:00:00.000Z";
}

// Add anchors
for (const p of anchors.partitions) {
  const ts = resolvePartitionTimestamp(p.partitionId, events);
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
