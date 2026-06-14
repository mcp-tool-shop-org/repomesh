// Key-lifecycle regression at verifiers/lib/common.mjs getPublicKeyForKeyId (contract site 9,
// §5.3 + the B-verifiers NOTE).
//
// THE BUG: getPublicKeyForKeyId did an UNTIMED maintainers.find() and returned the key with ZERO
// time check, so a compromise-revoked-but-still-listed key resolved to a usable public key.
//
// THE NOTE (site-9-specific): getPublicKeyForKeyId currently THROWS on no-key and has NO event/ctx
// in its signature. The bare 2-arg call is used by signing / non-verification paths and MUST keep
// working byte-identically. The fix adds an OPTIONAL (ev, ctx) parameter; when supplied (the real
// verification path), the function resolves trusted time and applies isKeyValidForSignature, and on
// !valid THROWS carrying dec.reason — consistent with its existing throw-on-no-key contract.
//
// TEST-FIRST / RED before fix: on the pre-fix code path getPublicKeyForKeyId ignores any 3rd/4th
// argument and returns the compromised key's PEM. These assertions (which expect a throw carrying
// the compromise reason) turn that into RED. After the fix they pass.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getPublicKeyForKeyId, signEvent, computeCanonicalHash } from "../lib/common.mjs";
import {
  isKeyValidForSignature,
  resolveTrustedSignatureTimeSync,
} from "../lib/key-window.mjs";

const C = "2026-06-18T00:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const GRANDFATHERED = { name: "Legacy", keyId: "legacy-key", publicKey: "-----BEGIN PUBLIC KEY-----\nLEGACY\n-----END PUBLIC KEY-----" };
const COMPROMISED = {
  name: "Compromised",
  keyId: "compromised-key",
  publicKey: "-----BEGIN PUBLIC KEY-----\nPK\n-----END PUBLIC KEY-----",
  revokedAt: "2026-06-20T09:00:00.000Z",
  revocationReason: "compromise",
  invalidAfter: C,
};
const ROTATED = {
  name: "Rotated",
  keyId: "rotated-key",
  publicKey: "-----BEGIN PUBLIC KEY-----\nPK2\n-----END PUBLIC KEY-----",
  validUntil: "2026-06-14T12:00:00.000Z",
  revokedAt: "2026-06-14T12:00:00.000Z",
  revocationReason: "rotation",
};

function node(maintainers) {
  return { id: "test-org/widget", maintainers };
}
function ev({ timestamp, leaf = HASH_A, keyId = "compromised-key" }) {
  return {
    type: "ReleasePublished",
    repo: "test-org/widget",
    timestamp,
    signature: { alg: "ed25519", keyId, value: "sig", canonicalHash: leaf },
  };
}
// ctx that anchors HASH_A to a TRUSTED anchor at the given timestamp. HASH_B stays unanchored.
function ctxAnchoring(anchorTs, { trusted = true } = {}) {
  const anchor = { type: "AttestationPublished", timestamp: anchorTs, signature: { canonicalHash: "c".repeat(64) } };
  return {
    findEarliestAnchorForLeaf: (leaf) => (leaf === HASH_A ? { anchor } : null),
    isBundledTrustedAnchor: () => trusted,
  };
}

describe("contract site 9 — getPublicKeyForKeyId bare 2-arg (signing / non-verification path) unchanged", () => {
  it("returns the trimmed PEM for a known keyId (today's behavior)", () => {
    const pk = getPublicKeyForKeyId(node([GRANDFATHERED]), "legacy-key");
    assert.equal(pk, GRANDFATHERED.publicKey.trim());
  });

  it("throws on an unknown keyId (today's no-key contract, byte-identical message)", () => {
    assert.throws(
      () => getPublicKeyForKeyId(node([GRANDFATHERED]), "nope"),
      /No maintainer publicKey for keyId=nope/
    );
  });

  it("a WINDOWED key with NO ev/ctx still resolves via the bare 2-arg path (signing must not be time-gated)", () => {
    // The signing path passes no ev/ctx — it must keep returning the key even for a windowed key,
    // because signing is not verifying a historical signature.
    const pk = getPublicKeyForKeyId(node([COMPROMISED]), "compromised-key");
    assert.equal(pk, COMPROMISED.publicKey.trim());
  });
});

