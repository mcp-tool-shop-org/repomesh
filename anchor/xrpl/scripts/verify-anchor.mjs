#!/usr/bin/env node
// verify-anchor.mjs — Public verifiability for XRPL-anchored Merkle roots.
//
// Usage:
//   node anchor/xrpl/scripts/verify-anchor.mjs --tx <txHash>
//   node anchor/xrpl/scripts/verify-anchor.mjs --tx <txHash> --network testnet
//
// Verifies:
//   1. Fetches XRPL tx, extracts repomesh-anchor-v1 memo
//   2. Recomputes Merkle root from local ledger partition
//   3. Recomputes manifestHash from canonical manifest base
//   4. Confirms root match + manifestHash match
//   5. Validates chain link (prev) if present

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import xrpl from "xrpl";
import { merkleRootHex } from "./merkle.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const CONFIG_PATH = path.join(import.meta.dirname, "..", "config.json");

function hexToString(hex) { return Buffer.from(hex, "hex").toString("utf8"); }

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

function partitionEvents(events, partitionId) {
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
  // date-based partition
  return events.filter(ev => ev.timestamp?.startsWith(partitionId));
}

async function main() {
  const args = process.argv.slice(2);
  const txIdx = args.indexOf("--tx");
  const txHash = txIdx !== -1 ? args[txIdx + 1] : null;
  if (!txHash) { console.error("Usage: verify-anchor.mjs --tx <txHash>"); process.exit(1); }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const WS_URL = process.env.XRPL_WS_URL || config.rippledUrl;

  console.log(`\nVerifying anchor: ${txHash}`);
  console.log(`  Network: ${config.network}`);
  console.log(`  XRPL:    ${WS_URL}\n`);

  // 1. Fetch transaction from XRPL and decode memo
  const client = new xrpl.Client(WS_URL);
  await client.connect();
  let memo;
  try {
    const response = await client.request({ command: "tx", transaction: txHash });
    const tx = response.result;
    const memos = tx.Memos || [];
    const anchorMemo = memos.find(m =>
      hexToString(m.Memo?.MemoType || "") === "repomesh-anchor-v1"
    );
    if (!anchorMemo) {
      console.error("  No repomesh-anchor-v1 memo found in transaction.");
      process.exit(1);
    }
    memo = JSON.parse(hexToString(anchorMemo.Memo.MemoData));
  } finally {
    await client.disconnect();
  }

  // Parse range from "first..last" format
  const rangeParts = memo.rg && memo.rg !== "0" ? memo.rg.split("..") : null;
  const prevRoot = memo.pv && memo.pv !== "0" ? memo.pv : null;

  console.log("  Memo decoded:");
  console.log(`    Version:      ${memo.v}`);
  console.log(`    Partition:    ${memo.p}`);
  console.log(`    Network:      ${memo.n}`);
  console.log(`    Root:         ${memo.r}`);
  console.log(`    ManifestHash: ${memo.h}`);
  console.log(`    Count:        ${memo.c}`);
  console.log(`    Prev:         ${prevRoot || "(genesis)"}`);
  console.log(`    Range:        ${rangeParts ? `${rangeParts[0].slice(0, 12)}...${rangeParts[1].slice(0, 12)}` : "(none)"}`);

  // 2. Read local ledger and partition
  const events = readEvents();
  if (events.length === 0) { console.error("\n  No local ledger events found."); process.exit(1); }

  const partition = partitionEvents(events, memo.p);
  const leaves = partition
    .map(ev => ev.signature?.canonicalHash)
    .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));

  console.log(`\n  Local partition "${memo.p}": ${partition.length} events, ${leaves.length} leaves`);

  if (leaves.length === 0) {
    console.error("  No valid canonical hashes in partition.");
    process.exit(1);
  }

  if (leaves.length !== memo.c) {
    console.error(`  Event count mismatch: local=${leaves.length}, anchor=${memo.c}`);
    process.exit(1);
  }

  // 3. Recompute Merkle root
  const localRoot = merkleRootHex(leaves);

  const rootMatch = localRoot === memo.r;
  console.log(`\n  Root check:`);
  console.log(`    Local:  ${localRoot}`);
  console.log(`    Anchor: ${memo.r}`);
  console.log(`    ${rootMatch ? "MATCH" : "MISMATCH"}`);
  if (!rootMatch) { process.exit(1); }

  // 4. Recompute manifestHash
  const localRange = [leaves[0], leaves[leaves.length - 1]];
  const manifestBase = {
    v: 1,
    algo: "sha256-merkle-v1",
    partitionId: memo.p,
    network: memo.n,
    prev: prevRoot,
    range: localRange,
    count: leaves.length,
    root: localRoot,
  };
  const localManifestHash = sha256hex(canonicalize(manifestBase));

  const mhMatch = localManifestHash === memo.h;
  console.log(`\n  Manifest hash check:`);
  console.log(`    Local:  ${localManifestHash}`);
  console.log(`    Anchor: ${memo.h}`);
  console.log(`    ${mhMatch ? "MATCH" : "MISMATCH"}`);
  if (!mhMatch) { process.exit(1); }

  // 5. Chain link validation
  if (prevRoot) {
    console.log(`\n  Chain link: prev=${prevRoot.slice(0, 16)}...`);
    const prevAnchor = [...events].reverse().find(ev => {
      if (ev.type !== "AttestationPublished") return false;
      const notes = ev.notes || "";
      try {
        const jsonMatch = notes.match(/\n(\{.*\})$/s);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          return parsed.merkleRoot === prevRoot;
        }
      } catch {}
      return false;
    });
    if (prevAnchor) {
      console.log(`    Previous anchor found in ledger (${prevAnchor.timestamp})`);
    } else {
      console.log(`    Previous anchor not in local ledger (may be pre-genesis or pruned)`);
    }
  } else {
    console.log(`\n  Chain link: genesis (no prev)`);
  }

  console.log(`\n  Verification: PASS\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
