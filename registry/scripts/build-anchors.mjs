#!/usr/bin/env node
// RepoMesh Anchor Index — Generates registry/anchors.json
// Maps partitions to XRPL tx hashes and release canonicalHashes to partitions.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const MANIFESTS_DIR = path.join(ROOT, "anchor", "xrpl", "manifests");
const REGISTRY_DIR = path.join(ROOT, "registry");

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n").filter(l => l.trim().length > 0).map(l => JSON.parse(l));
}

function getPartitionEvents(events, partitionId) {
  if (partitionId === "all" || partitionId === "genesis") return events;
  if (partitionId.startsWith("since:")) {
    const sinceTs = partitionId.slice(6);
    const idx = events.findIndex(ev =>
      ev.type === "AttestationPublished" &&
      ev.timestamp === sinceTs &&
      (ev.attestations || []).some(a => a.type === "ledger.anchor")
    );
    return idx >= 0 ? events.slice(idx + 1) : events;
  }
  return events.filter(ev => ev.timestamp?.startsWith(partitionId));
}

const events = readEvents();

// 1. Build partition index from manifests
const partitions = [];
if (fs.existsSync(MANIFESTS_DIR)) {
  for (const file of fs.readdirSync(MANIFESTS_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(MANIFESTS_DIR, file), "utf8"));

    // Find matching anchor event for txHash
    let txHash = null;
    let network = null;
    let walletAddress = null;
    for (const ev of events) {
      if (ev.type !== "AttestationPublished") continue;
      if (!(ev.attestations || []).some(a => a.type === "ledger.anchor")) continue;
      const notes = ev.notes || "";
      try {
        const jsonMatch = notes.match(/\n(\{.*\})$/s);
        if (!jsonMatch) continue;
        const meta = JSON.parse(jsonMatch[1]);
        if (meta.merkleRoot === manifest.root || meta.manifestHash === manifest.manifestHash) {
          txHash = meta.txHash || null;
          network = meta.network || null;
          walletAddress = meta.walletAddress || null;
          break;
        }
      } catch {}
    }

    partitions.push({
      partitionId: manifest.partitionId,
      root: manifest.root,
      manifestHash: manifest.manifestHash,
      prev: manifest.prev,
      range: manifest.range,
      count: manifest.count,
      network: manifest.network,
      txHash,
      walletAddress,
      manifestFile: file,
    });
  }
}

// 2. Build release → partition mapping
const releaseAnchors = {};
for (const ev of events) {
  if (ev.type !== "ReleasePublished") continue;
  const hash = ev.signature?.canonicalHash;
  if (!hash) continue;

  // Check each partition for inclusion
  for (const p of partitions) {
    const partition = getPartitionEvents(events, p.partitionId);
    const leaves = partition
      .map(e => e.signature?.canonicalHash)
      .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));
    if (leaves.includes(hash)) {
      const key = `${ev.repo}@${ev.version}`;
      releaseAnchors[key] = {
        repo: ev.repo,
        version: ev.version,
        canonicalHash: hash,
        partitionId: p.partitionId,
        root: p.root,
        manifestHash: p.manifestHash,
        txHash: p.txHash,
        network: p.network,
      };
      break; // first match is sufficient
    }
  }
}

const output = { partitions, releaseAnchors };
fs.writeFileSync(
  path.join(REGISTRY_DIR, "anchors.json"),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(`Anchor index built: ${partitions.length} partition(s), ${Object.keys(releaseAnchors).length} anchored release(s).`);
