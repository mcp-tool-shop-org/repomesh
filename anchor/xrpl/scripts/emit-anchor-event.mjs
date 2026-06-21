#!/usr/bin/env node
//
// emit-anchor-event.mjs — turn a landed XRPL anchor (anchor-result.json) into a signed
// AttestationPublished event for the local ledger.
//
// Stage C legibility contract (this is a TRUST artifact, written once and IMMUTABLE in the ledger):
//   - the human-facing explorer URI follows the event's NETWORK, never a hardcoded testnet host
//     (STGB-ANCHOR-001 / ANC-B07): after a testnet->mainnet migration a mainnet anchor must not bake
//     a dead testnet link into the permanent record. The on-chain memo already self-describes its
//     network; the explorer link now follows it.
//   - before emitting we cross-check that the on-chain tx (anchor-result.json) and the local recompute
//     (partition-root.json) describe the SAME partition (STGB-ANCHOR-004), so a compute-root re-run
//     between post-anchor and emit can't bind a fresh partition to a stale txHash. (verify-anchor
//     catches this downstream as a MISMATCH; this is defense-in-depth + legibility, not a forge.)
//   - a bad signing key surfaces a structured "failed to sign" message, not a raw crypto stack
//     (STGB-ANCHOR-003).
import fs from "node:fs";
import path from "node:path";
import { buildAttestationEvent, signEvent, writeJsonlLine, loadSigningKeyFromEnvOrFile } from "../../../verifiers/lib/common.mjs";

// STGB-ANCHOR-001 — map a network token to its XRPL explorer host. The two production networks have
// distinct explorers (testnet.xrpl.org vs livenet.xrpl.org); any other recognized network uses its
// own subdomain. An UNKNOWN network derives a host from the (sanitized) token itself — it never
// silently falls back to testnet, because a live-looking testnet link in a non-testnet artifact is
// exactly the trap this fix removes. `livenet` is the canonical mainnet explorer subdomain.
const EXPLORER_HOSTS = {
  mainnet: "livenet.xrpl.org",
  testnet: "testnet.xrpl.org",
  devnet: "devnet.xrpl.org",
};
export function explorerHostFor(network) {
  const key = String(network || "").toLowerCase();
  if (EXPLORER_HOSTS[key]) return EXPLORER_HOSTS[key];
  // Unknown network: derive a subdomain from the sanitized token so the link self-describes the
  // network instead of masquerading as testnet. Empty/garbage tokens degrade to "unknown.xrpl.org".
  const safe = key.replace(/[^a-z0-9-]/g, "") || "unknown";
  return `${safe}.xrpl.org`;
}
export function explorerTxUri(network, txHash) {
  return `https://${explorerHostFor(network)}/transactions/${txHash}`;
}

// STGB-ANCHOR-004 — assert the on-chain tx (anchor-result.json) and the local recompute
// (partition-root.json) describe the SAME partition before we bind a signed event to the txHash.
// Returns { ok, reason } (pure — caller decides how to halt). A mismatch means compute-root was
// re-run between post-anchor and emit; emitting anyway would bind a fresh root to a stale txHash.
export function assertSamePartition(result, rootData) {
  const r = result || {};
  const d = rootData || {};
  if (r.root !== d.root) {
    return { ok: false, reason: `Merkle root mismatch — anchor-result.json root=${r.root} but partition-root.json root=${d.root}. compute-root.mjs was re-run after post-anchor; the txHash anchors a DIFFERENT partition than the one being emitted. Re-run post-anchor.mjs on the current partition, or restore the anchored partition-root.json.` };
  }
  if (r.manifestHash !== d.manifestHash) {
    return { ok: false, reason: `manifestHash mismatch — anchor-result.json h=${r.manifestHash} but partition-root.json h=${d.manifestHash}. The on-chain anchor and the local manifest disagree; do not emit. Re-run post-anchor.mjs on the current partition.` };
  }
  if (r.partitionId !== d.partitionId) {
    return { ok: false, reason: `partitionId mismatch — anchor-result.json partitionId=${r.partitionId} but partition-root.json partitionId=${d.partitionId}. The anchored partition and the local partition differ; do not emit.` };
  }
  return { ok: true };
}

