// Regression tests for the shared key-lifecycle predicate + trusted-time resolver
// (contract §5, §9). These are the BUG'S regression: a compromised-but-still-listed key
// scored full integrity because every site did an UNTIMED maintainers.find(). These tests
// pin the §9 matrix (1-5) against the predicate plus the resolver ladder.
//
// Test-first: each assertion encodes the CONTRACT'S required behavior, not the pre-fix
// behavior. On the pre-fix code path (no predicate; key resolved untimed) the compromise +
// rotation cases would all score VALID — these tests turn that into RED.
//
// This file imports the verifiers/lib copy. packages/repomesh-cli/tests/key-window.test.mjs
// is its byte-identical mirror (except the import path line).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  keyWindow,
  isKeyValidForSignature,
  resolveTrustedSignatureTimeSync,
  resolveTrustedSignatureTime,
  deriveKeyWindowConstraints,
  __deriveLegacyForTests,
  mergeStricterWindow,
} from "../src/verify/key-window.mjs";

// --- Fixtures -----------------------------------------------------------------------------

const HASH_A = "a".repeat(64); // ev leaf
const HASH_B = "b".repeat(64); // a different ev leaf (unanchored)

// A maintainer with NO window fields (grandfathered).
const GRANDFATHERED = { keyId: "mike-legacy", publicKey: "PK-legacy" };

// A compromise-revoked key with an explicit invalidity date C.
const C = "2026-06-18T00:00:00Z";
const COMPROMISED = {
  keyId: "mike-2026-01",
  publicKey: "PK-1",
  revokedAt: "2026-06-20T09:00:00Z",
  revocationReason: "compromise",
  invalidAfter: C,
};

// A routine-rotation key: validUntil=R, reason rotation. Past signatures stay valid.
const R = "2026-06-14T12:00:00Z";
const ROTATED = {
  keyId: "mike-2026-01",
  publicKey: "PK-1",
  validUntil: R,
  revokedAt: R,
  revocationReason: "rotation",
};

// The NEW key minted by that rotation — a different, currently-valid key on the same node.
const NEW_KEY = {
  keyId: "mike-2026-06",
  publicKey: "PK-2",
  validFrom: R,
};

// Build an event with a given self-timestamp and leaf canonicalHash.
function ev({ timestamp, leaf = HASH_A, keyId = "mike-2026-01" }) {
  return {
    type: "ReleasePublished",
    repo: "mcp-tool-shop-org/foo",
    timestamp,
    signature: { alg: "ed25519", keyId, value: "sig", canonicalHash: leaf },
  };
}

// A bundled-trusted anchor AttestationPublished event with a known timestamp. Its timestamp is
// the trusted offline clock (rung-2 'anchor-event'). __txHash/__network feed the async rung-1.
function anchorEvent({ timestamp, txHash = "TX-1", network = "testnet" }) {
  return {
    type: "AttestationPublished",
    repo: "mcp-tool-shop-org/repomesh-xrpl-anchor",
    timestamp,
    attestations: [{ type: "ledger.anchor", result: "pass" }],
    __txHash: txHash,
    __network: network,
    signature: { alg: "ed25519", keyId: "anchor-key", value: "sig", canonicalHash: "c".repeat(64) },
  };
}

// ctx that anchors HASH_A to a TRUSTED anchor with the given timestamp. HASH_B stays unanchored.
function ctxWithTrustedAnchor(anchorTs, { trusted = true, txHash = "TX-1", network = "testnet" } = {}) {
  const anchor = anchorEvent({ timestamp: anchorTs, txHash, network });
  return {
    findEarliestAnchorForLeaf: (leaf) => (leaf === HASH_A ? { anchor } : null),
    isBundledTrustedAnchor: () => trusted,
  };
}

// --- §9.1  Grandfather: a window-less maintainer is ALWAYS valid (today's behavior) --------

describe("§9.1 grandfather", () => {
  it("keyWindow reports a window-less maintainer as NOT windowed", () => {
    const w = keyWindow(GRANDFATHERED);
    assert.equal(w.isWindowed, false);
    assert.equal(w.validFrom, null);
    assert.equal(w.revokedAt, null);
  });

  it("a window-less maintainer verifies VALID regardless of trusted time (or no time)", () => {
    // No time at all.
    assert.deepEqual(
      isKeyValidForSignature(GRANDFATHERED, { time: null, provable: false, source: "none" }),
      { valid: true, reason: null }
    );
    // An ancient self-time.
    assert.deepEqual(
      isKeyValidForSignature(GRANDFATHERED, { time: new Date("2000-01-01T00:00:00Z"), provable: false, source: "self" }),
      { valid: true, reason: null }
    );
    // A future provable time.
    assert.deepEqual(
      isKeyValidForSignature(GRANDFATHERED, { time: new Date("2999-01-01T00:00:00Z"), provable: true, source: "anchor-event" }),
      { valid: true, reason: null }
    );
  });
});

// --- §9.2  Compromise REJECTS provable >= invalidAfter -------------------------------------

describe("§9.2 compromise rejects post-compromise provable time", () => {
  it("a provable anchored time AT/AFTER invalidAfter is REJECTED", () => {
    const tt = { time: new Date("2026-06-19T00:00:00Z"), provable: true, source: "anchor-event" }; // > C
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.equal(dec.valid, false);
    assert.equal(dec.reason, "signature at/after compromise invalidity date");
  });

  it("a provable anchored time EXACTLY at invalidAfter is REJECTED (>= boundary)", () => {
    const tt = { time: new Date(C), provable: true, source: "anchor-event" };
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.equal(dec.valid, false);
    assert.equal(dec.reason, "signature at/after compromise invalidity date");
  });

  it("end-to-end via the resolver: an event anchored AFTER C is rejected", () => {
    const after = ev({ timestamp: "2026-06-10T00:00:00Z" }); // backdated self-time (untrustworthy)
    const ctx = ctxWithTrustedAnchor("2026-06-19T00:00:00Z"); // trusted anchor proves it AFTER C
    const tt = resolveTrustedSignatureTimeSync(after, ctx);
    assert.equal(tt.source, "anchor-event");
    assert.equal(tt.provable, true);
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.equal(dec.valid, false, "compromise must reject a provable post-C signature even with a backdated self-timestamp");
  });
});

// --- §9.3  Compromise KEEPS provably-old VALID --------------------------------------------

