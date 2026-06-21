// Anchor domain — Stage C humanization amend tests (write-path: post-anchor + emit-anchor-event +
// compute-root). These probe the LEGIBILITY/CORRECTNESS fixes that DON'T change signing/posting
// behavior:
//
//   STGB-ANCHOR-001  emit-anchor-event derives the human-facing explorer URI from the event's
//                    NETWORK (testnet -> testnet.xrpl.org, mainnet -> livenet.xrpl.org) instead of
//                    hardcoding testnet — so a mainnet anchor never bakes a dead testnet link into the
//                    immutable artifact (ANC-B07 migration).
//   STGB-ANCHOR-004  emit-anchor-event cross-checks anchor-result.json (on-chain) vs
//                    partition-root.json (local recompute) describe the SAME partition
//                    (root/manifestHash/partitionId) before emitting — defense-in-depth against a
//                    compute-root re-run binding a fresh partition to a stale txHash.
//   STGB-ANCHOR-002  post-anchor validates the XRPL_SEED shape before connecting (clear message on a
//                    malformed seed), and wraps connect/seed failures with structured recovery
//                    guidance — parity with verify-anchor's read-path.
//   STGB-ANCHOR-005  post-anchor surfaces the on-chain ledger close-time (close_time_iso) +
//                    ledger_index in the receipt — the trusted clock.
//   STGB-ANCHOR-003  emit-anchor-event wraps a bad-PEM sign failure with a structured message
//                    (asserted at the source level — no real key in unit tests).
//   STGB-ANCHOR-006  compute-root documents the since-last cadence + warns on an oversized partition.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  explorerTxUri,
  assertSamePartition,
} from "../scripts/emit-anchor-event.mjs";
import {
  validateSeedShape,
  extractCloseTime,
  extractLedgerIndex,
} from "../scripts/post-anchor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMIT = path.join(HERE, "..", "scripts", "emit-anchor-event.mjs");
const POST = path.join(HERE, "..", "scripts", "post-anchor.mjs");
const COMPUTE = path.join(HERE, "..", "scripts", "compute-root.mjs");

// ── STGB-ANCHOR-001 — network-aware explorer URI ──────────────────────────────────────────────────
describe("STGB-ANCHOR-001 explorerTxUri derives host from network", () => {
  const TX = "ABC123";

  it("testnet -> testnet.xrpl.org (unchanged behavior for current anchors)", () => {
    assert.equal(explorerTxUri("testnet", TX), `https://testnet.xrpl.org/transactions/${TX}`);
  });

  it("mainnet -> livenet.xrpl.org (NOT the dead testnet host) — the ANC-B07 fix", () => {
    const uri = explorerTxUri("mainnet", TX);
    assert.ok(/livenet\.xrpl\.org/.test(uri), `mainnet must use livenet.xrpl.org, got: ${uri}`);
    assert.ok(!/testnet\.xrpl\.org/.test(uri), "a mainnet anchor must NEVER bake a testnet link");
    assert.equal(uri, `https://livenet.xrpl.org/transactions/${TX}`);
  });

  it("devnet -> devnet.xrpl.org", () => {
    assert.equal(explorerTxUri("devnet", TX), `https://devnet.xrpl.org/transactions/${TX}`);
  });

  it("an unknown/missing network falls back to the network-tagged generic host (never silently testnet)", () => {
    // The point of the fix is that the URI is never WRONGLY a live-looking testnet link. For an
    // unrecognized network we must not pretend it is testnet; fall back to a host derived from the
    // network token itself.
    const uri = explorerTxUri("customnet", TX);
    assert.ok(/customnet\.xrpl\.org/.test(uri), `unknown network must derive its own host, got: ${uri}`);
    assert.ok(!/^https:\/\/testnet\.xrpl\.org/.test(uri), "must not default to testnet");
  });
});

