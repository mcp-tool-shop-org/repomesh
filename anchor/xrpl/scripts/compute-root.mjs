#!/usr/bin/env node
//
// compute-root.mjs — compute the Merkle root + manifest for the partition to be anchored next.
//
// ──────────────────────────────────────────────────────────────────────────────────────────────
// ANCHORING CADENCE (STGB-ANCHOR-006)
// ──────────────────────────────────────────────────────────────────────────────────────────────
// The default mode is `since-last`: each anchor covers exactly the events appended to the ledger
// SINCE the previous `ledger.anchor` attestation. Run compute-root.mjs + post-anchor.mjs ONCE PER
// release wave (the unit of attested work), not per individual event and not on a wall-clock timer:
//   - too FREQUENT (per-event) wastes XRPL tx fees and floods the ledger with one-leaf partitions;
//   - too RARE (months between anchors) means a longer window of un-anchored, only-locally-trusted
//     events, and an oversized partition whose memo can bump the 700-byte on-chain limit indirectly
//     via the range markers and whose recompute is slower for verifiers.
// The cadence is the SINCE-LAST chain: anchor N covers (anchor N-1, now]. Each manifest links to the
// previous root via `prev`, so a steady per-wave cadence keeps the chain dense and cheap to verify.
// Operators with bursty release activity can instead use `--date YYYY-MM-DD` (daily partitions) or
// `--all` (a single genesis snapshot); since-last remains the recommended default.
//
// OVERSIZED-PARTITION WARNING: a `since-last` partition that has grown unusually large (see
// OVERSIZED_PARTITION_LEAVES below) is a signal the cadence has lapsed — this script WARNS (it does
// not block) so the operator can decide to anchor now and tighten the cadence going forward.
// ──────────────────────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { merkleRootForAlgo } from "./merkle.mjs";

// Manifest version — bump when anchor format changes (future: version negotiation)
const MANIFEST_VERSION = 1;

// STGB-ANCHOR-006 — soft cap that flags a likely-lapsed cadence. Not a hard limit (the Merkle tree
// and the memo's fixed-size root/range handle large partitions fine); it is a legibility nudge so a
// partition that has silently grown across many missed waves gets a visible WARN, not silence.
const OVERSIZED_PARTITION_LEAVES = 5000;

// D3/ANC-003: new partitions are anchored with the RFC-6962 algorithm by default.
// Old v1 manifests remain verifiable (verify-anchor dispatches on manifest.algo); pass
// `--algo sha256-merkle-v1` only to reproduce a historical v1 partition.
const DEFAULT_ALGO = "sha256-merkle-v2";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const MANIFESTS_DIR = path.join(import.meta.dirname, "..", "manifests");
const CONFIG_PATH = path.join(import.meta.dirname, "..", "config.json");

function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  }
  return v;
}
function sha256hex(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

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
  const lastNewline = notes.lastIndexOf("\n");
  if (lastNewline === -1) return null;
  const jsonStr = notes.slice(lastNewline + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed.merkleRoot || null;
  } catch { return null; }
}

const args = process.argv.slice(2);
const mode = args.includes("--all") ? "all" : args.includes("--date") ? "date" : "since-last";
const dateArg = args.includes("--date") ? args[args.indexOf("--date") + 1] : null;
const algo = args.includes("--algo") ? args[args.indexOf("--algo") + 1] : DEFAULT_ALGO;
if (algo !== "sha256-merkle-v1" && algo !== "sha256-merkle-v2") {
  console.error(`Unknown --algo "${algo}" (expected sha256-merkle-v1 or sha256-merkle-v2).`);
  process.exit(1);
}

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

// STGB-ANCHOR-006 — warn (do not block) on an oversized since-last partition: a likely-lapsed
// cadence. Written to stderr so the JSON on stdout (parsed by post-anchor / CI) stays clean.
if (mode === "since-last" && leaves.length > OVERSIZED_PARTITION_LEAVES) {
  console.error(
    `\n  WARNING: this since-last partition has ${leaves.length} leaves (> ${OVERSIZED_PARTITION_LEAVES}). ` +
    `The anchoring cadence has likely lapsed — that is a long window of only-locally-trusted events. ` +
    `Anchor now (post-anchor.mjs), then anchor once per release wave going forward to keep the chain dense.\n`
  );
}

const lastAnchorForPrev = findLastAnchor(events);
const prev = extractPrevRoot(lastAnchorForPrev?.event) || null;
const range = [leaves[0], leaves[leaves.length - 1]];

let config;
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch (e) { console.error("Failed to read " + CONFIG_PATH + ": " + e.message); process.exit(1); }
const root = merkleRootForAlgo(leaves, algo);

// Build manifest base (without manifestHash)
const manifestBase = {
  v: MANIFEST_VERSION,
  algo,
  partitionId,
  network: config.network,
  prev,
  range,
  count: leaves.length,
  root,
};

// Compute manifestHash = sha256(canonicalize(manifestBase))
const manifestHash = sha256hex(canonicalize(manifestBase));

// Full manifest with hash
const manifest = { ...manifestBase, manifestHash };

// Write manifest to manifests/<partitionId>.json (append-only: write-if-missing, verify-if-exists)
fs.mkdirSync(MANIFESTS_DIR, { recursive: true });
const safeId = partitionId.replace(/[^a-zA-Z0-9._-]/g, "-");
const manifestPath = path.join(MANIFESTS_DIR, `${safeId}.json`);
const manifestJson = JSON.stringify(manifest, null, 2) + "\n";

if (fs.existsSync(manifestPath)) {
  const existing = fs.readFileSync(manifestPath, "utf8");
  if (existing !== manifestJson) {
    console.error(`Manifest conflict: ${manifestPath} exists with different content.`);
    console.error("Manifests are append-only. Use a new partitionId if algo/version changed.");
    process.exit(1);
  }
} else {
  fs.writeFileSync(manifestPath, manifestJson, "utf8");
}

// Write partition-root.json (backward compat + downstream scripts)
const output = {
  partitionId,
  partitionStart: partition[0]?.timestamp,
  partitionEnd: partition[partition.length - 1]?.timestamp,
  eventCount: partition.length,
  prev,
  range,
  algo,
  leafEncoding: "canonicalHash:hex(32)",
  leafCount: leaves.length,
  root,
  manifestHash,
  manifestPath: `anchor/xrpl/manifests/${safeId}.json`,
};
fs.writeFileSync(path.join(import.meta.dirname, "..", "partition-root.json"), JSON.stringify(output, null, 2) + "\n", "utf8");

console.log(JSON.stringify(output, null, 2));