describe("§9.3 compromise keeps provably-old signatures valid", () => {
  it("a provable anchored time BEFORE invalidAfter is VALID", () => {
    const tt = { time: new Date("2026-06-17T00:00:00Z"), provable: true, source: "anchor-event" }; // < C
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.deepEqual(dec, { valid: true, reason: null });
  });

  it("end-to-end via the resolver: an event anchored BEFORE C stays VALID", () => {
    const old = ev({ timestamp: "2026-06-15T00:00:00Z" });
    const ctx = ctxWithTrustedAnchor("2026-06-17T00:00:00Z"); // trusted anchor proves it < C
    const tt = resolveTrustedSignatureTimeSync(old, ctx);
    assert.equal(tt.provable, true);
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.equal(dec.valid, true, "compromise must NOT retroactively kill a provably-old signature");
  });
});

// --- §9.4  Compromise REJECTS unprovable (self) -------------------------------------------

describe("§9.4 compromise rejects an unprovable (self) signature", () => {
  it("a self-asserted time BEFORE C but NOT provable is REJECTED", () => {
    const tt = { time: new Date("2026-06-17T00:00:00Z"), provable: false, source: "self" };
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.equal(dec.valid, false);
    assert.equal(dec.reason, "compromised key requires a provable (anchored) signature time");
  });

  it("end-to-end via the resolver: an UNANCHORED event self-claiming < C is rejected", () => {
    const unanchored = ev({ timestamp: "2026-06-17T00:00:00Z", leaf: HASH_B }); // no anchor for HASH_B
    const ctx = ctxWithTrustedAnchor("2026-06-17T00:00:00Z"); // anchors HASH_A only
    const tt = resolveTrustedSignatureTimeSync(unanchored, ctx);
    assert.equal(tt.source, "self", "an unanchored event falls to the self time");
    assert.equal(tt.provable, false);
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.equal(dec.valid, false, "a compromised key with only a self-asserted (unprovable) time must be rejected");
  });
});

// --- §9.5  Routine rotation: prospective only; a DIFFERENT key unaffected -------------------

describe("§9.5 routine rotation is prospective-only", () => {
  it("a signature BEFORE R (validUntil) stays VALID", () => {
    const tt = { time: new Date("2026-06-14T11:59:59Z"), provable: false, source: "self" };
    const dec = isKeyValidForSignature(ROTATED, tt);
    assert.deepEqual(dec, { valid: true, reason: null });
  });

  it("a signature AT/AFTER R is REJECTED (key rotated out)", () => {
    const at = isKeyValidForSignature(ROTATED, { time: new Date(R), provable: false, source: "self" });
    assert.equal(at.valid, false);
    // validUntil is checked before revokedAt, so the validUntil reason wins at exactly R.
    assert.equal(at.reason, "signature at/after validUntil (key rotated out)");

    const after = isKeyValidForSignature(ROTATED, { time: new Date("2026-07-01T00:00:00Z"), provable: false, source: "self" });
    assert.equal(after.valid, false);
  });

  it("routine rotation trusts the SELF time (no anchor required) — unlike compromise", () => {
    // Provable:false is fine for rotation/retirement; the self-timestamp is trustworthy.
    const dec = isKeyValidForSignature(ROTATED, { time: new Date("2026-06-01T00:00:00Z"), provable: false, source: "self" });
    assert.equal(dec.valid, true);
  });

  it("a DIFFERENT valid key on the same node is unaffected by the rotation", () => {
    // The new key validFrom=R; a signature at/after R is valid for it.
    const after = isKeyValidForSignature(NEW_KEY, { time: new Date("2026-06-20T00:00:00Z"), provable: false, source: "self" });
    assert.deepEqual(after, { valid: true, reason: null });
    // And a signature BEFORE its validFrom is rejected for the new key (predates validFrom).
    const before = isKeyValidForSignature(NEW_KEY, { time: new Date("2026-06-01T00:00:00Z"), provable: false, source: "self" });
    assert.equal(before.valid, false);
    assert.equal(before.reason, "signature predates validFrom");
  });
});

// --- Resolver ladder ----------------------------------------------------------------------

describe("trusted-time resolver ladder (§5.2)", () => {
  it("sync: rung-2 'anchor-event' wins when a TRUSTED anchor covers the leaf", () => {
    const e = ev({ timestamp: "2026-06-10T00:00:00Z" });
    const ctx = ctxWithTrustedAnchor("2026-06-19T00:00:00Z");
    const tt = resolveTrustedSignatureTimeSync(e, ctx);
    assert.equal(tt.source, "anchor-event");
    assert.equal(tt.provable, true);
    assert.equal(tt.time.toISOString(), "2026-06-19T00:00:00.000Z");
  });

  it("sync: an UNTRUSTED (forged) anchor falls through to 'self' (rung-2 trust gate)", () => {
    const e = ev({ timestamp: "2026-06-10T00:00:00Z" });
    const ctx = ctxWithTrustedAnchor("2026-06-19T00:00:00Z", { trusted: false });
    const tt = resolveTrustedSignatureTimeSync(e, ctx);
    assert.equal(tt.source, "self", "a forged anchor's timestamp is NOT a trusted clock");
    assert.equal(tt.provable, false);
    assert.equal(tt.time.toISOString(), "2026-06-10T00:00:00.000Z");
  });

  it("sync: 'self' when no anchor covers the leaf", () => {
    const e = ev({ timestamp: "2026-06-10T00:00:00Z", leaf: HASH_B });
    const ctx = ctxWithTrustedAnchor("2026-06-19T00:00:00Z");
    const tt = resolveTrustedSignatureTimeSync(e, ctx);
    assert.equal(tt.source, "self");
    assert.equal(tt.provable, false);
  });

  it("sync: 'none' when the event has no usable timestamp and no anchor", () => {
    const e = ev({ timestamp: undefined, leaf: HASH_B });
    const ctx = ctxWithTrustedAnchor("2026-06-19T00:00:00Z");
    const tt = resolveTrustedSignatureTimeSync(e, ctx);
    assert.deepEqual(tt, { time: null, provable: false, source: "none" });
  });

  it("async: rung-1 'xrpl' close-time wins over the offline ladder for a TRUSTED anchor", async () => {
    const e = ev({ timestamp: "2026-06-10T00:00:00Z" });
    const anchorTs = "2026-06-19T00:00:00Z"; // the offline anchor-event time (would be rung 2)
    const xrplClose = new Date("2026-06-18T12:00:00Z"); // a DIFFERENT, on-chain close-time
    const ctx = {
      ...ctxWithTrustedAnchor(anchorTs),
      anchorCloseTime: async (txHash, network) => {
        assert.equal(txHash, "TX-1");
        assert.equal(network, "testnet");
        return xrplClose;
      },
    };
    const tt = await resolveTrustedSignatureTime(e, ctx);
    assert.equal(tt.source, "xrpl");
    assert.equal(tt.provable, true);
    assert.equal(tt.time.toISOString(), xrplClose.toISOString());
  });

  it("async: falls back to the sync ladder when anchorCloseTime yields null (offline)", async () => {
    const e = ev({ timestamp: "2026-06-10T00:00:00Z" });
    const ctx = {
      ...ctxWithTrustedAnchor("2026-06-19T00:00:00Z"),
      anchorCloseTime: async () => null, // offline / no close-time available
    };
    const tt = await resolveTrustedSignatureTime(e, ctx);
    assert.equal(tt.source, "anchor-event", "with no XRPL close-time, fall back to the trusted anchor-event time");
    assert.equal(tt.provable, true);
  });

  it("async: a thrown anchorCloseTime (network failure) is not a verdict — falls back", async () => {
    const e = ev({ timestamp: "2026-06-10T00:00:00Z" });
    const ctx = {
      ...ctxWithTrustedAnchor("2026-06-19T00:00:00Z"),
      anchorCloseTime: async () => { throw new Error("network down"); },
    };
    const tt = await resolveTrustedSignatureTime(e, ctx);
    assert.equal(tt.source, "anchor-event");
  });

  it("async with no anchorCloseTime provided behaves exactly like the sync ladder", async () => {
    const e = ev({ timestamp: "2026-06-10T00:00:00Z" });
    const ctx = ctxWithTrustedAnchor("2026-06-19T00:00:00Z"); // no anchorCloseTime
    const tt = await resolveTrustedSignatureTime(e, ctx);
    assert.equal(tt.source, "anchor-event");
    assert.equal(tt.provable, true);
  });
});

