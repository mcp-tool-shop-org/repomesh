// Wave-B3 §13.1 residual-③ regression at verifiers/lib/common.mjs getPublicKeyForKeyId
// (contract site 9).
//
// THE FINDING (cross-family re-verify, HIGH on an untrusted node.json source): the Wave-B2
// derive-stricter protects the MAIN resolution path, but the pre-B3 AUTHORIZATION sub-check validated
// a KeyRotation/KeyRevocation's *signer* against node.json ALONE (the per-site verifyAndAuthorize,
// "no re-entry, avoid recursion"). Exploit: an attacker holds compromise-revoked key K_a and serves a
// tampered node.json that STRIPS K_a's window. The MAIN path still rejects K_a's own releases (①). But
// the AUTH path sees K_a valid in the stripped node.json => K_a is allowed to authorize a LATER
// `KeyRotation K_a -> K_b` => K_b gets a FRESH derived window. Trust re-established via rotation.
//
// THE FIX (§13.1): deriveKeyWindowConstraints became an ORDER-AWARE single forward pass with the §4
// authorization VALIDITY decision CONSOLIDATED into the shared module. For each key-lifecycle event E
// signed by S, E is applied iff (a) E's signature verifies; (b) S is a surviving same-node key (!= the
// revoked/retiring key) OR a trustedPolicy node; AND (c) S is itself VALID at timeOf(E) per the SAME
// derive-stricter predicate evaluated against the window state from STRICTLY-EARLIER events
// (derivedSoFar). Because K_a's compromise-revocation R precedes the rotation ROT in ledger order, at
// timeOf(ROT) K_a is already INVALID per derivedSoFar => ROT is UNAUTHORIZED => K_b gets NO fresh
// window. The site supplies only I/O (verifySignature/getMaintainer/timeOf/trustedPolicy) built from
// its EXISTING node.json + canonical-hash + ed25519 machinery — the per-site auth logic is deleted.
//
// TEST-FIRST / RED before the §13.1 adapt: the pre-B3 site built the LEGACY order-INSENSITIVE opts
// (`{ verifyAndAuthorize }`), whose signer check trusts the (stripped) node.json alone. So K_a's
// rotation is AUTHORIZED there and K_b receives a spurious `validFrom = effectiveAt`. A K_b release
// anchored at a trusted time BETWEEN R's effect and effectiveAt is then REJECTED ("predates
// validFrom") on the broken code, but on the FIXED code K_a's rotation is denied, K_b receives NO
// spurious window, and the window-less K_b grandfathers => the release RESOLVES. (The discriminating
// observable: the K_a-signed LATER rotation must contribute NOTHING. The contract's literal "K_b
// REJECTED at every layer" is the coordinator's END-TO-END probe where the TRUSTED node.json never
// registered K_b — at this single-key-resolution unit site the load-bearing flip is the rotation's
// denial of K_b's fresh window, asserted directly on the derived map below.)
//
// GRANDFATHER stays byte-identical: no key events => empty derived map => maintainer unchanged.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getPublicKeyForKeyId } from "../lib/common.mjs";
import { deriveKeyWindowConstraints } from "../lib/key-window.mjs";

const REPO = "test-org/widget";
const C = "2026-06-18T00:00:00.000Z";              // K_a compromise invalidity date
const EFFECTIVE_AT = "2026-06-25T12:00:00.000Z";    // the rotation's effectiveAt (AFTER C)

// keypairs: K_a (compromised), K_b (rotation target), K_surv (surviving same-node key)
const kaKp = crypto.generateKeyPairSync("ed25519");
const kbKp = crypto.generateKeyPairSync("ed25519");
const survKp = crypto.generateKeyPairSync("ed25519");
const kaPem = kaKp.publicKey.export({ type: "spki", format: "pem" }).toString();
const kbPem = kbKp.publicKey.export({ type: "spki", format: "pem" }).toString();
const survPem = survKp.publicKey.export({ type: "spki", format: "pem" }).toString();

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
function sign(ev, priv, keyId) {
  ev.signature = { alg: "ed25519", keyId, value: "", canonicalHash: "" };
  const h = canonicalHashOf(ev);
  ev.signature.value = crypto.sign(null, Buffer.from(h, "hex"), priv).toString("base64");
  ev.signature.canonicalHash = h;
  return ev;
}

