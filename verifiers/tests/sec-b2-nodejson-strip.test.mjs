// Wave-B2 §12.1 node.json-STRIP regression at verifiers/lib/common.mjs getPublicKeyForKeyId
// (contract site 9).
//
// THE FINDING (cross-family verifier, HIGH): the timed getPublicKeyForKeyId reads window state from
// the node.json maintainer it found by keyId. A tampered node.json that STRIPS a compromise-revoked
// key's window fields re-grandfathers it (isWindowed=false => the predicate short-circuits VALID),
// even though the signed KeyRevocation event is STILL in the ledger.
//
// THE FIX (§12.1): the site derives the window from the SIGNED, AUTHORIZED KeyRevocation/KeyRotation
// events (deriveKeyWindowConstraints) and merges in the MOST RESTRICTIVE of node.json + derived
// (mergeStricterWindow) BEFORE applying isKeyValidForSignature. The events + repo + a per-site
// verifyAndAuthorize are threaded in via ctx (reusing the site's existing sig-verify + authorization
// machinery — a KeyRotation/KeyRevocation counts only if its signature verifies AND its signer is
// authorized per §4: surviving same-node key or trustedPolicy).
//
// TEST-FIRST / RED before the §12.1 wrap: the current timed path applies isKeyValidForSignature to the
// RAW node.json maintainer. With the window fields stripped that maintainer is grandfathered => the
// key resolves and the function RETURNS the PEM. This assertion (expecting a THROW carrying the
// compromise reason) turns that into RED. After the wrap (eff = mergeStricterWindow(maintainer,
// derived.get(keyId))), the function throws.
//
// GRANDFATHER stays byte-identical: with NO key-lifecycle events in ctx.events the derived map is
// EMPTY => mergeStricterWindow(maintainer, undefined) returns the maintainer unchanged => the bare
// and grandfather paths behave exactly as today (re-asserted here).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getPublicKeyForKeyId } from "../lib/common.mjs";

const C = "2026-06-18T00:00:00.000Z";
const HASH_REL = "a".repeat(64); // the release leaf (anchored)
const HASH_REV = "e".repeat(64); // the revocation event leaf (unanchored — irrelevant to its authority)

// Build the crypto keypairs once.
const compromisedKp = crypto.generateKeyPairSync("ed25519");
const survivingKp = crypto.generateKeyPairSync("ed25519");
const compromisedPem = compromisedKp.publicKey.export({ type: "spki", format: "pem" }).toString();
const survivingPem = survivingKp.publicKey.export({ type: "spki", format: "pem" }).toString();

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}
function canonicalHashOf(ev) {
  const stripped = JSON.parse(JSON.stringify(ev));
  delete stripped.signature;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
}

function node(maintainers) {
  return { id: "test-org/widget", maintainers };
}

// The release event whose key we're resolving: leaf HASH_REL, anchored AFTER C (provable post-compromise).
function release({ keyId = "compromised-key", timestamp = "2026-06-01T00:00:00.000Z" } = {}) {
  return {
    type: "ReleasePublished",
    repo: "test-org/widget",
    timestamp,
    signature: { alg: "ed25519", keyId, value: "sig", canonicalHash: HASH_REL },
  };
}

// A signed KeyRevocation(compromise, invalidAfter:C) for compromised-key, signed by the surviving key.
function makeSignedRevocation({ signerPrivateKey, signerKeyId }) {
  const ev = {
    type: "KeyRevocation",
    repo: "test-org/widget",
    timestamp: "2026-06-20T09:00:00.000Z",
    key: { action: "revoke", revokedKeyId: "compromised-key", reason: "compromise", invalidAfter: C },
    signature: { alg: "ed25519", keyId: signerKeyId, value: "", canonicalHash: "" },
  };
  const hash = canonicalHashOf(ev);
  ev.signature.value = crypto.sign(null, Buffer.from(hash, "hex"), signerPrivateKey).toString("base64");
  ev.signature.canonicalHash = hash;
  return ev;
}