// --- The forged-window probe (§9 / §10): a compromised key + backdated self-time, anchored
// AFTER invalidAfter (or unanchored) — EVERY layer must REJECT it. -------------------------

describe("forged-window probe (§10)", () => {
  it("a compromise-revoked key with a backdated self-timestamp, anchored AFTER invalidAfter, is REJECTED", () => {
    // Internally-consistent event: self-timestamp claims 2026-06-01 (< C), but the leaf is
    // anchored by a trusted anchor at 2026-06-19 (> C). The trusted clock wins => reject.
    const forged = ev({ timestamp: "2026-06-01T00:00:00Z" });
    const ctx = ctxWithTrustedAnchor("2026-06-19T00:00:00Z");
    const tt = resolveTrustedSignatureTimeSync(forged, ctx);
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.equal(dec.valid, false, "the backdated self-time must not rescue a provably-post-C compromised signature");
  });

  it("a compromise-revoked key with a backdated self-timestamp and NO anchor is REJECTED (unprovable)", () => {
    const forged = ev({ timestamp: "2026-06-01T00:00:00Z", leaf: HASH_B });
    const ctx = ctxWithTrustedAnchor("2026-06-19T00:00:00Z");
    const tt = resolveTrustedSignatureTimeSync(forged, ctx);
    const dec = isKeyValidForSignature(COMPROMISED, tt);
    assert.equal(dec.valid, false, "an unanchored compromised signature cannot be proven pre-C => reject");
    assert.equal(dec.reason, "compromised key requires a provable (anchored) signature time");
  });
});

// =========================================================================================
// Wave-B2 hardening (contract §12). The cross-family verifier found two residuals the
// same-family GREEN re-audit missed: (①) a tampered node.json can STRIP a revoked key's
// window fields to re-grandfather it; (②) the predicate fails OPEN on a windowed key that
// declares a revocation intent but supplies no resolvable boundary date. The §12.1 helpers +
// the §12.2 fail-closed branch close both. Test-first: on the post-Wave-B (pre-§12) code these
// fail (the predicate would return valid:true on the no-boundary case; the helpers don't exist).
// =========================================================================================

// --- §12.2  Fail-closed: a revocation intent with NO resolvable boundary date --------------

describe("§12.2 fail-closed on a revocation intent without a resolvable boundary", () => {
  // A trusted time that, on the pre-fix code, would sail through to valid:true (no boundary
  // branch fires). Provable so even the compromise unprovable-gate can't be what rejects it.
  const tt = { time: new Date("2026-06-19T00:00:00Z"), provable: true, source: "anchor-event" };

  it("revocationReason set but revokedAt/invalidAfter/validUntil all ABSENT => REJECT", () => {
    const m = { keyId: "k", publicKey: "PK", revocationReason: "compromise" };
    const dec = isKeyValidForSignature(m, tt);
    assert.equal(dec.valid, false);
    assert.equal(dec.reason, "revocation intent without a resolvable boundary date");
  });

  it("a raw revokedAt present but UNPARSEABLE (no other boundary) => REJECT", () => {
    const m = { keyId: "k", publicKey: "PK", revokedAt: "not-a-date" };
    const dec = isKeyValidForSignature(m, tt);
    assert.equal(dec.valid, false);
    assert.equal(dec.reason, "revocation intent without a resolvable boundary date");
  });

  it("a raw invalidAfter present but UNPARSEABLE (no other boundary) => REJECT", () => {
    const m = { keyId: "k", publicKey: "PK", invalidAfter: "garbage", revocationReason: "compromise" };
    const dec = isKeyValidForSignature(m, tt);
    assert.equal(dec.valid, false);
    assert.equal(dec.reason, "revocation intent without a resolvable boundary date");
  });

  it("a windowed key WITH a parseable boundary is NOT spuriously fail-closed (COMPROMISED still works)", () => {
    // The COMPROMISED fixture has a real invalidAfter; the fail-closed branch must NOT fire.
    const before = { time: new Date("2026-06-17T00:00:00Z"), provable: true, source: "anchor-event" };
    assert.deepEqual(isKeyValidForSignature(COMPROMISED, before), { valid: true, reason: null });
    const after = { time: new Date("2026-06-19T00:00:00Z"), provable: true, source: "anchor-event" };
    assert.equal(isKeyValidForSignature(COMPROMISED, after).reason, "signature at/after compromise invalidity date");
  });

  it("a windowed key with ONLY validFrom (a lower bound, no revocation intent) is NOT fail-closed", () => {
    // validFrom alone is a window but carries NO revocation intent (no reason, no revokedAt,
    // no invalidAfter) => the fail-closed branch must not fire; normal validFrom logic applies.
    const m = { keyId: "k", publicKey: "PK", validFrom: "2026-06-01T00:00:00Z" };
    const ok = isKeyValidForSignature(m, { time: new Date("2026-06-10T00:00:00Z"), provable: false, source: "self" });
    assert.deepEqual(ok, { valid: true, reason: null });
    const tooEarly = isKeyValidForSignature(m, { time: new Date("2026-05-01T00:00:00Z"), provable: false, source: "self" });
    assert.equal(tooEarly.reason, "signature predates validFrom");
  });

  it("grandfather (window-less) is UNAFFECTED by the fail-closed branch", () => {
    assert.deepEqual(isKeyValidForSignature(GRANDFATHERED, tt), { valid: true, reason: null });
  });
});

