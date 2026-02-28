#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { merkleRootHex, merkleManifest } from "./merkle.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n").filter(l => l.trim().length > 0).map(l => JSON.parse(l));
}

function findLastAnchor(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "AttestationPublished") {
      const ats = ev.attestations || [];
      if (ats.some(a => a.type === "ledger.anchor")) return { index: i, event: ev };
    }
  }
  return null;
}

function extractPrevRoot(anchorEvent) {
  if (!anchorEvent) return null;
  const notes = anchorEvent.notes || "";
  try {
    const jsonMatch = notes.match(/\n(\{.*\})$/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      return parsed.merkleRoot || null;
    }
  } catch {}
  return null;
}

const args = process.argv.slice(2);
const mode = args.includes("--all") ? "all" : args.includes("--date") ? "date" : "since-last";
const dateArg = args.includes("--date") ? args[args.indexOf("--date") + 1] : null;

const events = readEvents();
if (events.length === 0) { console.error("No events in ledger."); process.exit(1); }

let partition, partitionId;
if (mode === "all") { partition = events; partitionId = "all"; }
else if (mode === "date") {
  if (!dateArg) { console.error("--date requires YYYY-MM-DD"); process.exit(1); }
  partition = events.filter(ev => ev.timestamp?.startsWith(dateArg));
  partitionId = dateArg;
} else {
  const lastAnchor = findLastAnchor(events);
  if (lastAnchor) { partition = events.slice(lastAnchor.index + 1); partitionId = `since:${lastAnchor.event.timestamp}`; }
  else { partition = events; partitionId = "genesis"; }
}

if (partition.length === 0) {
  console.log(JSON.stringify({ partitionId, eventCount: 0, root: null }));
  process.exit(0);
}

const leaves = partition.map(ev => ev.signature?.canonicalHash).filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));
if (leaves.length === 0) { console.error("No valid canonical hashes."); process.exit(1); }

const lastAnchorForPrev = findLastAnchor(events);
const prev = extractPrevRoot(lastAnchorForPrev?.event) || null;
const range = [leaves[0], leaves[leaves.length - 1]];

const manifest = merkleManifest(leaves);
const output = { partitionId, partitionStart: partition[0]?.timestamp, partitionEnd: partition[partition.length-1]?.timestamp, eventCount: partition.length, prev, range, ...manifest };

console.log(JSON.stringify(output, null, 2));
const outPath = path.join(import.meta.dirname, "..", "partition-root.json");
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