// R: a SIGNED KeyRevocation(compromise, invalidAfter=C) of K_a, signed by the SURVIVING same-node key.
// EARLIER in ledger order.
function signedRevocation() {
  return sign(
    {
      type: "KeyRevocation",
      repo: REPO,
      timestamp: "2026-06-20T09:00:00.000Z",
      key: { action: "revoke", revokedKeyId: "K_a", reason: "compromise", invalidAfter: C },
    },
    survKp.privateKey,
    "K_surv"
  );
}
// ROT: a SIGNED KeyRotation K_a -> K_b, SELF-SIGNED by the (revoked) K_a. LATER in ledger order.
function signedRotation() {
  return sign(
    {
      type: "KeyRotation",
      repo: REPO,
      timestamp: EFFECTIVE_AT,
      key: { action: "rotate", retiringKeyId: "K_a", newKeyId: "K_b", newPublicKey: kbPem, effectiveAt: EFFECTIVE_AT },
    },
    kaKp.privateKey,
    "K_a"
  );
}
// A release SIGNED by K_b (the rotation target). Its leaf is its real signature.canonicalHash; the ctx
// anchors THAT leaf to a chosen trusted time so we can drive the predicate deterministically.
function kbRelease() {
  return sign(
    {
      type: "ReleasePublished",
      repo: REPO,
      version: "1.0.0",
      commit: "a".repeat(40),
      timestamp: "2026-06-26T00:00:00.000Z",
      artifacts: [],
      attestations: [],
    },
    kbKp.privateKey,
    "K_b"
  );
}

// node.json with K_a's window STRIPPED (attacker re-grandfathers it), K_surv valid, K_b WINDOW-LESS
// (the attacker simply added it). Optional extra fields per maintainer via `kbExtra`.
function strippedNode(kbExtra = {}) {
  return {
    id: REPO,
    maintainers: [
      { name: "Compromised Dev", keyId: "K_a", publicKey: kaPem }, // window STRIPPED
      { name: "Surviving Dev", keyId: "K_surv", publicKey: survPem },
      { name: "Rotation Target", keyId: "K_b", publicKey: kbPem, ...kbExtra },
    ],
  };
}

// A B2-style LEGACY verifyAndAuthorize (order-INSENSITIVE) that validates a key-event's signer against
// node.json ALONE — the exact pre-B3 site behavior. Included on the ctx ONLY to make the SITE subtest a
// genuine TEST-FIRST regression: the pre-adapt (post-Wave-B2) site reads ctx.verifyAndAuthorize and so
// order-insensitively AUTHORIZES K_a's rotation (K_a is STRIPPED => grandfathered-valid in node.json),
// granting K_b a spurious validFrom and REJECTING a pre-effectiveAt K_b release. The §13.1-adapted site
// IGNORES this field — it builds the NEW order-aware opts itself — so the rotation is denied and the
// release RESOLVES. (After §13.1 lands repo-wide this field is dead; it exists purely to pin RED→GREEN.)
function legacyVerifyAndAuthorize(node) {
  const verifyEventSig = (ev, pem) => {
    const stripped = JSON.parse(JSON.stringify(ev));
    delete stripped.signature;
    const h = crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
    if (h !== ev.signature.canonicalHash) return false;
    return crypto.verify(null, Buffer.from(h, "hex"), String(pem).trim(), Buffer.from(ev.signature.value, "base64"));
  };
  return (ev) => {
    if (!ev || (ev.type !== "KeyRotation" && ev.type !== "KeyRevocation")) return false;
    const signerKeyId = ev?.signature?.keyId;
    const action = ev?.key?.action;
    const affected = action === "rotate" ? ev?.key?.retiringKeyId : ev?.key?.revokedKeyId;
    if (!signerKeyId) return false;
    if (signerKeyId === affected && action !== "rotate") return false; // revoked key can't revoke itself
    const signer = (node.maintainers || []).find((m) => m.keyId === signerKeyId);
    if (!signer?.publicKey) return false;
    return verifyEventSig(ev, signer.publicKey); // NO signer-validity-against-earlier-events check (the ③ gap)
  };
}