// --- §12.1  deriveKeyWindowConstraints over a KeyRotation/KeyRevocation set ----------------

const REPO = "mcp-tool-shop-org/foo";

// Wave-B3 (§13.1): these tests now drive the NEW order-aware opts. ALLOW supplies the consolidated
// I/O (verifySignature/getMaintainer/timeOf/trustedPolicy) such that EVERY signer here is a
// grandfathered (always-valid) same-node key => every authorized event applies. (The §12.1 events
// are signed by `surviving-key` (revoke, != revokedKeyId) and the retiring key (rotate, §4.1), so
// all are authorized.) getMaintainer returns a window-less maintainer for any keyId => the signer
// is always VALID at timeOf, isolating these tests to the rotate/revoke SHAPE + fold behavior.
const ALLOW = {
  verifySignature: (ev) => ({ ok: true, signerKeyId: ev?.signature?.keyId ?? null, signerNodeRepo: ev?.repo ?? null }),
  getMaintainer: (keyId) => ({ keyId, publicKey: "PK" }), // grandfathered => always valid
  timeOf: (ev) => ({ time: new Date(ev.timestamp), provable: true, source: "anchor-event" }),
  trustedPolicy: new Set(),
};
// DENY: the signature does not verify (clause (a) fails) => no event contributes.
const DENY = { ...ALLOW, verifySignature: () => ({ ok: false }) };

// A signed, authorized KeyRevocation(compromise) for the old key.
function revokeEvent({ revokedKeyId = "mike-2026-01", reason = "compromise", invalidAfter, timestamp = "2026-06-20T09:00:00Z", repo = REPO } = {}) {
  return {
    type: "KeyRevocation",
    repo,
    timestamp,
    key: { action: "revoke", revokedKeyId, reason, ...(invalidAfter ? { invalidAfter } : {}) },
    signature: { alg: "ed25519", keyId: "surviving-key", value: "sig", canonicalHash: "d".repeat(64) },
  };
}

// A signed KeyRotation for the old->new key.
function rotateEvent({ retiringKeyId = "mike-2026-01", newKeyId = "mike-2026-06", effectiveAt = "2026-06-14T12:00:00Z", timestamp = "2026-06-14T12:00:00Z", repo = REPO } = {}) {
  return {
    type: "KeyRotation",
    repo,
    timestamp,
    key: { action: "rotate", retiringKeyId, newKeyId, newPublicKey: "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----", effectiveAt },
    signature: { alg: "ed25519", keyId: retiringKeyId, value: "sig", canonicalHash: "e".repeat(64) },
  };
}

describe("§12.1 deriveKeyWindowConstraints", () => {
  it("a KeyRevocation(compromise) yields revokedAt+reason+invalidAfter on the revoked key", () => {
    const evs = [revokeEvent({ invalidAfter: C })];
    const map = deriveKeyWindowConstraints(evs, REPO, ALLOW);
    const c = map.get("mike-2026-01");
    assert.ok(c, "the revoked key has a derived constraint");
    assert.equal(c.revocationReason, "compromise");
    assert.equal(c.revokedAt.toISOString(), "2026-06-20T09:00:00.000Z");
    assert.equal(c.invalidAfter.toISOString(), new Date(C).toISOString());
  });

  it("a KeyRotation yields validUntil/revokedAt/reason:rotation on retiring + validFrom on new", () => {
    const evs = [rotateEvent({ effectiveAt: R })];
    const map = deriveKeyWindowConstraints(evs, REPO, ALLOW);
    const retiring = map.get("mike-2026-01");
    assert.equal(retiring.revocationReason, "rotation");
    assert.equal(retiring.validUntil.toISOString(), new Date(R).toISOString());
    assert.equal(retiring.revokedAt.toISOString(), new Date(R).toISOString());
    const fresh = map.get("mike-2026-06");
    assert.equal(fresh.validFrom.toISOString(), new Date(R).toISOString());
    assert.equal(fresh.revocationReason, null);
  });

  it("events for a DIFFERENT repo are ignored", () => {
    const evs = [revokeEvent({ invalidAfter: C, repo: "mcp-tool-shop-org/other" })];
    const map = deriveKeyWindowConstraints(evs, REPO, ALLOW);
    assert.equal(map.size, 0);
  });

  it("unauthorized events contribute NOTHING (the authorization gate is fail-closed)", () => {
    const evs = [revokeEvent({ invalidAfter: C })];
    assert.equal(deriveKeyWindowConstraints(evs, REPO, DENY).size, 0, "verifySignature.ok=false => no constraint");
    assert.equal(deriveKeyWindowConstraints(evs, REPO, {}).size, 0, "no gate supplied => no constraint (fail-closed)");
  });

  it("non-key events and a non-array input are ignored", () => {
    const evs = [{ type: "ReleasePublished", repo: REPO }, revokeEvent({ invalidAfter: C })];
    assert.equal(deriveKeyWindowConstraints(evs, REPO, ALLOW).size, 1);
    assert.equal(deriveKeyWindowConstraints(null, REPO, ALLOW).size, 0);
  });
});

