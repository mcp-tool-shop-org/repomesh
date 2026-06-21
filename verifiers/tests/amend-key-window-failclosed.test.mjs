// STAGE-A AMEND — fail-closed hardening of the key-validity predicate.
//   VER-A-001: a non-usable (NaN/Invalid Date) trusted time must FAIL CLOSED for a windowed key.
//   VER-A-002: revocationReason must be canonicalized (trim+lowercase) and any unknown/mis-cased
//              reason must fail CLOSED as a compromise (the strictest gate).
//
// Test-first: at HEAD an Invalid Date passes the (null|undefined) guard and every <,>= becomes a
// NaN compare (false), so a compromised/out-of-window key falls through to valid:true. And a
// mis-cased "Compromise" misses the exact `=== "compromise"` gate, dropping the provable-time
// requirement. These assertions encode the REQUIRED fail-closed behavior; they are RED at HEAD.
//
// This file imports the verifiers/lib copy. Its CLI mirror is
// packages/repomesh-cli/tests/amend-key-window-failclosed.test.mjs (byte-identical except the
// import path line).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isKeyValidForSignature, keyWindow } from "../lib/key-window.mjs";

// A windowed, COMPROMISE-revoked key whose boundary is well in the past. Any signature with a
// usable time at/after the boundary is invalid; with NO usable time it must fail closed.
const compromisedKey = {
  revokedAt: "2024-01-01T00:00:00.000Z",
  invalidAfter: "2024-01-01T00:00:00.000Z",
  revocationReason: "compromise",
};

describe("VER-A-001 fail-closed on a non-usable (Invalid Date) trusted time", () => {
  it("an Invalid Date trusted time on a windowed/compromised key is INVALID (no NaN-compare fall-through)", () => {
    const tt = { time: new Date("garbage"), provable: true, source: "self" };
    const dec = isKeyValidForSignature(compromisedKey, tt);
    assert.equal(dec.valid, false, "Invalid Date must NOT be treated as a usable signature time");
    assert.match(dec.reason, /no resolvable signature time/i);
  });

  it("a non-Date primitive as time (e.g. a number) is INVALID for a windowed key", () => {
    const tt = { time: 1700000000000, provable: true, source: "self" };
    const dec = isKeyValidForSignature(compromisedKey, tt);
    assert.equal(dec.valid, false, "a non-Date time must fail closed, not coerce");
    assert.match(dec.reason, /no resolvable signature time/i);
  });

  it("a NaN-valued Date on a validUntil-only windowed key is INVALID (cannot dodge the edge)", () => {
    const rotatedKey = { validUntil: "2024-01-01T00:00:00.000Z" };
    const tt = { time: new Date(NaN), provable: false, source: "self" };
    const dec = isKeyValidForSignature(rotatedKey, tt);
    assert.equal(dec.valid, false, "Invalid Date must not slip past the validUntil edge via NaN compare");
  });

  it("REGRESSION: a usable Date still validates a fresh in-window non-revoked key", () => {
    const liveKey = { validFrom: "2024-01-01T00:00:00.000Z", validUntil: "2030-01-01T00:00:00.000Z" };
    const tt = { time: new Date("2025-06-01T00:00:00.000Z"), provable: false, source: "self" };
    const dec = isKeyValidForSignature(liveKey, tt);
    assert.equal(dec.valid, true);
  });

  it("REGRESSION: a grandfather (window-less) key with an Invalid Date is still VALID (never reaches the guard)", () => {
    const grandfather = {}; // no window fields
    assert.equal(keyWindow(grandfather).isWindowed, false);
    const dec = isKeyValidForSignature(grandfather, { time: new Date("garbage"), provable: false, source: "self" });
    assert.equal(dec.valid, true, "grandfather returns before the time guard — unaffected");
  });
});

describe("VER-A-002 unknown / mis-cased revocationReason fails CLOSED as compromise", () => {
  // A signature time BEFORE the boundary but only SELF-asserted (not provable). For a compromise
  // gate this must be INVALID (compromise demands a provable anchored time). For the prospective
  // (rotation/retirement) branch the same self time would be VALID. So this input DISCRIMINATES
  // the two branches: VALID iff the reason canonicalizes to a prospective reason.
  const selfTimeBeforeBoundary = { time: new Date("2023-06-01T00:00:00.000Z"), provable: false, source: "self" };

  const mkKey = (reason) => ({
    revokedAt: "2024-01-01T00:00:00.000Z",
    invalidAfter: "2024-01-01T00:00:00.000Z",
    revocationReason: reason,
  });

  it('mis-cased "Compromise" fires the compromise gate (requires provable time)', () => {
    const dec = isKeyValidForSignature(mkKey("Compromise"), selfTimeBeforeBoundary);
    assert.equal(dec.valid, false, '"Compromise" must canonicalize to the compromise gate');
    assert.match(dec.reason, /provable .* signature time|compromise/i);
  });

  it('padded "  compromise  " fires the compromise gate', () => {
    const dec = isKeyValidForSignature(mkKey("  compromise  "), selfTimeBeforeBoundary);
    assert.equal(dec.valid, false, "surrounding whitespace must not dodge the compromise gate");
  });

  it('an UNKNOWN reason ("hacked-lol") fails CLOSED as compromise (strictest)', () => {
    const dec = isKeyValidForSignature(mkKey("hacked-lol"), selfTimeBeforeBoundary);
    assert.equal(dec.valid, false, "a novel reason string must NOT take the prospective trust-self branch");
  });

  it('exact lowercase "rotation" stays PROSPECTIVE (self time before revoke is trusted)', () => {
    // rotation: prospective. A self-asserted time strictly before revokedAt is VALID.
    const dec = isKeyValidForSignature(mkKey("rotation"), selfTimeBeforeBoundary);
    assert.equal(dec.valid, true, '"rotation" must remain prospective — past signatures trusted');
  });

  it('exact lowercase "retirement" stays PROSPECTIVE', () => {
    const dec = isKeyValidForSignature(mkKey("retirement"), selfTimeBeforeBoundary);
    assert.equal(dec.valid, true, '"retirement" must remain prospective');
  });

  it('mixed-case "Rotation" canonicalizes to the prospective branch too', () => {
    const dec = isKeyValidForSignature(mkKey("Rotation"), selfTimeBeforeBoundary);
    assert.equal(dec.valid, true, '"Rotation" must canonicalize to prospective rotation');
  });
});
