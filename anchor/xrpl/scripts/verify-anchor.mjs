#!/usr/bin/env node
// verify-anchor.mjs — Public verifiability for XRPL-anchored Merkle roots.
//
// Usage:
//   node anchor/xrpl/scripts/verify-anchor.mjs --tx <txHash>
//   node anchor/xrpl/scripts/verify-anchor.mjs --tx <txHash> --network testnet
//
// Verifies (D4 / ANC-001 / ANC-002 / REG-001):
//   1. Fetches the XRPL tx, extracts the repomesh-anchor-v1 memo.
//   2. Recomputes the Merkle root from the local ledger partition USING THE ALGO the memo/manifest
//      declares (sha256-merkle-v1 vs sha256-merkle-v2).
//   3. Recomputes manifestHash from the canonical manifest base.
//   4. Asserts the on-chain tx is real and authoritative:
//        - tx.validated === true                      (ANC-002)
//        - meta.TransactionResult === 'tesSUCCESS'
//        - tx.Account ∈ trustedAnchorAccounts          (ANC-001)
//   5. Asserts the on-chain memo r/h/c bind to the local root/manifestHash/count (REG-001).
//   6. Validates the chain link (prev) if present.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { merkleRootForAlgo } from "./merkle.mjs";

// Manifest version — bump when anchor format changes (future: version negotiation)
const MANIFEST_VERSION = 1;

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const CONFIG_PATH = path.join(import.meta.dirname, "..", "config.json");

// Bundled fallback allowlist — pinned so that even when config.json is fetched/overridden remotely
// (it is user-overridable via --ws-url / XRPL_WS_URL) the account check cannot be silently disabled.
const BUNDLED_TRUSTED_ACCOUNTS = ["rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W"];

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

// LEDGER-A-004: convert an XRPL Ripple-epoch close-time (seconds since 2000-01-01T00:00:00Z) to a
// JS Date. Ripple epoch offset from the Unix epoch is 946684800 s (contract §5.2). The on-chain
// close-time is the ONLY trustworthy clock for the key-lifecycle compromise gate; the CLI's
// verify-anchor threads it into the rung-1 'xrpl' resolver. This reference command surfaces it too
// (it previously never read txObj.date), so an operator running `verify-anchor --tx` sees the real
// on-chain time, not just the anchor event's self-asserted timestamp. Returns null when absent.
function rippleDateToCloseTime(rippleEpochSeconds) {
  if (typeof rippleEpochSeconds !== "number" || !Number.isFinite(rippleEpochSeconds)) return null;
  const d = new Date((rippleEpochSeconds + 946684800) * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Best-effort local Merkle root for operator guidance when the network/tx is unavailable (ANC-B01).
// Prefers the genesis manifest, then any committed manifest. Returns null if none can be read.
function localManifestRoot(root) {
  const manifestsDir = path.join(root, "anchor", "xrpl", "manifests");
  if (!fs.existsSync(manifestsDir)) return null;
  const files = fs.readdirSync(manifestsDir).filter(f => f.endsWith(".json"));
  const ordered = [...files].sort((a, b) => (a === "genesis.json" ? -1 : b === "genesis.json" ? 1 : 0));
  for (const f of ordered) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(manifestsDir, f), "utf8"));
      if (m && typeof m.root === "string") return m.root;
    } catch { /* skip unreadable manifest */ }
  }
  return null;
}

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n").filter(l => l.trim().length > 0).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
}

// Resolve a partition's events. Returns { events, fellBack } so the caller can WARN when a
// `since:` boundary marker is missing (ANC-B06): a missing boundary silently WIDENS the partition
// to the full ledger, which would otherwise produce a different (wrong) root than the anchor's
// without any signal. fellBack=true means "the partition was widened beyond the requested window."
export function resolvePartition(events, partitionId) {
  if (partitionId === "all" || partitionId === "genesis") return { events, fellBack: false };
  if (partitionId.startsWith("since:")) {
    const sinceTs = partitionId.slice(6);
    const idx = events.findIndex(ev =>
      ev.type === "AttestationPublished" &&
      ev.timestamp === sinceTs &&
      (ev.attestations || []).some(a => a.type === "ledger.anchor")
    );
    if (idx >= 0) return { events: events.slice(idx + 1), fellBack: false };
    // Boundary anchor marker not found — fall back to the full ledger, but flag it.
    return { events, fellBack: true };
  }
  // date-based partition
  return { events: events.filter(ev => ev.timestamp?.startsWith(partitionId)), fellBack: false };
}

// Backward-compatible thin wrapper (returns just the events array).
function partitionEvents(events, partitionId) {
  return resolvePartition(events, partitionId).events;
}

// Resolve the trusted anchor accounts: config value UNION the bundled fallback. The fallback can
// never be dropped, so a remotely-supplied config cannot turn the ANC-001 check off.
function resolveTrustedAccounts(config) {
  const fromConfig = Array.isArray(config?.trustedAnchorAccounts) ? config.trustedAnchorAccounts : [];
  return [...new Set([...BUNDLED_TRUSTED_ACCOUNTS, ...fromConfig])];
}