// ctx that anchors HASH_REL to a TRUSTED anchor at the given timestamp, AND carries the loaded events
// + repo + a verifyAndAuthorize that reuses the same-node PEM machinery (path A: a surviving same-node
// key, != the revoked key, whose signature verifies). This mirrors what the site builds in production.
function ctxFor(events, { anchorTs = "2026-06-19T00:00:00.000Z" } = {}) {
  const anchor = { type: "AttestationPublished", timestamp: anchorTs, signature: { canonicalHash: "c".repeat(64) } };
  const nodeManifest = node([
    { name: "Compromised Dev", keyId: "compromised-key", publicKey: compromisedPem }, // STRIPPED window
    { name: "Surviving Dev", keyId: "surviving-key", publicKey: survivingPem },
  ]);
  return {
    findEarliestAnchorForLeaf: (leaf) => (leaf === HASH_REL ? { anchor } : null),
    isBundledTrustedAnchor: () => true,
    events,
    repo: "test-org/widget",
    // Reuse the site's existing sig-verify + authorization machinery: an event counts only if its
    // signature verifies against a SURVIVING same-node key (!= the affected/revoked key) per §4.2.
    verifyAndAuthorize: (ev) => {
      const signerKeyId = ev?.signature?.keyId;
      const affected = ev?.key?.action === "revoke" ? ev?.key?.revokedKeyId : ev?.key?.retiringKeyId;
      if (!signerKeyId || signerKeyId === affected) return false; // §4.2: not the revoked key itself
      const signer = nodeManifest.maintainers.find((m) => m.keyId === signerKeyId);
      if (!signer?.publicKey) return false;
      try {
        return crypto.verify(
          null,
          Buffer.from(ev.signature.canonicalHash, "hex"),
          String(signer.publicKey).trim(),
          Buffer.from(ev.signature.value || "", "base64")
        );
      } catch {
        return false;
      }
    },
  };
}

describe("Wave-B2 §12.1 — getPublicKeyForKeyId node.json-STRIP bypass closed", () => {
  it("STRIPPED node.json + signed KeyRevocation in events => post-compromise key STILL THROWS", () => {
    const revocation = makeSignedRevocation({ signerPrivateKey: survivingKp.privateKey, signerKeyId: "surviving-key" });
    const rel = release();
    const ctx = ctxFor([rel, revocation]);
    const manifest = node([
      { name: "Compromised Dev", keyId: "compromised-key", publicKey: compromisedPem }, // window STRIPPED
      { name: "Surviving Dev", keyId: "surviving-key", publicKey: survivingPem },
    ]);
    assert.throws(
      () => getPublicKeyForKeyId(manifest, "compromised-key", rel, ctx),
      /compromise invalidity date/,
      "a stripped node.json must not re-grandfather a key the signed ledger event revoked for compromise"
    );
  });

  it("STRIPPED node.json + UNAUTHORIZED (self-signed) revocation => key RESOLVES (forged event has no authority)", () => {
    // Self-signed by the compromised key => unauthorized (§4.2) => contributes NO derived constraint.
    const forged = makeSignedRevocation({ signerPrivateKey: compromisedKp.privateKey, signerKeyId: "compromised-key" });
    const rel = release();
    const ctx = ctxFor([rel, forged]);
    const manifest = node([
      { name: "Compromised Dev", keyId: "compromised-key", publicKey: compromisedPem },
      { name: "Surviving Dev", keyId: "surviving-key", publicKey: survivingPem },
    ]);
    const pk = getPublicKeyForKeyId(manifest, "compromised-key", rel, ctx);
    assert.equal(pk, compromisedPem.trim(), "an unauthorized revocation must not impose a window via derive-stricter");
  });

  it("GRANDFATHER byte-identical: no key events => empty constraints => key RESOLVES (today's behavior)", () => {
    const rel = release({ keyId: "legacy-key" });
    const manifest = node([{ name: "Legacy", keyId: "legacy-key", publicKey: survivingPem }]);
    const ctx = ctxFor([rel]); // no key-lifecycle events
    const pk = getPublicKeyForKeyId(manifest, "legacy-key", rel, ctx);
    assert.equal(pk, survivingPem.trim(), "a window-less key with no key events grandfathers exactly as today");
  });

  it("GRANDFATHER byte-identical: bare 2-arg signing path unchanged (no events, no ctx)", () => {
    const manifest = node([{ name: "Legacy", keyId: "legacy-key", publicKey: survivingPem }]);
    const pk = getPublicKeyForKeyId(manifest, "legacy-key");
    assert.equal(pk, survivingPem.trim());
  });
});