// ctx anchoring the RELEASE's leaf to a TRUSTED anchor at the given timestamp, + the loaded events. The
// §13.1-adapted site builds the NEW order-aware opts from nodeManifest + this ctx itself; the
// verifyAndAuthorize on the ctx is the LEGACY field used ONLY to drive the pre-adapt site's exploit so
// this regression is genuinely RED before the adapt. `relLeaf` is the release's real canonicalHash.
function ctxAnchoring(events, anchorTs, relLeaf) {
  const anchor = { type: "AttestationPublished", timestamp: anchorTs, signature: { canonicalHash: "c".repeat(64) } };
  return {
    findEarliestAnchorForLeaf: (leaf) => (leaf === relLeaf ? { anchor } : null),
    isBundledTrustedAnchor: () => true,
    events,
    repo: REPO,
    trustedPolicy: new Set(),
    verifyAndAuthorize: legacyVerifyAndAuthorize(strippedNode()),
  };
}

describe("§13.1 ③ — getPublicKeyForKeyId order-aware authorization (a revoked key cannot authorize a later rotation)", () => {
  it("DERIVE: K_a-signed LATER rotation (after an EARLIER compromise-revocation) grants K_b NO window", () => {
    // This is the load-bearing assertion (mirrors D-shared's unit case) exercised through the SITE's
    // own NEW-shape opts builder: build the opts the way the site does and confirm the rotation is
    // denied. RED on the pre-B3 LEGACY opts (order-insensitive => K_b would get validFrom).
    const R = signedRevocation();
    const ROT = signedRotation();
    const node = strippedNode();

    // Build the SAME NEW-shape opts the site builds internally (verify against node.json PEMs).
    const maintainerIn = (m, kid) => (m.maintainers || []).find((x) => x.keyId === kid) || null;
    const verifyEventSig = (ev, pem) => {
      const stripped = JSON.parse(JSON.stringify(ev));
      delete stripped.signature;
      const h = crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
      if (h !== ev.signature.canonicalHash) return false;
      return crypto.verify(null, Buffer.from(h, "hex"), String(pem).trim(), Buffer.from(ev.signature.value, "base64"));
    };
    const opts = {
      verifySignature: (ev) => {
        const signer = maintainerIn(node, ev.signature.keyId);
        if (signer?.publicKey && verifyEventSig(ev, signer.publicKey)) {
          return { ok: true, signerKeyId: ev.signature.keyId, signerNodeRepo: ev.repo };
        }
        return { ok: false };
      },
      getMaintainer: (keyId) => maintainerIn(node, keyId),
      timeOf: (ev) => ({ time: new Date(ev.timestamp), provable: true, source: "anchor-event" }),
      trustedPolicy: new Set(),
    };

    const map = deriveKeyWindowConstraints([R, ROT], REPO, opts);
    // R is authorized (K_surv != K_a, valid) => K_a gets the compromise window.
    assert.equal(map.get("K_a").revocationReason, "compromise");
    // ROT is signed by K_a, which is INVALID at EFFECTIVE_AT (> C) per derivedSoFar => UNAUTHORIZED.
    assert.equal(map.get("K_b"), undefined, "an already-compromise-revoked K_a must NOT authorize the later K_a->K_b rotation");
  });

  it("SITE: window-less K_b release at a trusted time BEFORE effectiveAt RESOLVES (rotation denied => no spurious validFrom)", () => {
    // RED on current/legacy: the order-insensitive opts authorize ROT, K_b gets validFrom=effectiveAt,
    // the release anchored 2026-06-24 (< effectiveAt) is REJECTED ("predates validFrom") => THROW.
    // GREEN after §13.1: ROT denied, K_b window-less => grandfathered => the key RESOLVES.
    const R = signedRevocation();
    const ROT = signedRotation();
    const rel = kbRelease();
    const ctx = ctxAnchoring([R, ROT, rel], "2026-06-24T00:00:00.000Z", rel.signature.canonicalHash); // trusted time BETWEEN R and effectiveAt
    const pk = getPublicKeyForKeyId(strippedNode(), "K_b", rel, ctx);
    assert.equal(
      pk,
      kbPem.trim(),
      "K_a's unauthorized rotation must not impose a validFrom on K_b — the window-less K_b grandfathers"
    );
  });

  it("CONTRACT REJECT INVARIANT: if node.json itself windows K_b (validFrom=effectiveAt), a pre-effectiveAt release is REJECTED", () => {
    // Holds under the fix: K_b carries a legitimate node.json validFrom; a release anchored before it
    // is out of window. This pins the post-fix invariant (a key is only valid from its window onward).
    const rel = kbRelease();
    const ctx = ctxAnchoring([rel], "2026-06-24T00:00:00.000Z", rel.signature.canonicalHash); // anchored BEFORE effectiveAt
    assert.throws(
      () => getPublicKeyForKeyId(strippedNode({ validFrom: EFFECTIVE_AT }), "K_b", rel, ctx),
      /predates validFrom/,
      "a release whose trusted time precedes K_b's validFrom must be rejected"
    );
  });

  it("CONVERSE: a rotation BEFORE the revocation still stands — K_b gains its window (K_a was valid then)", () => {
    // Ledger order REVERSED: ROT (K_a valid, rotates to K_b) BEFORE R (later compromise-revokes K_a).
    const ROT = sign(
      {
        type: "KeyRotation",
        repo: REPO,
        timestamp: "2026-06-10T12:00:00.000Z",
        key: { action: "rotate", retiringKeyId: "K_a", newKeyId: "K_b", newPublicKey: kbPem, effectiveAt: "2026-06-10T12:00:00.000Z" },
      },
      kaKp.privateKey,
      "K_a"
    );
    const R = signedRevocation();
    const node = strippedNode();
    const maintainerIn = (m, kid) => (m.maintainers || []).find((x) => x.keyId === kid) || null;
    const verifyEventSig = (ev, pem) => {
      const stripped = JSON.parse(JSON.stringify(ev));
      delete stripped.signature;
      const h = crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
      if (h !== ev.signature.canonicalHash) return false;
      return crypto.verify(null, Buffer.from(h, "hex"), String(pem).trim(), Buffer.from(ev.signature.value, "base64"));
    };
    const opts = {
      verifySignature: (ev) => {
        const signer = maintainerIn(node, ev.signature.keyId);
        return signer?.publicKey && verifyEventSig(ev, signer.publicKey)
          ? { ok: true, signerKeyId: ev.signature.keyId, signerNodeRepo: ev.repo }
          : { ok: false };
      },
      getMaintainer: (keyId) => maintainerIn(node, keyId),
      timeOf: (ev) => ({ time: new Date(ev.timestamp), provable: true, source: "anchor-event" }),
      trustedPolicy: new Set(),
    };
    const map = deriveKeyWindowConstraints([ROT, R], REPO, opts);
    assert.ok(map.get("K_b"), "a rotation that precedes the signer's revocation is authorized => K_b gets a window");
    assert.equal(map.get("K_b").validFrom.toISOString(), new Date("2026-06-10T12:00:00.000Z").toISOString());
  });

  it("GRANDFATHER byte-identical: no key-lifecycle events => K_b resolves (today's behavior)", () => {
    const rel = kbRelease();
    const ctx = ctxAnchoring([rel], "2026-06-26T00:00:00.000Z", rel.signature.canonicalHash);
    const pk = getPublicKeyForKeyId(strippedNode(), "K_b", rel, ctx);
    assert.equal(pk, kbPem.trim());
  });
});
