// FT-O-002 — machine-readable network STATUS endpoint (status.json).
//
// status.json is the single artifact an EXTERNAL system can poll to learn whether the
// repomesh trust substrate is healthy. Today a frozen ledger / stale anchor is only visible
// in Actions logs; this endpoint surfaces it as a stable, machine-readable rollup.
//
// These tests pin the contract of the PURE `buildStatus({...})` function (no disk I/O — it
// takes the already-loaded data sources in, exactly like build-pages' exported render fns).
// Determinism: the caller passes `now` in; buildStatus NEVER calls Date.now() itself, so the
// same inputs always produce the same status (mirrors how build-metrics threads time through).
//
// Load-bearing regressions pinned here:
//   (a) a fresh ledger (recent anchor) ⇒ ok:true, degraded:false, no reasons
//   (b) a stale-anchor fixture (last anchor older than the staleness threshold) ⇒
//       degraded:true with a frozen-ledger reason — the whole point of the endpoint
//   (c) a partition with txHash:null is counted as PENDING, never as anchored (Stage-C
//       anchored=finality semantics: on-chain anchored ONLY when a real txHash exists)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStatus, STALE_ANCHOR_DAYS } from "../build-status.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW_ISO = "2026-06-21T00:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const iso = (ms) => new Date(ms).toISOString();

// --- Shared healthy fixtures -------------------------------------------------

// Clean trust set (no disputes) — used for the OK/healthy-path assertions, since a disputed
// release is itself a legitimate degradation signal (see the dedicated disputed test below).
const trust = [
  { repo: "org/a", version: "1.0.0", verdict: "VERIFIED", timestamp: "2026-06-10T00:00:00.000Z" },
  { repo: "org/a", version: "1.0.1", verdict: "PARTIAL", timestamp: "2026-06-12T00:00:00.000Z" },
  { repo: "org/b", version: "2.0.0", verdict: "VERIFIED", timestamp: "2026-06-13T00:00:00.000Z" },
];
// Same set but with a DISPUTED release — used only where we assert the disputed signal.
const trustWithDispute = [
  ...trust.slice(0, 2),
  { repo: "org/b", version: "2.0.0", verdict: "DISPUTED", timestamp: "2026-06-13T00:00:00.000Z" },
];

// A ledger whose last event AND last anchor are recent (1 day ago) ⇒ fresh.
const freshLedgerEvents = [
  { type: "ReleasePublished", timestamp: iso(NOW_MS - 5 * DAY) },
  { type: "AttestationPublished", timestamp: iso(NOW_MS - 2 * DAY) },
];
const freshAnchors = {
  partitions: [
    // recently anchored on-chain
    { partitionId: "p-genesis", count: 8, txHash: "ABC123", anchoredAt: iso(NOW_MS - 1 * DAY) },
    // committed but not yet on-chain ⇒ pending
    { partitionId: "p-all", count: 47, txHash: null },
  ],
  releaseAnchors: {},
};

// --- (a) fresh ledger ⇒ ok ---------------------------------------------------

describe("FT-O-002 buildStatus — healthy network", () => {
  it("reports ok:true / degraded:false with no reasons when the ledger is fresh", () => {
    const s = buildStatus({
      now: NOW_ISO,
      trust,
      anchors: freshAnchors,
      ledgerEvents: freshLedgerEvents,
    });
    assert.equal(s.ok, true);
    assert.equal(s.degraded, false);
    assert.deepEqual(s.reasons, []);
  });

  it("threads the passed-in timestamp through to generatedAt (no Date.now())", () => {
    const s = buildStatus({ now: NOW_ISO, trust, anchors: freshAnchors, ledgerEvents: freshLedgerEvents });
    assert.equal(s.generatedAt, NOW_ISO);
  });

  it("is deterministic — identical inputs produce identical output", () => {
    const a = buildStatus({ now: NOW_ISO, trust, anchors: freshAnchors, ledgerEvents: freshLedgerEvents });
    const b = buildStatus({ now: NOW_ISO, trust, anchors: freshAnchors, ledgerEvents: freshLedgerEvents });
    assert.deepEqual(a, b);
  });

  it("summarizes ledger health: total events + last event timestamp", () => {
    const s = buildStatus({ now: NOW_ISO, trust, anchors: freshAnchors, ledgerEvents: freshLedgerEvents });
    assert.equal(s.ledger.totalEvents, 2);
    assert.equal(s.ledger.lastEventAt, iso(NOW_MS - 2 * DAY));
    assert.equal(s.ledger.stale, false);
  });

  it("summarizes trust verdicts by count + tracked repo count", () => {
    const s = buildStatus({ now: NOW_ISO, trust: trustWithDispute, anchors: freshAnchors, ledgerEvents: freshLedgerEvents });
    assert.equal(s.trust.verified, 1);
    assert.equal(s.trust.partial, 1);
    assert.equal(s.trust.disputed, 1);
    assert.equal(s.trust.releases, 3);
    assert.equal(s.trust.repos, 2); // org/a, org/b
  });

  it("a disputed release degrades the network with a reason", () => {
    const s = buildStatus({ now: NOW_ISO, trust: trustWithDispute, anchors: freshAnchors, ledgerEvents: freshLedgerEvents });
    assert.equal(s.degraded, true);
    assert.ok(s.reasons.some((r) => /disput/i.test(r)), `expected a disputed reason, got: ${JSON.stringify(s.reasons)}`);
  });
});

