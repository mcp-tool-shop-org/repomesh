// verify-anchor — Verify an XRPL anchor transaction from anywhere.
// Fetches the tx from XRPL, recomputes the Merkle root from ledger data.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isRepoMeshCheckout } from "../mode.mjs";
import { fetchText, fetchJson } from "../http.mjs";
import {
  DEFAULT_LEDGER_URL, DEFAULT_ANCHOR_CONFIG_URL, BUNDLED_TRUSTED_ANCHOR_ACCOUNTS,
} from "../remote-defaults.mjs";
import { canonicalize } from "./canonicalize.mjs";
import { merkleRootForAlgo, isSupportedMerkleAlgo } from "./merkle.mjs";
import { parseStrictJson } from "./safe-json.mjs";
import { isDebug, debug as debugLog } from "../log.mjs";

const TRUST_FETCH_OPTS = { manualRedirect: true };

function hexToString(hex) { return Buffer.from(hex, "hex").toString("utf8"); }
function sha256hex(str) { return crypto.createHash("sha256").update(str, "utf8").digest("hex"); }

// B-FP-02: one indentation style (pretty, 2-space) for every --json exit path.
function emitJson(obj) { console.log(JSON.stringify(obj, null, 2)); }

function parseJsonlLines(lines) {
  const results = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { results.push(parseStrictJson(line)); }
    catch (e) { debugLog(`skipping malformed JSONL line: ${e.message}`); }
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
  const text = await fetchText(url, TRUST_FETCH_OPTS);
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

// Resolve the trusted XRPL anchor accounts. The bundled allowlist is a NON-REMOVABLE floor:
// a fetched/local config may ADD operator-pinned accounts but can never remove a bundled one (D4).
function resolveTrustedAccounts(config) {
  const bundled = new Set(BUNDLED_TRUSTED_ANCHOR_ACCOUNTS);
  const configured = Array.isArray(config?.trustedAnchorAccounts) ? config.trustedAnchorAccounts : null;
  if (!configured) return bundled;
  // Union with bundled: config can add operator-pinned accounts, but every bundled account
  // stays trusted regardless of what the (possibly remote/untrusted) config says.
  return new Set([...bundled, ...configured]);
}

// Default client factory (real xrpl). Lazy import so tests that inject _clientFactory
// don't need the xrpl dependency loaded.
async function defaultClientFactory(wsUrl) {
  const xrpl = (await import("xrpl")).default;
  return new xrpl.Client(wsUrl);
}

// Convert an XRPL Ripple-epoch close-time (seconds since 2000-01-01T00:00:00Z) to a JS Date.
// Ripple epoch offset from the Unix epoch is 946684800 seconds (contract §5.2). Returns null
// when the field is missing/non-numeric so the caller can fall back to the offline ladder.
function rippleDateToCloseTime(rippleEpochSeconds) {
  if (typeof rippleEpochSeconds !== "number" || !Number.isFinite(rippleEpochSeconds)) return null;
  const d = new Date((rippleEpochSeconds + 946684800) * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Fetch + structurally validate an anchor tx from XRPL. Returns:
//   { ok, memo, account, validated, txResult, closeTime, reason }
// Enforces: tx.validated===true, meta.TransactionResult==='tesSUCCESS',
//           Account ∈ trustedAccounts. (ANC-001, ANC-002, CLI-008)
// closeTime (key-lifecycle rung-1, contract §5.2): the XRPL ledger close-time of the tx, derived
// from txData.date (Ripple epoch seconds). This is the only TRUSTWORTHY clock for a compromise
// decision — threaded out via verifyAnchorTx so the CLI online resolver can use it as 'xrpl'.
async function fetchAndValidateTx({ tx, wsUrl, trustedAccounts, clientFactory }) {
  const factory = clientFactory || defaultClientFactory;
  let client;
  let txData;
  try {
    client = await factory(wsUrl);
    await client.connect();
    const response = await client.request({ command: "tx", transaction: tx });
    txData = response.result;
  } catch (e) {
    // B-DEG-01: a connect/request failure means we could not reach XRPL — that is a transient
    // NETWORK condition, not a verdict. Surface it as a clean, recognizable network error with
    // recovery guidance (mirroring verify-release's network hint) instead of leaking a raw
    // rippled/websocket stack. networkError lets the caller print a friendly Hint.
    const err = new Error(`Could not reach the XRPL ${wsUrl ? `endpoint (${wsUrl})` : "network"}. The anchor could not be verified on-chain. (${e.message})`);
    err.networkError = true;
    err.hint = "Check your network connection and retry. The XRPL endpoint may be temporarily unreachable; set --ws-url to a reachable node if the default is down.";
    throw err;
  } finally {
    try { if (client) await client.disconnect(); } catch { /* ignore */ }
  }

  // ANC-002: only an XRPL-validated (closed-ledger) tx counts.
  if (txData.validated !== true) {
    return { ok: false, reason: "transaction is not validated (not in a closed ledger)" };
  }
  // tesSUCCESS: a tx can be in a validated ledger but have failed.
  const txResult = txData.meta?.TransactionResult ?? txData.meta?.delivered_amount ?? txData.metaData?.TransactionResult;
  const resultCode = txData.meta?.TransactionResult ?? txData.metaData?.TransactionResult;
  if (resultCode !== "tesSUCCESS") {
    return { ok: false, reason: `transaction result is ${resultCode || "(unknown)"}, expected tesSUCCESS` };
  }
  // ANC-001: the submitting account must be a trusted anchor account.
  const account = txData.Account;
  if (!account || !trustedAccounts.has(account)) {
    return { ok: false, reason: `tx Account ${account || "(none)"} is not in the trusted anchor allowlist` };
  }

  const memos = txData.Memos || [];
  const anchorMemo = memos.find(m => {
    try { return hexToString(m.Memo?.MemoType || "") === "repomesh-anchor-v1"; }
    catch { return false; }
  });
  if (!anchorMemo) return { ok: false, reason: "no repomesh-anchor-v1 memo in tx" };

  let memo;
  try { memo = parseStrictJson(hexToString(anchorMemo.Memo.MemoData)); }
  catch (e) { return { ok: false, reason: `failed to parse memo data: ${e.message}` }; }

  // Validate memo shape (untrusted XRPL data).
  if (
    typeof memo !== "object" || memo === null ||
    typeof memo.p !== "string" || typeof memo.r !== "string" ||
    typeof memo.h !== "string" || typeof memo.c !== "number" ||
    (memo.n !== undefined && typeof memo.n !== "string") ||
    (memo.pv !== undefined && typeof memo.pv !== "string")
  ) {
    return { ok: false, reason: "invalid memo structure: missing or wrongly-typed fields" };
  }

  // closeTime (contract §5.2): the validated tx's ledger close-time, the trustworthy clock for
  // the key-lifecycle compromise gate. null when txData.date is absent/non-numeric.
  const closeTime = rippleDateToCloseTime(txData.date);

  return { ok: true, memo, account, validated: true, txResult, closeTime };
}

/**
 * Programmatic helper used by verify-release. Verifies an anchor tx on-chain and
 * (optionally) that its memo matches expected root/manifestHash/count. Returns
 * { ok, reason, account, memo, closeTime }.
 *
 * closeTime (contract §5.2 rung-1): the XRPL ledger close-time of the anchor tx, threaded out
 * so the key-lifecycle online resolver can use the trusted on-chain clock ('xrpl' source). It is
 * present on the success result only; offline / failed verification yields no closeTime.
 */
export async function verifyAnchorTx({ tx, network, wsUrl, expect, opts, clientFactory }) {
  const resolvedWsUrl = wsUrl || WS_URLS[network] || WS_URLS.testnet;
  // Load config to discover trusted accounts (with bundled fallback).
  let config = null;
  try {
    if (opts?.local) {
      const p = path.join(opts.root || process.cwd(), "anchor", "xrpl", "config.json");
      config = parseStrictJson(fs.readFileSync(p, "utf8"));
    }
  } catch (e) { debugLog(e.message); }
  const trustedAccounts = resolveTrustedAccounts(config);

  const r = await fetchAndValidateTx({ tx, wsUrl: resolvedWsUrl, trustedAccounts, clientFactory: clientFactory || opts?._clientFactory });
  if (!r.ok) return r;

  // CLI-008: the on-chain memo must match the local manifest's root/hash/count.
  if (expect) {
    if (expect.r !== undefined && r.memo.r !== expect.r) return { ok: false, reason: "memo root does not match local manifest root" };
    if (expect.h !== undefined && r.memo.h !== expect.h) return { ok: false, reason: "memo manifestHash does not match local manifest" };
    if (expect.c !== undefined && r.memo.c !== expect.c) return { ok: false, reason: `memo count ${r.memo.c} != local count ${expect.c}` };
  }
  // closeTime: the trusted on-chain clock for the key-lifecycle rung-1 resolver (contract §5.2).
  return { ok: true, account: r.account, memo: r.memo, closeTime: r.closeTime ?? null };
}

// Walk the prev-root chain backwards through local anchors (CLI-007). Returns
// { verified, links, broken } — `verified` is true when every prev pointer
// resolves to a known anchor in the local ledger, OR the chain reaches genesis.
function walkPrevChain(events, startPrevRoot) {
  const anchorsByRoot = new Map();
  for (const ev of events) {
    if (ev.type !== "AttestationPublished") continue;
    const notes = ev.notes || "";
    const m = notes.match(/\n(\{.*?\})$/s);
    if (!m) continue;
    let meta;
    try { meta = parseStrictJson(m[1]); } catch { continue; }
    const root = meta.merkleRoot || meta.root;
    if (typeof root === "string") anchorsByRoot.set(root, meta);
  }
  const links = [];
  let cursor = startPrevRoot;
  const seen = new Set();
  while (cursor && cursor !== "0") {
    if (seen.has(cursor)) return { verified: false, links, broken: cursor, reason: "cycle in prev chain" };
    seen.add(cursor);
    const meta = anchorsByRoot.get(cursor);
    if (!meta) return { verified: false, links, broken: cursor, reason: "prev anchor not found in local ledger" };
    links.push(cursor);
    cursor = meta.prev && meta.prev !== "0" ? meta.prev : null;
  }
  return { verified: true, links, broken: null };
}

export async function verifyAnchor({ tx, network, wsUrl, ledgerUrl, json, _clientFactory }) {
  const local = isRepoMeshCheckout();
  const opts = { local, root: process.cwd(), ledgerUrl };

  // Resolve WS URL + config (for trusted accounts).
  let resolvedWsUrl = wsUrl;
  let resolvedNetwork = network || "testnet";
  let config = null;
  if (local) {
    try {
      config = parseStrictJson(fs.readFileSync(path.join(process.cwd(), "anchor", "xrpl", "config.json"), "utf8"));
      resolvedWsUrl = resolvedWsUrl || config.rippledUrl;
      resolvedNetwork = config.network || resolvedNetwork;
    } catch (e) { debugLog(e.message); }
  } else {
    try {
      config = await fetchJson(DEFAULT_ANCHOR_CONFIG_URL, TRUST_FETCH_OPTS);
      resolvedWsUrl = resolvedWsUrl || config.rippledUrl;
      resolvedNetwork = config.network || resolvedNetwork;
    } catch (e) { debugLog(e.message); }
  }
  if (!resolvedWsUrl) resolvedWsUrl = WS_URLS[resolvedNetwork] || WS_URLS.testnet;
  const trustedAccounts = resolveTrustedAccounts(config);

  if (!json) {
    console.log(`\nVerifying anchor: ${tx}`);
    console.log(`  Network: ${resolvedNetwork}`);
    console.log(`  XRPL:    ${resolvedWsUrl}`);
    console.log(`  Mode:    ${local ? "local (dev)" : "remote"}\n`);
  }

  // 1. Fetch + validate the tx (validated / tesSUCCESS / trusted Account).
  // B-DEG-01: a network/websocket failure is a transient OUTAGE, not a verdict. Catch it and
  // emit friendly recovery guidance (a Hint), never a raw rippled/websocket stack trace.
  let txr;
  try {
    txr = await fetchAndValidateTx({ tx, wsUrl: resolvedWsUrl, trustedAccounts, clientFactory: _clientFactory });
  } catch (e) {
    if (e.networkError) {
      const hint = e.hint || "Check your network connection and retry, or set --ws-url to a reachable XRPL node.";
      if (json) { emitJson({ ok: false, error: e.message, hint }); }
      else {
        console.error(`  ${e.message}`);
        console.error(`  Hint: ${hint}`);
      }
      process.exit(1);
    }
    throw e;
  }
  if (!txr.ok) {
    if (json) { emitJson({ ok: false, error: txr.reason }); }
    else { console.error(`  ${txr.reason}`); }
    process.exit(1);
  }
  const memo = txr.memo;
  const prevRoot = memo.pv && memo.pv !== "0" ? memo.pv : null;

  if (!json) {
    console.log("  Memo decoded:");
    console.log(`    Account:      ${txr.account} (trusted)`);
    console.log(`    Partition:    ${memo.p}`);
    console.log(`    Root:         ${memo.r}`);
    console.log(`    ManifestHash: ${memo.h}`);
    console.log(`    Count:        ${memo.c}`);
    console.log(`    Prev:         ${prevRoot || "(genesis)"}`);
  }

  // 2. Load ledger and partition.
  const events = await loadEvents(opts);
  if (events.length === 0) {
    if (json) { emitJson({ ok: false, error: "No ledger events", hint: "Verify the ledger URL, or run inside a RepoMesh checkout for local data." }); }
    else { console.error("\n  No ledger events found."); }
    process.exit(1);
  }

  const partition = partitionEvents(events, memo.p);
  const leaves = partition.map(ev => ev.signature?.canonicalHash)
    .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));

  if (!json) console.log(`\n  Local partition "${memo.p}": ${partition.length} events, ${leaves.length} leaves`);

  if (leaves.length === 0) {
    if (json) { emitJson({ ok: false, error: "No valid leaves", hint: `No canonical hashes found in partition "${memo.p}". Confirm the local ledger covers this anchor's partition.` }); }
    else { console.error("  No valid canonical hashes in partition."); }
    process.exit(1);
  }
  if (leaves.length !== memo.c) {
    if (json) { emitJson({ ok: false, error: `Count mismatch: local=${leaves.length}, anchor=${memo.c}`, hint: "Your local ledger partition has a different event count than the anchor pinned. Sync your ledger clone to the anchored state." }); }
    else { console.error(`  Event count mismatch: local=${leaves.length}, anchor=${memo.c}`); }
    process.exit(1);
  }

  // 3. Recompute Merkle root (algo-dispatched v1/v2).
  // B-FP-01: a future/unknown algo means THIS CLI can't recompute the root — that is an
  // "upgrade the CLI" situation, distinct from a root MISMATCH (which implies tampering).
  const manifestAlgo = memo.algo || "sha256-merkle-v1";
  if (!isSupportedMerkleAlgo(manifestAlgo)) {
    const error = `unsupported merkle algo ${manifestAlgo} — upgrade CLI`;
    const hint = `This anchor uses merkle algorithm '${manifestAlgo}', which this version of repomesh cannot recompute. Upgrade: npm install -g @mcptoolshop/repomesh@latest`;
    if (json) { emitJson({ ok: false, error, hint, algo: manifestAlgo, unsupportedAlgo: true }); }
    else {
      console.error(`\n  Root check: ${error}`);
      console.error(`  Hint: ${hint}`);
    }
    process.exit(1);
  }
  const localRoot = merkleRootForAlgo(leaves, manifestAlgo);
  const rootMatch = localRoot === memo.r;
  if (!json) {
    console.log(`\n  Root check (${manifestAlgo}):`);
    console.log(`    Local:  ${localRoot}`);
    console.log(`    Anchor: ${memo.r}`);
    console.log(`    ${rootMatch ? "MATCH" : "MISMATCH"}`);
  }
  if (!rootMatch) {
    if (json) { emitJson({ ok: false, error: "Root mismatch", local: localRoot, anchor: memo.r, hint: "The local ledger does not reproduce the anchored merkle root. The ledger may have been altered, or your clone is out of sync. Do not trust this anchor." }); }
    else { console.error("  Root MISMATCH"); }
    process.exit(1);
  }

  // 4. Recompute manifestHash.
  const localRange = [leaves[0], leaves[leaves.length - 1]];
  const manifestBase = {
    v: 1, algo: manifestAlgo, partitionId: memo.p,
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
    if (json) { emitJson({ ok: false, error: "ManifestHash mismatch", local: localManifestHash, anchor: memo.h, hint: "The recomputed manifest hash does not match the on-chain memo. The anchor metadata does not describe your local ledger; do not trust this anchor." }); }
    else { console.error("  ManifestHash MISMATCH"); }
    process.exit(1);
  }

  // 5. CLI-007: walk + VALIDATE the prev-root chain (not just print it).
  const chain = walkPrevChain(events, prevRoot);
  if (!json) {
    if (!prevRoot) {
      console.log(`\n  Chain link: genesis (no prev)`);
    } else if (chain.verified) {
      console.log(`\n  Chain link: VERIFIED (${chain.links.length} prior anchor(s) resolved back toward genesis)`);
    } else {
      console.log(`\n  Chain link: UNVERIFIED — ${chain.reason} (broken at ${chain.broken?.slice(0, 16)}...)`);
      console.log(`    Note: prev anchors may be pruned from a partial local clone; full continuity needs the complete ledger.`);
    }
  }

  const result = {
    ok: true, tx, network: resolvedNetwork, account: txr.account,
    partition: memo.p, root: localRoot, manifestHash: localManifestHash,
    count: leaves.length, prevRoot, algo: manifestAlgo,
    chainVerified: prevRoot ? chain.verified : true,
    ...(prevRoot && !chain.verified ? { chainReason: chain.reason } : {}),
  };

  if (json) { emitJson(result); }
  else { console.log(`\n  Verification: PASS\n`); }
}