// Pure, testable core (D4 / ANC-001 / ANC-002 / REG-001). No network, no fs.
// Returns { ok, reason, checks } where checks records each sub-assertion.
export function verifyAnchorTx({ tx, memo, localRoot, localManifestHash, leafCount, trustedAnchorAccounts }) {
  const checks = {};
  const trusted = new Set(trustedAnchorAccounts || []);

  // ANC-002 — the tx must be validated (final) on the ledger.
  checks.validated = tx?.validated === true;
  if (!checks.validated) {
    return { ok: false, reason: `tx.validated is not true (anchor not finalized on-chain)`, checks };
  }

  // tesSUCCESS — the tx must have actually succeeded.
  const txResult = tx?.meta?.TransactionResult;
  checks.tesSUCCESS = txResult === "tesSUCCESS";
  if (!checks.tesSUCCESS) {
    return { ok: false, reason: `meta.TransactionResult is "${txResult}" (expected tesSUCCESS)`, checks };
  }

  // ANC-001 — the signing wallet must be a trusted anchor account.
  checks.account = trusted.has(tx?.Account);
  if (!checks.account) {
    return {
      ok: false,
      reason: `tx.Account "${tx?.Account}" is not in trustedAnchorAccounts — any funded wallet can post a memo; the account allowlist is the authorization root.`,
      checks,
    };
  }

  // REG-001 — on-chain memo binds to the local root / manifestHash / count.
  checks.root = memo?.r === localRoot;
  if (!checks.root) {
    return { ok: false, reason: `Merkle root mismatch: memo.r=${memo?.r} local=${localRoot}`, checks };
  }
  checks.manifestHash = memo?.h === localManifestHash;
  if (!checks.manifestHash) {
    return { ok: false, reason: `manifestHash mismatch: memo.h=${memo?.h} local=${localManifestHash}`, checks };
  }
  checks.count = Number(memo?.c) === Number(leafCount);
  if (!checks.count) {
    return { ok: false, reason: `event count mismatch: memo.c=${memo?.c} local=${leafCount}`, checks };
  }

  return { ok: true, reason: "all anchor checks passed", checks };
}