describe("contract site 9 — getPublicKeyForKeyId timed (ev, ctx) verification path", () => {
  it("GRANDFATHER: a window-less key is returned regardless of time (byte-identical to today)", () => {
    const e = ev({ timestamp: "2999-01-01T00:00:00.000Z", keyId: "legacy-key" });
    const ctx = ctxAnchoring("2999-01-01T00:00:00.000Z");
    const pk = getPublicKeyForKeyId(node([GRANDFATHERED]), "legacy-key", e, ctx);
    assert.equal(pk, GRANDFATHERED.publicKey.trim());
  });

  it("COMPROMISE provably-AFTER C: THROWS carrying dec.reason", () => {
    const e = ev({ timestamp: "2026-06-01T00:00:00.000Z" }); // backdated self-time
    const ctx = ctxAnchoring("2026-06-19T00:00:00.000Z"); // trusted anchor proves it AFTER C
    assert.throws(
      () => getPublicKeyForKeyId(node([COMPROMISED]), "compromised-key", e, ctx),
      /compromise invalidity date/,
      "a provably-post-compromise key must not resolve to a usable public key"
    );
  });

  it("COMPROMISE unprovable (unanchored self-time): THROWS carrying dec.reason", () => {
    const e = ev({ timestamp: "2026-06-01T00:00:00.000Z", leaf: HASH_B }); // no anchor for HASH_B
    const ctx = ctxAnchoring("2026-06-19T00:00:00.000Z");
    assert.throws(
      () => getPublicKeyForKeyId(node([COMPROMISED]), "compromised-key", e, ctx),
      /provable \(anchored\) signature time/
    );
  });

  it("COMPROMISE provably-OLD (anchored < C): returns the key (not retroactive)", () => {
    const e = ev({ timestamp: "2026-06-15T00:00:00.000Z" });
    const ctx = ctxAnchoring("2026-06-17T00:00:00.000Z"); // trusted anchor proves it < C
    const pk = getPublicKeyForKeyId(node([COMPROMISED]), "compromised-key", e, ctx);
    assert.equal(pk, COMPROMISED.publicKey.trim());
  });

  it("ROTATION pre-R: returns the key (self time trusted for rotation)", () => {
    const e = ev({ timestamp: "2026-06-10T00:00:00.000Z", leaf: HASH_B, keyId: "rotated-key" });
    const ctx = ctxAnchoring("2026-06-19T00:00:00.000Z"); // no anchor for HASH_B => self time
    const pk = getPublicKeyForKeyId(node([ROTATED]), "rotated-key", e, ctx);
    assert.equal(pk, ROTATED.publicKey.trim());
  });

  it("ROTATION post-R: THROWS carrying dec.reason", () => {
    const e = ev({ timestamp: "2026-07-01T00:00:00.000Z", leaf: HASH_B, keyId: "rotated-key" });
    const ctx = ctxAnchoring("2026-06-19T00:00:00.000Z");
    assert.throws(
      () => getPublicKeyForKeyId(node([ROTATED]), "rotated-key", e, ctx),
      /validUntil|rotated out/
    );
  });

  it("an unknown keyId still throws the no-key message even with ev/ctx (no-key contract preserved)", () => {
    const e = ev({ timestamp: "2026-06-01T00:00:00.000Z" });
    const ctx = ctxAnchoring("2026-06-19T00:00:00.000Z");
    assert.throws(
      () => getPublicKeyForKeyId(node([GRANDFATHERED]), "nope", e, ctx),
      /No maintainer publicKey for keyId=nope/
    );
  });
});

describe("contract site 9 — signEvent path is unaffected", () => {
  it("signEvent still produces a crypto-verifiable signature (no time gate on signing)", () => {
    const kp = crypto.generateKeyPairSync("ed25519");
    const pem = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const event = {
      type: "AttestationPublished",
      repo: "test-org/widget",
      version: "1.0.0",
      commit: "a".repeat(40),
      timestamp: "2026-06-14T00:00:00.000Z",
      artifacts: [],
      attestations: [{ type: "sbom", uri: "x" }],
    };
    const signed = signEvent(event, pem, "any-key");
    assert.equal(signed.signature.keyId, "any-key");
    assert.equal(signed.signature.canonicalHash, computeCanonicalHash((() => { const c = { ...signed }; delete c.signature; return c; })()));
    const ok = crypto.verify(
      null,
      Buffer.from(signed.signature.canonicalHash, "hex"),
      kp.publicKey.export({ type: "spki", format: "pem" }).toString(),
      Buffer.from(signed.signature.value, "base64")
    );
    assert.equal(ok, true);
  });
});