// --- LEGACY pre-B3 order-insensitive derivation — __deriveLegacyForTests (test-only baseline) ------
// The pre-§13.1 { verifyAndAuthorize } order-insensitive path is NO LONGER a selectable branch of
// deriveKeyWindowConstraints (the silent-downgrade footgun is gone — the main fn now fail-closes when
// verifySignature is absent). The pre-fix behavior is preserved ONLY as the explicit, deliberately-ugly
// __deriveLegacyForTests export, so these regression baselines still pin what the order-INSENSITIVE
// derivation did — the thing the §13.1 order-aware pass deliberately diverges from.
describe("§13.1 __deriveLegacyForTests (pre-B3 order-insensitive baseline)", () => {
  const LEGACY_ALLOW = { verifyAndAuthorize: () => true };
  const LEGACY_DENY = { verifyAndAuthorize: () => false };

  it("an authorized revocation derives the compromise constraint (legacy gate)", () => {
    const c = __deriveLegacyForTests([revokeEvent({ invalidAfter: C })], REPO, LEGACY_ALLOW).get("mike-2026-01");
    assert.ok(c);
    assert.equal(c.revocationReason, "compromise");
    assert.equal(c.invalidAfter.toISOString(), new Date(C).toISOString());
  });

  it("verifyAndAuthorize=false => no constraint; no gate => no constraint (fail-closed)", () => {
    assert.equal(__deriveLegacyForTests([revokeEvent({ invalidAfter: C })], REPO, LEGACY_DENY).size, 0);
    assert.equal(__deriveLegacyForTests([revokeEvent({ invalidAfter: C })], REPO, undefined).size, 0);
  });

  it("a rotation folds with a later compromise on the SAME key (compromise dominates) — order-insensitive", () => {
    const rotation = rotateEvent({ retiringKeyId: "mike-2026-01", newKeyId: "mike-2026-06", effectiveAt: "2099-01-01T00:00:00Z" });
    const compromise = revokeEvent({ revokedKeyId: "mike-2026-01", reason: "compromise", invalidAfter: C });
    const c = __deriveLegacyForTests([rotation, compromise], REPO, LEGACY_ALLOW).get("mike-2026-01");
    assert.equal(c.revocationReason, "compromise", "compromise dominates the prior rotation reason under the legacy path too");
    assert.equal(c.invalidAfter.toISOString(), new Date(C).toISOString());
  });

  it("FOOTGUN ELIMINATED: deriveKeyWindowConstraints IGNORES { verifyAndAuthorize } (fail-closed, no order-insensitive fallback)", () => {
    // A production miswiring that forgot verifySignature and passed only the legacy gate gets NOTHING via
    // the production entry point — never the order-insensitive authorization that would reopen residual ③.
    assert.equal(deriveKeyWindowConstraints([revokeEvent({ invalidAfter: C })], REPO, LEGACY_ALLOW).size, 0,
      "deriveKeyWindowConstraints fail-closes when verifySignature is absent, even if verifyAndAuthorize is supplied");
    // The pre-fix behavior is reachable ONLY via the explicit test-only export (proven non-empty above).
    assert.equal(__deriveLegacyForTests([revokeEvent({ invalidAfter: C })], REPO, LEGACY_ALLOW).size, 1,
      "the order-insensitive derivation survives ONLY behind the __deriveLegacyForTests name");
  });
});

// --- §12.1  mergeStricterWindow: stricter-wins + grandfather-safe identity -----------------

describe("§12.1 mergeStricterWindow", () => {
  it("GRANDFATHER-SAFE: mergeStricterWindow(m, undefined) === m (identity, byte-identical)", () => {
    const m = { keyId: "mike-legacy", publicKey: "PK-legacy" };
    assert.equal(mergeStricterWindow(m, undefined), m, "undefined constraint returns the SAME object");
    assert.equal(mergeStricterWindow(m, null), m, "null constraint returns the SAME object");
    // And the returned maintainer is still grandfathered (window-less) — behaves as today.
    assert.equal(keyWindow(mergeStricterWindow(m, undefined)).isWindowed, false);
  });

  it("a derived constraint can ADD a window to an otherwise grandfathered node.json key", () => {
    // node.json has the key window STRIPPED (re-grandfathered). The signed event re-imposes it.
    const stripped = { keyId: "mike-2026-01", publicKey: "PK-1" };
    const c = deriveKeyWindowConstraints([revokeEvent({ invalidAfter: C })], REPO, ALLOW).get("mike-2026-01");
    const merged = mergeStricterWindow(stripped, c);
    const w = keyWindow(merged);
    assert.equal(w.isWindowed, true, "the stripped key is re-windowed from the signed event");
    assert.equal(w.revocationReason, "compromise");
    assert.equal(w.invalidAfter.toISOString(), new Date(C).toISOString());
  });

  it("takes the STRICTER of each axis: validFrom=max, validUntil/revokedAt/invalidAfter=min", () => {
    const m = {
      keyId: "k",
      validFrom: "2026-01-01T00:00:00Z",
      validUntil: "2026-12-01T00:00:00Z",
      revokedAt: "2026-12-01T00:00:00Z",
      invalidAfter: "2026-12-01T00:00:00Z",
      revocationReason: "rotation",
    };
    const c = {
      validFrom: new Date("2026-03-01T00:00:00Z"), // later lower bound wins (max)
      validUntil: new Date("2026-06-01T00:00:00Z"), // earlier upper bound wins (min)
      revokedAt: new Date("2026-06-01T00:00:00Z"),
      invalidAfter: new Date("2026-05-01T00:00:00Z"),
      revocationReason: "rotation",
    };
    const w = keyWindow(mergeStricterWindow(m, c));
    assert.equal(w.validFrom.toISOString(), "2026-03-01T00:00:00.000Z", "validFrom = max");
    assert.equal(w.validUntil.toISOString(), "2026-06-01T00:00:00.000Z", "validUntil = min");
    assert.equal(w.revokedAt.toISOString(), "2026-06-01T00:00:00.000Z", "revokedAt = min");
    assert.equal(w.invalidAfter.toISOString(), "2026-05-01T00:00:00.000Z", "invalidAfter = min");
  });

  it("revocationReason 'compromise' DOMINATES 'rotation'/'retirement' regardless of order", () => {
    const fromNode = { keyId: "k", revokedAt: "2026-06-20T00:00:00Z", revocationReason: "rotation" };
    const compromiseConstraint = { revokedAt: new Date("2026-06-20T00:00:00Z"), revocationReason: "compromise", invalidAfter: new Date(C) };
    assert.equal(keyWindow(mergeStricterWindow(fromNode, compromiseConstraint)).revocationReason, "compromise");
    // And the reverse: node.json says compromise, constraint says rotation => still compromise.
    const fromNode2 = { keyId: "k", revokedAt: "2026-06-20T00:00:00Z", revocationReason: "compromise", invalidAfter: C };
    const rotationConstraint = { revokedAt: new Date("2026-06-20T00:00:00Z"), revocationReason: "rotation" };
    assert.equal(keyWindow(mergeStricterWindow(fromNode2, rotationConstraint)).revocationReason, "compromise");
  });

  it("a tampered node.json can only ADD restriction, never loosen the signed-event window", () => {
    // node.json claims a LATE invalidAfter (attacker tries to widen the valid window); the signed
    // constraint's earlier invalidAfter wins (min).
    const tampered = { keyId: "k", revokedAt: "2099-01-01T00:00:00Z", revocationReason: "compromise", invalidAfter: "2099-01-01T00:00:00Z" };
    const signed = { revokedAt: new Date("2026-06-20T00:00:00Z"), revocationReason: "compromise", invalidAfter: new Date(C) };
    const w = keyWindow(mergeStricterWindow(tampered, signed));
    assert.equal(w.invalidAfter.toISOString(), new Date(C).toISOString(), "the EARLIER (signed) invalidAfter survives — node.json cannot widen it");
  });
});

