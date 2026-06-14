#!/usr/bin/env node
//
// post-anchor.mjs — submit the current partition root to XRPL as a memo on an AccountSet tx.
//
// ──────────────────────────────────────────────────────────────────────────────────────────────
// TESTNET → MAINNET MIGRATION (ANC-B07)
// ──────────────────────────────────────────────────────────────────────────────────────────────
// RepoMesh anchors to the XRPL *testnet* by default. Testnet ledgers are periodically RESET, which
// PURGES historical transactions — a verifier resolving an old testnet txHash will get txnNotFound
// (verify-anchor.mjs now reports this with recovery guidance, see ANC-B01). For durable, citable
// anchors, migrate to mainnet:
//
//   1. config switch — set `anchor/xrpl/config.json`:
//        "network":      "mainnet"                       (was "testnet")
//        "rippledUrl":   "wss://xrplcluster.com"         (was a testnet wss:// endpoint)
//      or override per-invocation with XRPL_WS_URL (the env var takes precedence over config).
//   2. funded wallet — mainnet requires a real XRP-funded account (testnet uses the faucet). Set
//      XRPL_SEED to that wallet's seed. Each AccountSet anchor costs the standard XRP tx fee (drops).
//   3. trust allowlist — add the mainnet wallet's classic address to `trustedAnchorAccounts` in
//        config.json AND to BUNDLED_TRUSTED_ACCOUNTS in verify-anchor.mjs (the bundled fallback can
//        never be dropped, so the verifier still enforces ANC-001 even with a remote config). The
//        testnet account may stay in the allowlist for verifying historical anchors.
//   4. what changes downstream — the on-chain memo is network-tagged (`n: <network>`), so memos
//      written on mainnet self-describe as mainnet and verify against the mainnet rippled. Existing
//      testnet manifests/memos keep their `n: "testnet"` and verify only while the testnet tx
//      survives a reset. There is NO automatic re-anchor: after switching, run compute-root.mjs +
//      post-anchor.mjs to mint the first mainnet anchor (a fresh genesis on mainnet).
// ──────────────────────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import xrpl from "xrpl";

function stringToHex(s) { return Buffer.from(s, "utf8").toString("hex").toUpperCase(); }

// D16: the on-chain memo self-describes its Merkle algorithm. Carrying `algo` lets the standalone
// verifier recompute the root with the SAME algorithm that produced it (v2 by default now).
// MemoType stays repomesh-anchor-v1 so existing verifiers still locate the memo, and legacy memos
// without an `algo` field still resolve to v1 via the verifiers' `memo.algo || 'sha256-merkle-v1'`
// fallback. The memo `algo` is OMITTED only when undefined, so we never write a misleading default.
export function buildAnchorMemo({ partitionId, network, rootHex, manifestHash, count, prev, range, algo }) {
  const dataObj = {
    v: 1,
    p: partitionId,
    n: network,
    r: rootHex,
    h: manifestHash,
    c: count,
    pv: prev || "0",
    rg: range ? `${range[0]}..${range[1]}` : "0",
  };
  // Self-describe the algorithm so v2 anchors verify as v2 (and legacy v1 memos keep working).
  if (algo) dataObj.algo = algo;
  const memoData = JSON.stringify(dataObj);
  if (Buffer.byteLength(memoData, "utf8") > 700) throw new Error(`MemoData too large: ${Buffer.byteLength(memoData)} bytes`);
  return { Memo: {
    MemoType: stringToHex("repomesh-anchor-v1"),
    MemoFormat: stringToHex("application/json"),
    MemoData: stringToHex(memoData),
  }};
}

async function main() {
  const configPath = path.join(import.meta.dirname, "..", "config.json");
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (e) { console.error("Failed to read " + configPath + ": " + e.message); process.exit(1); }
  const WS_URL = process.env.XRPL_WS_URL || config.rippledUrl;
  const SEED = process.env.XRPL_SEED;
  if (!SEED) { console.error("Set XRPL_SEED env var or add to anchor/xrpl/config.json. Generate with: xrpl wallet create"); process.exit(1); }

  const rootPath = path.join(import.meta.dirname, "..", "partition-root.json");
  if (!fs.existsSync(rootPath)) { console.error("Run compute-root.mjs first"); process.exit(1); }
  let rootData;
  try { rootData = JSON.parse(fs.readFileSync(rootPath, "utf8")); } catch (e) { console.error("Failed to read " + rootPath + ": " + e.message); process.exit(1); }
  if (!rootData.root) { console.log("Empty partition. Skipping."); process.exit(0); }

  const client = new xrpl.Client(WS_URL);
  await client.connect();
  try {
    const wallet = xrpl.Wallet.fromSeed(SEED);
    const tx = {
      TransactionType: "AccountSet", Account: wallet.address,
      Memos: [buildAnchorMemo({
        partitionId: rootData.partitionId,
        network: config.network,
        rootHex: rootData.root,
        manifestHash: rootData.manifestHash,
        count: rootData.eventCount,
        prev: rootData.prev,
        range: rootData.range,
        algo: rootData.algo,
      })],
    };
    const result = await Promise.race([client.submitAndWait(tx, { wallet }), new Promise((_, reject) => setTimeout(() => reject(new Error("XRPL submission timeout (60s)")), 60000))]);
    const txHash = result?.result?.hash || result?.result?.tx_json?.hash;
    const engineResult = result?.result?.meta?.TransactionResult || result?.result?.engine_result;
    const output = {
      ok: engineResult === "tesSUCCESS",
      network: config.network,
      partitionId: rootData.partitionId,
      root: rootData.root,
      manifestHash: rootData.manifestHash,
      eventCount: rootData.eventCount,
      txHash,
      walletAddress: wallet.address,
    };
    console.log(JSON.stringify(output, null, 2));
    fs.writeFileSync(path.join(import.meta.dirname, "..", "anchor-result.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
    // ANC-B05 (andon halt): a non-tesSUCCESS submission means the anchor did NOT land on-chain. Exit
    // non-zero so the workflow step fails loudly instead of reporting success on a no-op. The defect
    // must not propagate downstream (build-anchors would otherwise bind a txHash that never validated).
    if (!output.ok) {
      console.error(`\n  XRPL submission did NOT succeed (engine result: ${engineResult || "unknown"}). ` +
        `The partition was NOT anchored on-chain. Not exiting 0.\n`);
      process.exitCode = 1;
    }
  } finally { await client.disconnect(); }
}

// Only run main() when invoked as a script, not when imported by tests (importing must not
// trigger an XRPL submission). Mirrors the guard in verify-anchor.mjs.
const INVOKED_AS_SCRIPT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPathSafe(import.meta.url);
function fileURLToPathSafe(u) {
  try { return path.resolve(new URL(u).pathname.replace(/^\/([A-Za-z]:)/, "$1")); } catch { return ""; }
}
if (INVOKED_AS_SCRIPT) {
  main().catch(e => { console.error(e); process.exit(1); });
}