function main() {
  const args = process.argv.slice(2);
  const sign = args.includes("--sign");
  const outIdx = args.indexOf("--output");
  const out = outIdx !== -1 ? args[outIdx + 1] : null;
  const keyId = process.env.REPOMESH_KEY_ID || "ci-repomesh-2026";
  const skIdx = args.indexOf("--signing-key");
  const signingKeyPath = skIdx !== -1 ? args[skIdx + 1] : null;

  const anchorDir = path.join(import.meta.dirname, "..");
  let result, rootData;
  try { result = JSON.parse(fs.readFileSync(path.join(anchorDir, "anchor-result.json"), "utf8")); } catch (e) { console.error("Failed to read anchor-result.json: " + e.message + "\n  Run post-anchor.mjs first to land the anchor on-chain."); process.exit(1); }
  try { rootData = JSON.parse(fs.readFileSync(path.join(anchorDir, "partition-root.json"), "utf8")); } catch (e) { console.error("Failed to read partition-root.json: " + e.message + "\n  Run compute-root.mjs first to compute the partition root."); process.exit(1); }

  if (!result.ok) { console.error("Anchor tx failed (anchor-result.json ok=false). Not emitting — re-run post-anchor.mjs until the submission lands tesSUCCESS."); process.exit(1); }

  // STGB-ANCHOR-004 — cross-check identity before binding the event to the txHash.
  const xcheck = assertSamePartition(result, rootData);
  if (!xcheck.ok) {
    console.error(`\n  Refusing to emit — on-chain tx and local recompute describe DIFFERENT partitions.\n  ${xcheck.reason}\n`);
    process.exit(1);
  }

  // STGB-ANCHOR-001 — the explorer link follows the network the anchor was posted on.
  const explorerUri = explorerTxUri(result.network, result.txHash);

  const notes = `ledger.anchor: pass — Partition anchored to XRPL ${result.network}\n${JSON.stringify({ txHash: result.txHash, network: result.network, walletAddress: result.walletAddress, partitionId: rootData.partitionId, partitionStart: rootData.partitionStart, partitionEnd: rootData.partitionEnd, eventCount: rootData.eventCount, merkleRoot: rootData.root, manifestHash: rootData.manifestHash, manifestPath: rootData.manifestPath || null, algo: rootData.algo, prev: rootData.prev || null, range: rootData.range || null, closeTimeIso: result.close_time_iso || null, ledgerIndex: result.ledger_index ?? null })}`;

  const artifacts = [{ name: `anchor-${rootData.partitionId}.json`, sha256: rootData.root, uri: explorerUri }];

  const ev = buildAttestationEvent({
    repo: "mcp-tool-shop-org/repomesh",
    version: `0.0.0-${rootData.partitionId.replace(/[^a-zA-Z0-9.-]/g, "-")}`,
    commit: "0000000",
    artifacts,
    attestations: [{ type: "ledger.anchor", uri: `xrpl:tx:${result.txHash}` }],
    notes
  });

  let signed;
  if (sign) {
    // STGB-ANCHOR-003 — a malformed PEM throws a raw crypto stack from crypto.sign. Wrap it with a
    // structured, recovery-pointing message so the operator knows it's the signing key, not the data.
    try {
      signed = signEvent(ev, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId);
    } catch (e) {
      console.error(`\n  failed to sign anchor event: ${e.message}\n  Check the signing key (env REPOMESH_SIGNING_KEY or --signing-key <path>); it must be a valid ed25519 private key in PEM form.\n`);
      process.exit(1);
    }
  } else {
    signed = ev;
  }
  if (out) writeJsonlLine(out, signed);
  console.log(`Anchor event emitted: partition=${rootData.partitionId} tx=${result.txHash} network=${result.network}`);
  console.log(`  Explorer: ${explorerUri}`);
  if (result.close_time_iso) console.log(`  On-chain close-time: ${result.close_time_iso} (trusted clock)`);
  if (out) console.log(`Written to: ${out}`);
}

// Only run main() when invoked as a script, not when imported by tests (importing must not read
// anchor-result.json or exit). Mirrors the guard in post-anchor.mjs / verify-anchor.mjs.
function fileURLToPathSafe(u) {
  try { return path.resolve(new URL(u).pathname.replace(/^\/([A-Za-z]:)/, "$1")); } catch { return ""; }
}
const INVOKED_AS_SCRIPT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPathSafe(import.meta.url);
if (INVOKED_AS_SCRIPT) {
  main();
}
