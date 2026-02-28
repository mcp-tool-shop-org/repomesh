#!/usr/bin/env node
// verify-anchor.mjs — Public verifiability for XRPL-anchored Merkle roots.
//
// Usage:
//   node anchor/xrpl/scripts/verify-anchor.mjs --tx <txHash>
//   node anchor/xrpl/scripts/verify-anchor.mjs --tx <txHash> --network testnet
//
// What it does:
//   1. Fetches the transaction from XRPL and extracts the anchor memo
//   2. Reads the local ledger and partitions events matching the anchor's partition
//   3. Recomputes the Merkle root from local canonical hashes
//   4. Compares against the root in the XRPL memo
//   5. If prev is present, validates the chain link

import fs from "node:fs";
import path from "node:path";
import xrpl from "xrpl";
import { merkleRootHex } from "./merkle.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const CONFIG_PATH = path.join(import.meta.dirname, "..", "config.json");

function hexToString(hex) { return Buffer.from(hex, "hex").toString("utf8"); }

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

  const netIdx = args.indexOf("--network");
  const network = netIdx !== -1 ? args[netIdx + 1] : null;
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const WS_URL = process.env.XRPL_WS_URL || config.rippledUrl;

  console.log(`\nVerifying anchor: ${txHash}`);
  console.log(`  Network: ${network || config.network}`);
  console.log(`  XRPL:    ${WS_URL}\n`);

  // 1. Fetch transaction from XRPL
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
      console.error("No repomesh-anchor-v1 memo found in transaction.");
      process.exit(1);
    }
    memo = JSON.parse(hexToString(anchorMemo.Memo.MemoData));
    console.log("  Memo decoded:");
    console.log(`    Version:   ${memo.v}`);
    console.log(`    Partition: ${memo.p}`);
    console.log(`    Network:   ${memo.n}`);
    console.log(`    Root:      ${memo.r}`);
    console.log(`    Count:     ${memo.c}`);
    console.log(`    Prev:      ${memo.prev || "(genesis)"}`);
  } finally {
    await client.disconnect();
  }

  // 2. Read local ledger and partition
  const events = readEvents();
  if (events.length === 0) { console.error("\nNo local ledger events found."); process.exit(1); }

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
  console.log(`  Local root:  ${localRoot}`);
  console.log(`  Anchor root: ${memo.r}`);

  // 4. Compare
  if (localRoot === memo.r) {
    console.log(`\n  Merkle root MATCH`);
  } else {
    console.error(`\n  Merkle root MISMATCH`);
    process.exit(1);
  }

  // 5. Chain link validation
  if (memo.prev) {
    console.log(`\n  Chain link: prev=${memo.prev}`);
    // Find the previous anchor event in local ledger
    const prevAnchor = [...events].reverse().find(ev => {
      if (ev.type !== "AttestationPublished") return false;
      const notes = ev.notes || "";
      try {
        const jsonMatch = notes.match(/\n(\{.*\})$/s);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          return parsed.merkleRoot === memo.prev;
        }
      } catch {}
      return false;
    });
    if (prevAnchor) {
      console.log(`  Previous anchor found in ledger (${prevAnchor.timestamp})`);
    } else {
      console.log(`  Previous anchor not found in local ledger (may be pre-genesis or pruned)`);
    }
  } else {
    console.log(`\n  Genesis anchor (no prev)`);
  }

  console.log(`\n  Verification: PASS\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
