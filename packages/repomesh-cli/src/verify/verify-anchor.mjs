// verify-anchor — Verify an XRPL anchor transaction from anywhere.
// Fetches the tx from XRPL, recomputes the Merkle root from ledger data.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import xrpl from "xrpl";
import { isRepoMeshCheckout } from "../mode.mjs";
import { fetchText, fetchJson } from "../http.mjs";
import { DEFAULT_LEDGER_URL, DEFAULT_ANCHOR_CONFIG_URL } from "../remote-defaults.mjs";
import { canonicalize } from "./canonicalize.mjs";
import { merkleRootHex } from "./merkle.mjs";
import { isDebug, debug as debugLog } from "../log.mjs";

function hexToString(hex) { return Buffer.from(hex, "hex").toString("utf8"); }
function sha256hex(str) { return crypto.createHash("sha256").update(str, "utf8").digest("hex"); }

function parseJsonlLines(lines) {
  const results = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      results.push(JSON.parse(line));
    } catch (e) {
      debugLog(`skipping malformed JSONL line: ${e.message}`);
    }
  }
  return results;
}

async function loadEvents(opts) {
  if (opts.local) {
    const p = path.join(opts.root, "ledger", "events", "events.jsonl");
    if (!fs.existsSync(p)) return [];
    return parseJsonlLines(fs.readFileSync(p, "utf8").split("\n"));
  }
  const url = opts.ledgerUrl || DEFAULT_LEDGER_URL;
  const text = await fetchText(url);
  return parseJsonlLines(text.split("\n"));
}

function partitionEvents(events, partitionId) {
  if (partitionId === "all" || partitionId === "genesis") return events;
  if (partitionId.startsWith("since:")) {
    const sinceTs = partitionId.slice(6);
    const idx = events.findIndex(ev =>
      ev.type === "AttestationPublished" && ev.timestamp === sinceTs &&
      (ev.attestations || []).some(a => a.type === "ledger.anchor")
    );
    return idx >= 0 ? events.slice(idx + 1) : events;
  }
  return events.filter(ev => ev.timestamp?.startsWith(partitionId));
}

const WS_URLS = {
  testnet: "wss://s.altnet.rippletest.net:51233",
  mainnet: "wss://xrplcluster.com",
  devnet: "wss://s.devnet.rippletest.net:51233",
};

