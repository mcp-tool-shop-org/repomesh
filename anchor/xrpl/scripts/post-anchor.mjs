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

// STGB-ANCHOR-002 — validate the XRPL_SEED shape BEFORE we open a socket, so a typo'd/empty seed
// gives a one-line actionable message instead of a raw `Wallet.fromSeed` crypto stack after the
// connect. XRPL family seeds are base58 (no 0/O/I/l), begin with 's' (classic seeds 's...' and the
// ed25519 'sEd...' variant), and are ~29-31 chars. This is a SHAPE pre-check, not full base58-check
// validation — Wallet.fromSeed (wrapped below) remains the authority; this just makes the common
// failure legible. Returns { ok, reason } (pure / testable).
export function validateSeedShape(seed) {
  if (typeof seed !== "string" || seed.length === 0) {
    return { ok: false, reason: "XRPL_SEED is empty or unset — set the funded wallet's seed (generate with: xrpl wallet create)." };
  }
  if (seed[0] !== "s") {
    return { ok: false, reason: `XRPL_SEED does not look like an XRPL family seed — it must begin with 's' (got "${seed[0]}…"). Did you paste the classic ADDRESS (r…) instead of the SEED?` };
  }
  if (seed.length < 16 || seed.length > 40) {
    return { ok: false, reason: `XRPL_SEED has an unexpected length (${seed.length}); an XRPL seed is ~29-31 base58 chars. Check for truncation or extra whitespace.` };
  }
  // base58 (Bitcoin/Ripple alphabet) excludes 0, O, I, l.
  if (/[0OIl]/.test(seed) || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(seed)) {
    return { ok: false, reason: "XRPL_SEED contains characters outside the base58 alphabet (no 0, O, I, l) — it is not a valid seed." };
  }
  return { ok: true };
}

// LEDGER-A-004 / STGB-ANCHOR-005 — convert an XRPL Ripple-epoch close-time (seconds since
// 2000-01-01T00:00:00Z) into an ISO-8601 string. submitAndWait returns the validated tx, whose
// `result.date` is the ledger close-time — the ONLY trustworthy clock for this anchor. Mirrors
// verify-anchor's rippleDateToCloseTime. Returns null (never throws) when the date is absent.
const RIPPLE_EPOCH_OFFSET_SECONDS = 946684800;
export function extractCloseTime(submitResult) {
  const date = submitResult?.result?.date;
  if (typeof date !== "number" || !Number.isFinite(date)) return null;
  const d = new Date((date + RIPPLE_EPOCH_OFFSET_SECONDS) * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// STGB-ANCHOR-005 — the validating ledger index from the submitAndWait result. Surfaces alongside
// the close-time so the receipt records exactly which ledger finalized the anchor. Returns null
// (never throws) when absent.
export function extractLedgerIndex(submitResult) {
  const li = submitResult?.result?.ledger_index;
  return typeof li === "number" && Number.isFinite(li) ? li : null;
}

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
  // STGB-ANCHOR-002 — validate the seed shape up front (before opening a socket). A malformed/missing
  // seed otherwise surfaces as a raw Wallet.fromSeed crypto stack AFTER a needless connect.
  const seedCheck = validateSeedShape(SEED);
  if (!seedCheck.ok) { console.error(`\n  ${seedCheck.reason}\n  Set XRPL_SEED to the funded anchor wallet's seed (or add to anchor/xrpl/config.json). Generate with: xrpl wallet create\n`); process.exit(1); }

  const rootPath = path.join(import.meta.dirname, "..", "partition-root.json");
  if (!fs.existsSync(rootPath)) { console.error("Run compute-root.mjs first"); process.exit(1); }
  let rootData;
  try { rootData = JSON.parse(fs.readFileSync(rootPath, "utf8")); } catch (e) { console.error("Failed to read " + rootPath + ": " + e.message); process.exit(1); }
  if (!rootData.root) { console.log("Empty partition. Skipping."); process.exit(0); }

  const client = new xrpl.Client(WS_URL);
  try {
    await client.connect();
  } catch (connErr) {
    // STGB-ANCHOR-002 (parity with verify-anchor's ANC-B01 read-path): an unreachable rippled
    // endpoint (DNS/timeout/refused) must give recovery guidance, not a raw stack — the write-path
    // is just as trust-sensitive as the read-path.
    console.error(
      `\n  Could not connect to the XRPL network "${config.network}" at ${WS_URL}` +
      `\n  (${connErr.message}).` +
      `\n  The network may be down or unreachable from here. The partition was NOT anchored.` +
      `\n  Retry when connectivity is restored, or point XRPL_WS_URL at a reachable rippled endpoint.\n`
    );
    process.exit(1);
  }
  try {
    let wallet;
    try {
      wallet = xrpl.Wallet.fromSeed(SEED);
    } catch (seedErr) {
      // STGB-ANCHOR-002 — the shape pre-check passed but xrpl still rejected the seed (e.g. a bad
      // base58 checksum). Translate the crypto stack into an actionable message.
      console.error(`\n  Invalid XRPL_SEED: ${seedErr.message}\n  Check the XRPL_SEED value — it must be a valid funded-wallet seed (generate with: xrpl wallet create).\n`);
      await client.disconnect();
      process.exit(1);
    }
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
    // STGB-ANCHOR-005 — surface the on-chain ledger close-time (the trusted clock) + the validating
    // ledger index in the receipt. Both come straight from the submitAndWait validated result.
    const closeTimeIso = extractCloseTime(result);
    const ledgerIndex = extractLedgerIndex(result);
    const output = {
      ok: engineResult === "tesSUCCESS",
      network: config.network,
      partitionId: rootData.partitionId,
      root: rootData.root,
      manifestHash: rootData.manifestHash,
      eventCount: rootData.eventCount,
      txHash,
      walletAddress: wallet.address,
      ledger_index: ledgerIndex,
      close_time_iso: closeTimeIso,
    };
    console.log(JSON.stringify(output, null, 2));
    if (output.ok) {
      // STGB-ANCHOR-005 — echo the trust-relevant facts in human form: tx, the trusted on-chain
      // clock, and the validating ledger index. (The receipt JSON above carries them for tooling.)
      console.log(`\n  Anchored: tx=${txHash}`);
      console.log(`  On-chain close-time: ${closeTimeIso ? closeTimeIso + " (trusted clock)" : "(unavailable — result.date absent)"}`);
      console.log(`  Validating ledger:   ${ledgerIndex ?? "(unavailable)"}\n`);
    }
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