// --- §12.3  ROTATION-PREEMPT: a self-issued rotation cannot pre-empt a later compromise -----

describe("§12.3 rotation-preempt: compromise revocation DOMINATES a prior self-issued rotation", () => {
  it("self-issued KeyRotation(rotation) THEN authorized KeyRevocation(compromise, invalidAfter=C) => post-C REJECTED", () => {
    // Attacker self-signs a KeyRotation for their OWN compromised key, with effectiveAt FAR in
    // the future, hoping the prospective 'rotation' window keeps post-compromise signatures valid.
    // A later AUTHORIZED KeyRevocation(reason:compromise, invalidAfter:C) must dominate.
    const rotation = rotateEvent({ retiringKeyId: "mike-2026-01", newKeyId: "mike-2026-06", effectiveAt: "2099-01-01T00:00:00Z" });
    const compromise = revokeEvent({ revokedKeyId: "mike-2026-01", reason: "compromise", invalidAfter: C, timestamp: "2026-06-20T09:00:00Z" });

    // Both events authorized in derivation (in the real probe the self-rotation may be
    // unauthorized; either way compromise must dominate). Fold them on the same key.
    const map = deriveKeyWindowConstraints([rotation, compromise], REPO, ALLOW);
    const c = map.get("mike-2026-01");
    assert.equal(c.revocationReason, "compromise", "compromise dominates the prior rotation reason");
    assert.equal(c.invalidAfter.toISOString(), new Date(C).toISOString(), "the compromise invalidAfter survives the fold");

    // Merge with a (possibly node.json-stripped) maintainer and run the predicate.
    const eff = mergeStricterWindow({ keyId: "mike-2026-01", publicKey: "PK-1" }, c);

    // A signature provably AFTER C is REJECTED (compromise boundary, not the future rotation R).
    const postC = isKeyValidForSignature(eff, { time: new Date("2026-06-19T00:00:00Z"), provable: true, source: "anchor-event" });
    assert.equal(postC.valid, false, "post-C signature is rejected despite the future-dated rotation");
    assert.equal(postC.reason, "signature at/after compromise invalidity date");

    // And a signature provably BEFORE C stays VALID (compromise does not retroactively kill old sigs).
    const preC = isKeyValidForSignature(eff, { time: new Date("2026-06-17T00:00:00Z"), provable: true, source: "anchor-event" });
    assert.equal(preC.valid, true, "a provably-pre-C signature survives");

    // An UNANCHORED (unprovable) pre-C signature is rejected (compromise demands provability).
    const unprovable = isKeyValidForSignature(eff, { time: new Date("2026-06-17T00:00:00Z"), provable: false, source: "self" });
    assert.equal(unprovable.valid, false, "an unprovable pre-C signature on a compromised key is rejected");
  });
});

// =========================================================================================
// Wave-B3 (contract §13.1) — ORDER-AWARE single forward pass + consolidated §4 authorization.
//
// Residual ③: the Wave-B2 derive-stricter protected the MAIN resolution path, but the
// AUTHORIZATION sub-check (is a KeyRotation/KeyRevocation's *signer* currently valid?) trusted
// node.json ALONE. Exploit: attacker holds compromise-revoked K_a; serves a node.json that
// STRIPS K_a's window; the auth path then sees K_a valid → K_a authorizes a KeyRotation
// K_a→K_b → K_b gets a fresh valid window → K_b signs a release that verifies VALID. Trust
// re-established via rotation.
//
// THE FIX (§13.1): deriveKeyWindowConstraints becomes an ORDER-AWARE single forward pass over
// the repo's KeyRotation/KeyRevocation events in LEDGER (array) order, accumulating a
// `derivedSoFar` map. The §4 authorization *validity decision* is CONSOLIDATED into this module.
// For each event E signed by S, E is applied iff: (a) verifySignature(E).ok; (b) S is a surviving
// same-node key (signerKeyId != the revoked/retiring keyId AND signerNodeRepo === E.repo) OR a
// trustedPolicy node; AND (c) S is VALID at timeOf(E) per isKeyValidForSignature(
//   mergeStricterWindow(getMaintainer(signerKeyId, signerNodeRepo), derivedSoFar.get(signerKeyId)),
//   timeOf(E)) — the signer's validity uses derivedSoFar (state from STRICTLY-EARLIER events)
// merged with node.json. A revocation self-signed by the revoked key stays unauthorized. Single
// forward pass → terminates, no recursion, no mutual-revocation cycle.
//
// NEW opts shape (consolidation — the per-site verifyAndAuthorize implementations are deleted):
//   { verifySignature(ev) -> { ok, signerKeyId, signerNodeRepo },
//     getMaintainer(keyId, nodeRepo) -> maintainer|null,
//     timeOf(ev) -> trustedTime,
//     trustedPolicy: Set<nodeRepo> }
//
// Test-first: on the current (post-Wave-B2) code these FAIL — the old deriveKeyWindowConstraints
// is order-INSENSITIVE and ignores the new opts entirely (no verifySignature/getMaintainer/timeOf),
// so a stripped node.json re-authorizes K_a → K_b gets a fresh window.
// =========================================================================================