// --- (b) stale anchor ⇒ degraded + frozen-ledger reason ----------------------

describe("FT-O-002 buildStatus — stale anchor (frozen ledger signal)", () => {
  it("flags degraded:true with a frozen-ledger reason when the last anchor is too old", () => {
    const staleAnchors = {
      partitions: [
        // last on-chain anchor is well beyond the staleness threshold
        { partitionId: "p-genesis", count: 8, txHash: "ABC123", anchoredAt: iso(NOW_MS - (STALE_ANCHOR_DAYS + 10) * DAY) },
      ],
      releaseAnchors: {},
    };
    const s = buildStatus({
      now: NOW_ISO,
      trust,
      anchors: staleAnchors,
      ledgerEvents: freshLedgerEvents,
    });
    assert.equal(s.ok, false);
    assert.equal(s.degraded, true);
    assert.equal(s.ledger.stale, true);
    assert.ok(
      s.reasons.some((r) => /stale|frozen|anchor/i.test(r)),
      `expected a frozen/stale-anchor reason, got: ${JSON.stringify(s.reasons)}`,
    );
  });

  it("a brand-new anchor (just inside the threshold) is NOT stale", () => {
    const justFresh = {
      partitions: [{ partitionId: "p", count: 1, txHash: "X", anchoredAt: iso(NOW_MS - (STALE_ANCHOR_DAYS - 1) * DAY) }],
      releaseAnchors: {},
    };
    const s = buildStatus({ now: NOW_ISO, trust, anchors: justFresh, ledgerEvents: freshLedgerEvents });
    assert.equal(s.ledger.stale, false);
    assert.equal(s.ok, true);
  });
});

// --- (c) txHash:null ⇒ pending, never anchored -------------------------------

describe("FT-O-002 buildStatus — anchor finality semantics (Stage C)", () => {
  it("counts a txHash:null partition as pending, NOT anchored", () => {
    const anchors = {
      partitions: [
        { partitionId: "on-chain", count: 8, txHash: "REALHASH", anchoredAt: iso(NOW_MS - 1 * DAY) },
        { partitionId: "pending-1", count: 47, txHash: null },
        { partitionId: "pending-2", count: 3, txHash: null },
      ],
      releaseAnchors: {},
    };
    const s = buildStatus({ now: NOW_ISO, trust, anchors, ledgerEvents: freshLedgerEvents });
    assert.equal(s.anchors.partitions, 3, "total partition count");
    assert.equal(s.anchors.anchored, 1, "only the real-txHash partition is anchored");
    assert.equal(s.anchors.pending, 2, "both txHash:null partitions are pending");
  });
});

// --- Fail-safe: missing/partial data ⇒ degraded, never a crash ---------------

describe("FT-O-002 buildStatus — fail-safe on missing data", () => {
  it("an empty ledger (0 events) ⇒ degraded with a reason, no throw", () => {
    const s = buildStatus({ now: NOW_ISO, trust, anchors: freshAnchors, ledgerEvents: [] });
    assert.equal(s.ledger.totalEvents, 0);
    assert.equal(s.degraded, true);
    assert.ok(s.reasons.length > 0);
  });

  it("missing/undefined sources do not throw and yield a degraded status", () => {
    let s;
    assert.doesNotThrow(() => {
      s = buildStatus({ now: NOW_ISO });
    });
    assert.equal(s.degraded, true);
    assert.equal(s.ok, false);
    assert.ok(Array.isArray(s.reasons) && s.reasons.length > 0);
    // shape is still complete (machine-readable contract holds even on bad input)
    assert.ok(s.ledger && s.trust && s.anchors);
  });

  it("non-array trust / non-object anchors are coerced, not crashed on", () => {
    let s;
    assert.doesNotThrow(() => {
      s = buildStatus({ now: NOW_ISO, trust: null, anchors: "oops", ledgerEvents: 42 });
    });
    assert.equal(s.trust.releases, 0);
    assert.equal(s.anchors.partitions, 0);
    assert.equal(s.ledger.totalEvents, 0);
  });
});