async function main() {
  const xrpl = (await import("xrpl")).default;
  const args = process.argv.slice(2);
  const txIdx = args.indexOf("--tx");
  const txHash = txIdx !== -1 ? args[txIdx + 1] : null;
  if (!txHash) { console.error("Usage: verify-anchor.mjs --tx <txHash>"); process.exit(1); }

  let config;
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch (e) { console.error("Failed to read " + CONFIG_PATH + ": " + e.message); process.exit(1); }
  const WS_URL = process.env.XRPL_WS_URL || config.rippledUrl;
  const trustedAccounts = resolveTrustedAccounts(config);

  console.log(`\nVerifying anchor: ${txHash}`);
  console.log(`  Network: ${config.network}`);
  console.log(`  XRPL:    ${WS_URL}\n`);

  // 1. Fetch transaction from XRPL and decode memo + tx metadata.
  const client = new xrpl.Client(WS_URL);
  try {
    await client.connect();
  } catch (connErr) {
    // ANC-B01: the rippled endpoint is unreachable (DNS/timeout/refused). Give recovery guidance,
    // not a raw stack trace — this is exactly when a trust tool must be legible.
    console.error(
      `\n  Could not connect to the XRPL network "${config.network}" at ${WS_URL}` +
      `\n  (${connErr.message}).` +
      `\n  The network may be down or unreachable from here. The local manifest root is ${localManifestRoot(ROOT) || "(unknown — run compute-root.mjs)"}.` +
      `\n  Retry when connectivity is restored, or point --ws-url / XRPL_WS_URL at a reachable rippled.\n`
    );
    process.exit(1);
  }
  let memo, txObj;
  try {
    let response;
    try {
      response = await client.request({ command: "tx", transaction: txHash });
    } catch (txErr) {
      // ANC-B01: a purged (testnet reset) or otherwise-unfindable tx throws "txnNotFound". Translate
      // it into operator guidance + the local root, then exit 1 cleanly — never a raw stack trace.
      const code = txErr?.data?.error || txErr?.message || String(txErr);
      console.error(
        `\n  Transaction ${txHash} not found on ${config.network} (${code}).` +
        `\n  It may have been purged after a testnet reset, or the network is unreachable.` +
        `\n  The local manifest root is ${localManifestRoot(ROOT) || "(unknown — run compute-root.mjs)"}.` +
        `\n  On testnet, re-anchor the current partition (compute-root.mjs + post-anchor.mjs) to mint a fresh tx.\n`
      );
      process.exit(1);
    }
    txObj = response.result;
    const memos = txObj.Memos || [];
    const anchorMemo = memos.find(m =>
      hexToString(m.Memo?.MemoType || "") === "repomesh-anchor-v1"
    );
    if (!anchorMemo) {
      console.error(
        `\n  No repomesh-anchor-v1 memo found in transaction ${txHash}.` +
        `\n  This tx exists on ${config.network} but is not a RepoMesh anchor (wrong tx hash?).\n`
      );
      process.exit(1);
    }
    memo = JSON.parse(hexToString(anchorMemo.Memo.MemoData));
  } finally {
    await client.disconnect();
  }

  // Parse range from "first..last" format
  const rangeParts = memo.rg && memo.rg !== "0" ? memo.rg.split("..") : null;
  const prevRoot = memo.pv && memo.pv !== "0" ? memo.pv : null;
  // Algo dispatch: the memo may declare its algo; fall back to v1 for legacy memos.
  const algo = memo.algo || "sha256-merkle-v1";

  console.log("  Memo decoded:");
  console.log(`    Version:      ${memo.v}`);
  console.log(`    Algo:         ${algo}`);
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

  const { events: partition, fellBack } = resolvePartition(events, memo.p);
  if (fellBack) {
    // ANC-B06: the `since:` boundary anchor marker is not in the local ledger, so the partition was
    // WIDENED to the full ledger. Warn loudly — a widened partition will produce a different root
    // than the anchor's, surfacing as a MISMATCH below rather than a silent wrong answer.
    console.warn(
      `\n  WARNING: partition boundary "${memo.p}" not found in the local ledger — ` +
      `falling back to the FULL ledger (${events.length} events). The recomputed root will not match ` +
      `the anchor unless the boundary anchor is present locally. Sync the ledger to the anchored state ` +
      `(the boundary AttestationPublished with timestamp ${memo.p.slice(6)}) before trusting a PASS.`
    );
  }
  const leaves = partition
    .map(ev => ev.signature?.canonicalHash)
    .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));

  console.log(`\n  Local partition "${memo.p}": ${partition.length} events, ${leaves.length} leaves`);

  if (leaves.length === 0) {
    console.error("  No valid canonical hashes in partition.");
    process.exit(1);
  }

  // 3. Recompute Merkle root using the declared algorithm.
  const localRoot = merkleRootForAlgo(leaves, algo);

  // 4. Recompute manifestHash from the canonical manifest base.
  const localRange = [leaves[0], leaves[leaves.length - 1]];
  const manifestBase = {
    v: MANIFEST_VERSION,
    algo,
    partitionId: memo.p,
    network: memo.n,
    prev: prevRoot,
    range: localRange,
    count: leaves.length,
    root: localRoot,
  };
  const localManifestHash = sha256hex(canonicalize(manifestBase));

  // 5. Run the full on-chain + binding verification (pure core).
  const verdict = verifyAnchorTx({
    tx: txObj,
    memo,
    localRoot,
    localManifestHash,
    leafCount: leaves.length,
    trustedAnchorAccounts: trustedAccounts,
  });

  // LEDGER-A-004: surface the on-chain ledger close-time (the trustworthy clock). Derived from
  // txObj.date (Ripple epoch seconds); this reference command previously never read it.
  const closeTime = rippleDateToCloseTime(txObj?.date);
  console.log(`\n  On-chain tx checks:`);
  console.log(`    validated:           ${verdict.checks.validated ? "OK" : "FAIL"}`);
  console.log(`    TransactionResult:   ${verdict.checks.tesSUCCESS ? "tesSUCCESS" : `FAIL (${txObj?.meta?.TransactionResult})`}`);
  console.log(`    Account allowlisted: ${verdict.checks.account ? `OK (${txObj?.Account})` : `FAIL (${txObj?.Account})`}`);
  console.log(`    On-chain close-time: ${closeTime ? closeTime.toISOString() + " (trusted clock)" : "(unavailable — txObj.date absent)"}`);
  console.log(`\n  Root check:`);
  console.log(`    Local:  ${localRoot}`);
  console.log(`    Memo:   ${memo.r}`);
  console.log(`    ${verdict.checks.root ? "MATCH" : "MISMATCH"}`);
  console.log(`\n  Manifest hash check:`);
  console.log(`    Local:  ${localManifestHash}`);
  console.log(`    Memo:   ${memo.h}`);
  console.log(`    ${verdict.checks.manifestHash ? "MATCH" : "MISMATCH"}`);

  if (!verdict.ok) {
    console.error(`\n  Verification: FAIL — ${verdict.reason}\n`);
    process.exit(1);
  }

  // 6. Chain link validation (informational)
  if (prevRoot) {
    console.log(`\n  Chain link: prev=${prevRoot.slice(0, 16)}...`);
    const prevAnchor = [...events].reverse().find(ev => {
      if (ev.type !== "AttestationPublished") return false;
      const notes = ev.notes || "";
      try {
        const lastNewline = notes.lastIndexOf("\n");
        if (lastNewline !== -1) {
          const jsonStr = notes.slice(lastNewline + 1);
          const parsed = JSON.parse(jsonStr);
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

// Only run main() when invoked as a script, not when imported by tests.
const INVOKED_AS_SCRIPT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPathSafe(import.meta.url);
function fileURLToPathSafe(u) {
  try { return path.resolve(new URL(u).pathname.replace(/^\/([A-Za-z]:)/, "$1")); } catch { return ""; }
}
if (INVOKED_AS_SCRIPT) {
  main().catch(e => { console.error(e); process.exit(1); });
}