export async function verifyAnchor({ tx, network, wsUrl, ledgerUrl, json }) {
  const local = isRepoMeshCheckout();
  const opts = { local, root: process.cwd(), ledgerUrl };

  // Determine WS URL
  let resolvedWsUrl = wsUrl;
  let resolvedNetwork = network || "testnet";
  if (!resolvedWsUrl) {
    if (local) {
      try {
        const configPath = path.join(process.cwd(), "anchor", "xrpl", "config.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        resolvedWsUrl = config.rippledUrl;
        resolvedNetwork = config.network;
      } catch (e) {
        debugLog(e.message);
        resolvedWsUrl = WS_URLS[resolvedNetwork];
      }
    } else {
      try {
        const config = await fetchJson(DEFAULT_ANCHOR_CONFIG_URL);
        resolvedWsUrl = config.rippledUrl;
        resolvedNetwork = config.network;
      } catch (e) {
        debugLog(e.message);
        resolvedWsUrl = WS_URLS[resolvedNetwork];
      }
    }
  }

  if (!json) {
    console.log(`\nVerifying anchor: ${tx}`);
    console.log(`  Network: ${resolvedNetwork}`);
    console.log(`  XRPL:    ${resolvedWsUrl}`);
    console.log(`  Mode:    ${local ? "local (dev)" : "remote"}\n`);
  }

  // 1. Fetch tx from XRPL and decode memo
  const client = new xrpl.Client(resolvedWsUrl);
  await client.connect();
  let memo;
  try {
    const response = await client.request({ command: "tx", transaction: tx });
    const txData = response.result;
    const memos = txData.Memos || [];
    const anchorMemo = memos.find(m => hexToString(m.Memo?.MemoType || "") === "repomesh-anchor-v1");
    if (!anchorMemo) {
      if (json) { console.log(JSON.stringify({ ok: false, error: "No repomesh-anchor-v1 memo in tx" })); }
      else { console.error("  No repomesh-anchor-v1 memo found in transaction."); }
      process.exit(1);
    }
    try {
      memo = JSON.parse(hexToString(anchorMemo.Memo.MemoData));
    } catch (e) {
      const msg = `Failed to parse memo data: ${e.message}`;
      if (json) { console.log(JSON.stringify({ ok: false, error: msg })); }
      else { console.error(`  ${msg}`); }
      process.exit(1);
    }
  } finally {
    await client.disconnect();
  }

  // Security: validate memo shape after deserialization from untrusted XRPL data
  if (
    typeof memo !== "object" || memo === null ||
    typeof memo.p !== "string" ||
    typeof memo.r !== "string" ||
    typeof memo.h !== "string" ||
    typeof memo.c !== "number" ||
    (memo.n !== undefined && typeof memo.n !== "string") ||
    (memo.pv !== undefined && typeof memo.pv !== "string") ||
    (memo.rg !== undefined && !Array.isArray(memo.rg))
  ) {
    const err = "Invalid memo structure: missing or wrongly-typed fields";
    if (json) { console.log(JSON.stringify({ ok: false, error: err })); }
    else { console.error(`  ${err}`); }
    process.exit(1);
  }

  const prevRoot = memo.pv && memo.pv !== "0" ? memo.pv : null;

  if (!json) {
    console.log("  Memo decoded:");
    console.log(`    Partition:    ${memo.p}`);
    console.log(`    Root:         ${memo.r}`);
    console.log(`    ManifestHash: ${memo.h}`);
    console.log(`    Count:        ${memo.c}`);
    console.log(`    Prev:         ${prevRoot || "(genesis)"}`);
  }

  // 2. Load ledger and partition
  const events = await loadEvents(opts);
  if (events.length === 0) {
    if (json) { console.log(JSON.stringify({ ok: false, error: "No ledger events" })); }
    else { console.error("\n  No ledger events found."); }
    process.exit(1);
  }

  const partition = partitionEvents(events, memo.p);
  const leaves = partition.map(ev => ev.signature?.canonicalHash)
    .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));

  if (!json) console.log(`\n  Local partition "${memo.p}": ${partition.length} events, ${leaves.length} leaves`);

  if (leaves.length === 0) {
    if (json) { console.log(JSON.stringify({ ok: false, error: "No valid leaves" })); }
    else { console.error("  No valid canonical hashes in partition."); }
    process.exit(1);
  }

  if (leaves.length !== memo.c) {
    if (json) { console.log(JSON.stringify({ ok: false, error: `Count mismatch: local=${leaves.length}, anchor=${memo.c}` })); }
    else { console.error(`  Event count mismatch: local=${leaves.length}, anchor=${memo.c}`); }
    process.exit(1);
  }

  // 3. Recompute Merkle root
  const localRoot = merkleRootHex(leaves);
  const rootMatch = localRoot === memo.r;
  if (!json) {
    console.log(`\n  Root check:`);
    console.log(`    Local:  ${localRoot}`);
    console.log(`    Anchor: ${memo.r}`);
    console.log(`    ${rootMatch ? "MATCH" : "MISMATCH"}`);
  }
  if (!rootMatch) {
    if (json) { console.log(JSON.stringify({ ok: false, error: "Root mismatch", local: localRoot, anchor: memo.r })); }
    process.exit(1);
  }

  // 4. Recompute manifestHash
  const localRange = [leaves[0], leaves[leaves.length - 1]];
  const manifestBase = {
    v: 1, algo: "sha256-merkle-v1", partitionId: memo.p,
    network: memo.n, prev: prevRoot, range: localRange,
    count: leaves.length, root: localRoot,
  };
  const localManifestHash = sha256hex(canonicalize(manifestBase));
  const mhMatch = localManifestHash === memo.h;

  if (!json) {
    console.log(`\n  Manifest hash check:`);
    console.log(`    Local:  ${localManifestHash}`);
    console.log(`    Anchor: ${memo.h}`);
    console.log(`    ${mhMatch ? "MATCH" : "MISMATCH"}`);
  }
  if (!mhMatch) {
    if (json) { console.log(JSON.stringify({ ok: false, error: "ManifestHash mismatch" })); }
    process.exit(1);
  }

  // 5. Chain link
  if (!json) {
    if (prevRoot) { console.log(`\n  Chain link: prev=${prevRoot.slice(0, 16)}...`); }
    else { console.log(`\n  Chain link: genesis (no prev)`); }
  }

  const result = {
    ok: true, tx, network: resolvedNetwork,
    partition: memo.p, root: localRoot, manifestHash: localManifestHash,
    count: leaves.length, prevRoot,
  };

  if (json) { console.log(JSON.stringify(result, null, 2)); }
  else { console.log(`\n  Verification: PASS\n`); }
}