const REPO_B3 = "mcp-tool-shop-org/foo";
const K_A = "mike-2026-01"; // the compromise-revoked key
const K_B = "mike-2026-06"; // the key K_a tries to rotate INTO
const K_SURV = "mike-surviving"; // a surviving same-node key that authorizes the revocation

// invalidAfter for K_a's compromise.
const C_B3 = "2026-06-18T00:00:00Z";

// A signed KeyRevocation(compromise) of `revokedKeyId`, signed by `signerKeyId`.
function b3Revoke({ revokedKeyId = K_A, signerKeyId = K_SURV, reason = "compromise", invalidAfter = C_B3, timestamp = "2026-06-20T09:00:00Z", repo = REPO_B3 } = {}) {
  return {
    type: "KeyRevocation",
    repo,
    timestamp,
    key: { action: "revoke", revokedKeyId, reason, ...(invalidAfter ? { invalidAfter } : {}) },
    signature: { alg: "ed25519", keyId: signerKeyId, value: "sig", canonicalHash: "d".repeat(64) },
  };
}

// A signed KeyRotation retiringKeyId->newKeyId, signed by `signerKeyId` (defaults to the retiring key).
function b3Rotate({ retiringKeyId = K_A, newKeyId = K_B, signerKeyId, effectiveAt = "2026-06-25T12:00:00Z", timestamp = "2026-06-25T12:00:00Z", repo = REPO_B3 } = {}) {
  return {
    type: "KeyRotation",
    repo,
    timestamp,
    key: { action: "rotate", retiringKeyId, newKeyId, newPublicKey: "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----", effectiveAt },
    signature: { alg: "ed25519", keyId: signerKeyId ?? retiringKeyId, value: "sig", canonicalHash: "e".repeat(64) },
  };
}

// Build the NEW-shape opts. `nodeJson` maps keyId -> maintainer object (node.json read surface).
// Signatures all "verify" here (the cryptographic check is the site's job; we test ordering +
// authorization + signer-validity). timeOf reads the event's self timestamp as a PROVABLE trusted
// time — enough to drive isKeyValidForSignature deterministically for these ordering cases.
function b3Opts(nodeJson, { trustedPolicy = new Set() } = {}) {
  return {
    verifySignature: (ev) => ({
      ok: true,
      signerKeyId: ev?.signature?.keyId ?? null,
      signerNodeRepo: ev?.repo ?? null,
    }),
    getMaintainer: (keyId, nodeRepo) => nodeJson[keyId] ?? null,
    timeOf: (ev) => ({ time: new Date(ev.timestamp), provable: true, source: "anchor-event" }),
    trustedPolicy,
  };
}