// ── STGB-ANCHOR-004 — partition cross-check guard ────────────────────────────────────────────────
describe("STGB-ANCHOR-004 assertSamePartition cross-checks tx vs local recompute", () => {
  const result = {
    ok: true,
    network: "testnet",
    txHash: "DEAD",
    partitionId: "since:2026-03-01T00:00:00.000Z",
    root: "a".repeat(64),
    manifestHash: "b".repeat(64),
  };
  const rootData = {
    partitionId: "since:2026-03-01T00:00:00.000Z",
    root: "a".repeat(64),
    manifestHash: "b".repeat(64),
  };

  it("passes (ok:true, no throw) when both describe the SAME partition", () => {
    const r = assertSamePartition(result, rootData);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("FAILS on a root mismatch — a stale txHash bound to a freshly recomputed partition", () => {
    const r = assertSamePartition(result, { ...rootData, root: "c".repeat(64) });
    assert.equal(r.ok, false);
    assert.match(r.reason || "", /root/i);
  });

  it("FAILS on a manifestHash mismatch", () => {
    const r = assertSamePartition(result, { ...rootData, manifestHash: "d".repeat(64) });
    assert.equal(r.ok, false);
    assert.match(r.reason || "", /manifest/i);
  });

  it("FAILS on a partitionId mismatch", () => {
    const r = assertSamePartition(result, { ...rootData, partitionId: "since:2026-04-01T00:00:00.000Z" });
    assert.equal(r.ok, false);
    assert.match(r.reason || "", /partition/i);
  });

  it("the failure reason names BOTH values so the operator can see the drift", () => {
    const r = assertSamePartition(result, { ...rootData, root: "c".repeat(64) });
    assert.ok(r.reason.includes("a".repeat(64)) && r.reason.includes("c".repeat(64)),
      "reason must surface the on-chain vs local values for debugging");
  });
});

// ── STGB-ANCHOR-002 — seed-shape validation ──────────────────────────────────────────────────────
describe("STGB-ANCHOR-002 validateSeedShape", () => {
  it("accepts a well-formed classic XRPL seed (base58, starts with 's')", () => {
    const r = validateSeedShape("sEdTM1uX8pu2do5XvTnutH6HsouMaM2");
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("rejects an empty / missing seed with a clear message", () => {
    assert.equal(validateSeedShape("").ok, false);
    assert.equal(validateSeedShape(undefined).ok, false);
    assert.match(validateSeedShape("").reason || "", /seed/i);
  });

  it("rejects a seed that does not start with 's' (XRPL family seed prefix)", () => {
    const r = validateSeedShape("rNotASeedButAnAddress00000000000");
    assert.equal(r.ok, false);
    assert.match(r.reason || "", /seed/i);
  });

  it("rejects a seed with non-base58 characters (0, O, I, l)", () => {
    const r = validateSeedShape("s0OIl0OIl0OIl0OIl0OIl0OIl");
    assert.equal(r.ok, false);
  });

  it("rejects an obviously-too-short token", () => {
    assert.equal(validateSeedShape("sXyz").ok, false);
  });
});

// ── STGB-ANCHOR-005 — close-time + ledger_index extraction ───────────────────────────────────────
describe("STGB-ANCHOR-005 extractCloseTime / extractLedgerIndex from submitAndWait result", () => {
  // submitAndWait returns { result: { ... , date, ledger_index, validated, meta, hash } }.
  const close_time_iso = (() => {
    // Ripple epoch seconds for a known instant: choose 0 -> 2000-01-01T00:00:00.000Z
    return new Date(946684800 * 1000).toISOString();
  })();

  it("extractCloseTime converts a Ripple-epoch date to an ISO string (the trusted clock)", () => {
    const res = { result: { date: 0 } };
    assert.equal(extractCloseTime(res), "2000-01-01T00:00:00.000Z");
  });

  it("extractCloseTime returns null when date is absent (never throws)", () => {
    assert.equal(extractCloseTime({ result: {} }), null);
    assert.equal(extractCloseTime({}), null);
    assert.equal(extractCloseTime(undefined), null);
  });

  it("extractLedgerIndex reads result.ledger_index", () => {
    assert.equal(extractLedgerIndex({ result: { ledger_index: 12345 } }), 12345);
  });

  it("extractLedgerIndex returns null when absent", () => {
    assert.equal(extractLedgerIndex({ result: {} }), null);
    assert.equal(extractLedgerIndex(undefined), null);
  });

  it("close_time_iso fixture sanity (Ripple epoch alignment)", () => {
    assert.equal(close_time_iso, "2000-01-01T00:00:00.000Z");
  });
});

// ── Source-level assertions (no live XRPL / no real key in unit tests) ────────────────────────────
describe("STGB-ANCHOR-002 post-anchor structured connect/seed failures (source-level)", () => {
  const src = fs.readFileSync(POST, "utf8");
  it("validates the seed shape before connecting", () => {
    assert.ok(/validateSeedShape/.test(src), "must call validateSeedShape on XRPL_SEED");
  });
  it("wraps a connect failure with recovery guidance (parity with verify-anchor)", () => {
    assert.ok(/Could not connect to the XRPL network/i.test(src),
      "an unreachable rippled endpoint must get a legible message, not a raw stack");
  });
  it("wraps a bad-seed Wallet.fromSeed failure with a clear message", () => {
    assert.ok(/check (the )?XRPL_SEED|invalid .*seed|seed.*invalid/i.test(src),
      "a bad seed must point the operator at XRPL_SEED");
  });
});

describe("STGB-ANCHOR-003 emit-anchor-event structured sign failure (source-level)", () => {
  const src = fs.readFileSync(EMIT, "utf8");
  it("wraps signEvent in a try/catch with a 'failed to sign' message that mentions the key", () => {
    assert.ok(/failed to sign/i.test(src), "must print a 'failed to sign' message");
    assert.ok(/check .*key|signing key/i.test(src), "must direct the operator to the signing key");
  });
});

describe("STGB-ANCHOR-005 post-anchor surfaces close-time + ledger_index in the receipt (source-level)", () => {
  const src = fs.readFileSync(POST, "utf8");
  it("writes close_time_iso into the anchor-result output", () => {
    assert.ok(/close_time_iso/.test(src), "the receipt must carry the on-chain close-time");
  });
  it("writes ledger_index into the anchor-result output", () => {
    assert.ok(/ledger_index/.test(src), "the receipt must carry the validating ledger index");
  });
});

describe("STGB-ANCHOR-001 emit-anchor-event uses explorerTxUri, not a hardcoded testnet host (source-level)", () => {
  const src = fs.readFileSync(EMIT, "utf8");
  it("no longer hardcodes the testnet explorer host in the artifact uri", () => {
    assert.ok(/explorerTxUri\s*\(/.test(src), "must build the artifact uri via explorerTxUri()");
    // The literal `https://testnet.xrpl.org/transactions/${...}` template must be gone from the
    // artifact construction (the host is now derived).
    assert.ok(!/`https:\/\/testnet\.xrpl\.org\/transactions\/\$\{/.test(src),
      "the hardcoded testnet explorer template must be removed from the artifact uri");
  });
});

describe("STGB-ANCHOR-004 emit-anchor-event runs the cross-check before emitting (source-level)", () => {
  const src = fs.readFileSync(EMIT, "utf8");
  it("calls assertSamePartition and exits non-zero on mismatch", () => {
    assert.ok(/assertSamePartition\s*\(/.test(src), "must invoke the cross-check guard");
    assert.ok(/process\.exit\(1\)/.test(src), "a mismatch must exit non-zero");
  });
});

describe("STGB-ANCHOR-006 compute-root documents the since-last cadence + oversized warning (source-level)", () => {
  const src = fs.readFileSync(COMPUTE, "utf8");
  it("documents the intended anchoring cadence", () => {
    assert.ok(/cadence/i.test(src), "must document the since-last anchoring cadence");
  });
  it("warns on an oversized partition", () => {
    assert.ok(/oversized|too large|large partition|partition.*large/i.test(src),
      "must warn on an oversized partition");
  });
});