describe("§13.1 ③ order-aware single forward pass — consolidated §4 authorization", () => {
  it("EXPLOIT BLOCKED: K_a compromise-revoked (R), then K_a-signed LATER rotation K_a→K_b => K_b gets NO window (even with K_a STRIPPED from node.json)", () => {
    // Ledger order: R (revoke K_a) BEFORE ROT (K_a rotates to K_b). node.json STRIPS K_a's window
    // (attacker re-grandfathers it). The surviving key authorizes the revocation.
    const R = b3Revoke({ revokedKeyId: K_A, signerKeyId: K_SURV, invalidAfter: C_B3, timestamp: "2026-06-20T09:00:00Z" });
    const ROT = b3Rotate({ retiringKeyId: K_A, newKeyId: K_B, signerKeyId: K_A, effectiveAt: "2026-06-25T12:00:00Z", timestamp: "2026-06-25T12:00:00Z" });

    // node.json: K_a STRIPPED (window-less => grandfathered if trusted alone); K_surv valid.
    const nodeJson = {
      [K_A]: { keyId: K_A, publicKey: "PK-A" }, // STRIPPED — no window fields
      [K_SURV]: { keyId: K_SURV, publicKey: "PK-SURV" }, // grandfathered surviving key
    };

    const map = deriveKeyWindowConstraints([R, ROT], REPO_B3, b3Opts(nodeJson));

    // R is authorized (K_surv != K_a, same node, grandfathered-valid) => K_a gets the compromise window.
    const ca = map.get(K_A);
    assert.ok(ca, "the revocation applied a constraint to K_a");
    assert.equal(ca.revocationReason, "compromise");
    assert.equal(ca.invalidAfter.toISOString(), new Date(C_B3).toISOString());

    // ROT is signed by K_a. At timeOf(ROT) (2026-06-25, AFTER C), K_a is INVALID per the
    // derivedSoFar compromise window => ROT is UNAUTHORIZED => K_b gets NO window.
    assert.equal(map.get(K_B), undefined, "K_b must NOT receive a fresh window — its rotation was signed by an already-compromise-revoked key");

    // End-to-end: K_b, merged with its (absent) derived constraint, has NO imposed window — it never
    // gained authority. The point of the fix: a stripped node.json cannot re-authorize K_a's rotation.
    const effB = mergeStricterWindow({ keyId: K_B, publicKey: "PK-B" }, map.get(K_B));
    assert.equal(keyWindow(effB).validFrom, null, "K_b gained no validFrom from an unauthorized rotation");
  });

  it("CONVERSE: a rotation K_a→K_b that comes BEFORE K_a's revocation still stands (K_a was valid then)", () => {
    // Ledger order: ROT (K_a valid, rotates to K_b) BEFORE R (later compromise-revokes K_a).
    const ROT = b3Rotate({ retiringKeyId: K_A, newKeyId: K_B, signerKeyId: K_A, effectiveAt: "2026-06-10T12:00:00Z", timestamp: "2026-06-10T12:00:00Z" });
    const R = b3Revoke({ revokedKeyId: K_A, signerKeyId: K_SURV, invalidAfter: C_B3, timestamp: "2026-06-20T09:00:00Z" });

    // node.json: K_a present and valid AT the rotation time (grandfathered/window-less is fine — the
    // rotation precedes any revocation in derivedSoFar, so K_a is valid at timeOf(ROT)).
    const nodeJson = {
      [K_A]: { keyId: K_A, publicKey: "PK-A" },
      [K_SURV]: { keyId: K_SURV, publicKey: "PK-SURV" },
    };

    const map = deriveKeyWindowConstraints([ROT, R], REPO_B3, b3Opts(nodeJson));

    // The rotation was authorized (K_a valid at timeOf(ROT), nothing earlier restricts it) => K_b gets
    // its validFrom window.
    const cb = map.get(K_B);
    assert.ok(cb, "K_b received a window from the pre-revocation rotation");
    assert.equal(cb.validFrom.toISOString(), new Date("2026-06-10T12:00:00Z").toISOString());

    // K_a still ends up with the rotation's retiring window AND the later compromise (compromise dominates).
    const ca = map.get(K_A);
    assert.equal(ca.revocationReason, "compromise", "the later compromise dominates the rotation reason on K_a");
  });

  it("ORDER MATTERS: same two events, REVERSED ledger order, flip K_b's authorization", () => {
    const ROT = b3Rotate({ retiringKeyId: K_A, newKeyId: K_B, signerKeyId: K_A, effectiveAt: "2026-06-25T12:00:00Z", timestamp: "2026-06-25T12:00:00Z" });
    const R = b3Revoke({ revokedKeyId: K_A, signerKeyId: K_SURV, invalidAfter: C_B3, timestamp: "2026-06-20T09:00:00Z" });
    const nodeJson = {
      [K_A]: { keyId: K_A, publicKey: "PK-A" },
      [K_SURV]: { keyId: K_SURV, publicKey: "PK-SURV" },
    };

    // R before ROT (revocation first): K_a invalid at rotation time => K_b NO window.
    assert.equal(deriveKeyWindowConstraints([R, ROT], REPO_B3, b3Opts(nodeJson)).get(K_B), undefined);
    // ROT before R (rotation first): K_a valid at rotation time => K_b GETS a window.
    assert.ok(deriveKeyWindowConstraints([ROT, R], REPO_B3, b3Opts(nodeJson)).get(K_B), "rotation-first authorizes K_b");
  });

  it("a revocation SELF-SIGNED by the revoked key is UNAUTHORIZED (path-a fails, not trustedPolicy)", () => {
    // K_a signs its OWN revocation. signerKeyId === revokedKeyId => not a surviving same-node key.
    const selfRevoke = b3Revoke({ revokedKeyId: K_A, signerKeyId: K_A, invalidAfter: C_B3 });
    const nodeJson = { [K_A]: { keyId: K_A, publicKey: "PK-A" } };
    const map = deriveKeyWindowConstraints([selfRevoke], REPO_B3, b3Opts(nodeJson));
    assert.equal(map.get(K_A), undefined, "a self-signed revocation by the revoked key applies NO constraint (unauthorized)");
  });

  it("a trustedPolicy node MAY authorize a revocation for ANY node (governance floor, §4.3)", () => {
    const GOV = "mcp-tool-shop-org/governance";
    // The revocation is signed by a key whose node is in trustedPolicy. Even though it is NOT a
    // surviving same-node key (different repo), the governance floor authorizes it.
    const govRevoke = {
      type: "KeyRevocation",
      repo: REPO_B3,
      timestamp: "2026-06-20T09:00:00Z",
      key: { action: "revoke", revokedKeyId: K_A, reason: "compromise", invalidAfter: C_B3 },
      // signerNodeRepo will be GOV via verifySignature below.
      signature: { alg: "ed25519", keyId: "gov-key", value: "sig", canonicalHash: "f".repeat(64) },
    };
    const nodeJson = {
      [K_A]: { keyId: K_A, publicKey: "PK-A" },
      "gov-key": { keyId: "gov-key", publicKey: "PK-GOV" },
    };
    const opts = {
      verifySignature: () => ({ ok: true, signerKeyId: "gov-key", signerNodeRepo: GOV }),
      getMaintainer: (keyId) => nodeJson[keyId] ?? null,
      timeOf: (ev) => ({ time: new Date(ev.timestamp), provable: true, source: "anchor-event" }),
      trustedPolicy: new Set([GOV]),
    };
    const map = deriveKeyWindowConstraints([govRevoke], REPO_B3, opts);
    assert.equal(map.get(K_A).revocationReason, "compromise", "the governance node authorized the revocation");
  });

  it("an event whose signature does NOT verify contributes nothing", () => {
    const R = b3Revoke({ revokedKeyId: K_A, signerKeyId: K_SURV, invalidAfter: C_B3 });
    const nodeJson = { [K_A]: { keyId: K_A, publicKey: "PK-A" }, [K_SURV]: { keyId: K_SURV, publicKey: "PK-SURV" } };
    const opts = { ...b3Opts(nodeJson), verifySignature: () => ({ ok: false, signerKeyId: K_SURV, signerNodeRepo: REPO_B3 }) };
    assert.equal(deriveKeyWindowConstraints([R], REPO_B3, opts).size, 0, "verifySignature.ok=false => no constraint");
  });

  it("a same-node signer that is ITSELF invalid (per node.json) cannot authorize an event", () => {
    // K_surv is window-less in node.json BUT we give it a compromise window via an EARLIER revocation,
    // so by the time it tries to authorize a LATER revocation it is already invalid.
    const KILL_SURV = b3Revoke({ revokedKeyId: K_SURV, signerKeyId: "mike-root", invalidAfter: "2026-06-01T00:00:00Z", timestamp: "2026-06-02T00:00:00Z" });
    const LATER = b3Revoke({ revokedKeyId: K_A, signerKeyId: K_SURV, invalidAfter: C_B3, timestamp: "2026-06-20T09:00:00Z" });
    const nodeJson = {
      [K_A]: { keyId: K_A, publicKey: "PK-A" },
      [K_SURV]: { keyId: K_SURV, publicKey: "PK-SURV" },
      "mike-root": { keyId: "mike-root", publicKey: "PK-ROOT" },
    };
    const map = deriveKeyWindowConstraints([KILL_SURV, LATER], REPO_B3, b3Opts(nodeJson));
    // K_surv was revoked (compromise, invalidAfter 2026-06-01) by mike-root. At timeOf(LATER)
    // (2026-06-20) K_surv is INVALID => its authorization of LATER fails => K_a gets NO constraint.
    assert.equal(map.get(K_A), undefined, "an already-invalid surviving key cannot authorize a later revocation");
    // (And K_surv itself DID get the compromise window from the authorized KILL_SURV.)
    assert.equal(map.get(K_SURV).revocationReason, "compromise");
  });
});
