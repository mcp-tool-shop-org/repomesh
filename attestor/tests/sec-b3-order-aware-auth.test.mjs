// Wave-B3 §13.1 residual-③ regression at the attestor sig-chain (contract site 10).
//
// THE FINDING (cross-family re-verify, HIGH on an untrusted node.json source): the Wave-B2
// derive-stricter protects the MAIN resolution path, but the pre-B3 AUTHORIZATION sub-check (the
// attestor's internal makeVerifyAndAuthorize) validated a KeyRotation/KeyRevocation's *signer* against
// node.json ALONE, order-INSENSITIVELY. Exploit: an attacker holds compromise-revoked key K_a and
// serves a tampered node.json that STRIPS K_a's window. The MAIN path still rejects K_a's own releases
// (①). But the order-insensitive auth path sees K_a valid in the stripped node.json => K_a is allowed
// to authorize a LATER `KeyRotation K_a -> K_b` => K_b gets a FRESH derived window. Trust re-established.
//
// THE FIX (§13.1): the attestor now feeds deriveKeyWindowConstraints the NEW-shape opts
// (verifySignature/getMaintainer/timeOf/trustedPolicy) and the shared module runs an ORDER-AWARE single
// forward pass with the §4 authorization VALIDITY decision consolidated inside it. Because K_a's
// compromise-revocation R precedes the rotation ROT in ledger order, at timeOf(ROT) K_a is already
// INVALID per derivedSoFar => ROT is UNAUTHORIZED => K_b gets NO fresh window. The internal per-site
// makeVerifyAndAuthorize is DELETED (it was a latent drift surface).
//
// TEST-FIRST / RED before the §13.1 adapt: on the pre-adapt attestor the internal order-INSENSITIVE
// auth authorizes K_a's rotation (K_a STRIPPED => grandfathered in node.json), so K_b receives a
// spurious validFrom = effectiveAt. A K_b release with a provable anchored time BETWEEN R's effect and
// effectiveAt is then REJECTED ("predates validFrom") => result "fail". This assertion (expecting the
// release to VERIFY) turns that into RED. After the §13.1 adapt the rotation is denied, K_b window-less
// in node.json grandfathers, and the release VERIFIES => "pass".
//
// (The contract's literal "K_b REJECTED at every layer" is the coordinator's END-TO-END probe where the
// TRUSTED node.json never registered K_b; at this single-key sig-chain unit site the load-bearing flip
// is the rotation's denial of K_b's spurious window — pinned here.)
//
// GRANDFATHER stays byte-identical: no KeyRevocation/KeyRotation events => empty constraints => VALID.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Point the attestor at a crafted nodes dir BEFORE import (NODES_DIR is read at module load).
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-b3-auth-"));
const NODES = path.join(baseDir, "nodes");
process.env.REPOMESH_NODES_PATH = NODES;

const REPO = "test-org/widget";
// A bundled-trusted anchor node (must be in verifier.policy.json trustedAttestors so its self-asserted
// timestamp is a trusted offline clock — rung-2 gate, contract §5.2).
const ANCHOR_REPO = "mcp-tool-shop-org/repomesh-xrpl-anchor";

const C = "2026-06-18T00:00:00.000Z";              // K_a compromise invalidity date
const EFFECTIVE_AT = "2026-06-25T12:00:00.000Z";    // the rotation's effectiveAt (AFTER C)

let checkSignatureChain;
let buildAttestorTimeCtx;

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

// Write node.json for REPO with the given maintainers array (each as-is).
function writeNode(maintainers) {
  const [org, repoName] = REPO.split("/");
  fs.mkdirSync(path.join(NODES, org, repoName), { recursive: true });
  fs.writeFileSync(path.join(NODES, org, repoName, "node.json"), JSON.stringify({ id: REPO, maintainers }), "utf8");
}

// A bundled-trusted ledger.anchor AttestationPublished whose partition timestamp-range covers the K_b
// release, with a chosen anchor timestamp = the trusted offline clock.
function makeTrustedAnchorEvent({ anchorTs, partitionStart, partitionEnd }) {
  const meta = { txHash: "TX-B3", network: "testnet", partitionId: "p-b3", partitionStart, partitionEnd, merkleRoot: "d".repeat(64) };
  const ev = {
    type: "AttestationPublished",
    repo: ANCHOR_REPO,
    timestamp: anchorTs,
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:TX-B3" }],
    notes: `ledger.anchor: pass\n${JSON.stringify(meta)}`,
    signature: { alg: "ed25519", keyId: "anchor-key", value: "", canonicalHash: "" },
  };
  ev.signature.canonicalHash = canonicalHashOf(ev);
  return ev;
}

describe("Wave-B3 §13.1 — attestor sig-chain order-aware authorization (a revoked key cannot authorize a later rotation)", () => {
  let kaKp, kbKp, survKp, kaPem, kbPem, survPem;
  before(async () => {
    kaKp = crypto.generateKeyPairSync("ed25519");
    kbKp = crypto.generateKeyPairSync("ed25519");
    survKp = crypto.generateKeyPairSync("ed25519");
    kaPem = kaKp.publicKey.export({ type: "spki", format: "pem" }).toString();
    kbPem = kbKp.publicKey.export({ type: "spki", format: "pem" }).toString();
    survPem = survKp.publicKey.export({ type: "spki", format: "pem" }).toString();
    ({ checkSignatureChain, buildAttestorTimeCtx } = await import("../scripts/attest-release.mjs"));
  });

  // R: SIGNED KeyRevocation(compromise, invalidAfter=C) of K_a, signed by the SURVIVING same-node key.
  // EARLIER in ledger order.
  function signedRevocation() {
    return sign(
      { type: "KeyRevocation", repo: REPO, timestamp: "2026-06-20T09:00:00.000Z", key: { action: "revoke", revokedKeyId: "K_a", reason: "compromise", invalidAfter: C } },
      survKp.privateKey,
      "K_surv"
    );
  }
  // ROT: SIGNED KeyRotation K_a -> K_b, SELF-SIGNED by the (revoked) K_a. LATER in ledger order.
  function signedRotation() {
    return sign(
      { type: "KeyRotation", repo: REPO, timestamp: EFFECTIVE_AT, key: { action: "rotate", retiringKeyId: "K_a", newKeyId: "K_b", newPublicKey: kbPem, effectiveAt: EFFECTIVE_AT } },
      kaKp.privateKey,
      "K_a"
    );
  }
  // A release SIGNED by K_b, self-timestamp inside the anchor partition so the anchor proves its time.
  function kbRelease(selfTs) {
    return sign(
      { type: "ReleasePublished", repo: REPO, version: "1.0.0", commit: "a".repeat(40), timestamp: selfTs, artifacts: [{ name: "x.tgz", sha256: "b".repeat(64), uri: "https://example.com/x.tgz" }], attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }] },
      kbKp.privateKey,
      "K_b"
    );
  }

  it("STRIPPED node.json + K_a-signed LATER rotation (after EARLIER compromise-revocation) => K_b release VERIFIES (rotation denied, no spurious validFrom)", () => {
    // node.json: K_a's window STRIPPED (grandfathered alone), K_surv valid, K_b WINDOW-LESS (added by
    // the attacker). The legitimate way K_b would be REJECTED on the broken code: the order-insensitive
    // auth authorizes K_a's rotation, granting K_b validFrom=effectiveAt, and the pre-effectiveAt
    // release predates it. The fix denies the rotation => K_b grandfathers => the release verifies.
    writeNode([
      { name: "Compromised Dev", keyId: "K_a", publicKey: kaPem }, // window STRIPPED
      { name: "Surviving Dev", keyId: "K_surv", publicKey: survPem },
      { name: "Rotation Target", keyId: "K_b", publicKey: kbPem }, // window-less
    ]);

    // The K_b release self-claims a time BEFORE effectiveAt; the anchor proves it existed by 2026-06-24
    // (also < effectiveAt). On the broken code K_b would have validFrom=effectiveAt => predates => fail.
    const rel = kbRelease("2026-06-23T00:00:00.000Z");
    const anchor = makeTrustedAnchorEvent({ anchorTs: "2026-06-24T00:00:00.000Z", partitionStart: "2026-05-01T00:00:00.000Z", partitionEnd: "2026-06-30T00:00:00.000Z" });
    const R = signedRevocation();
    const ROT = signedRotation();

    const ctx = buildAttestorTimeCtx([rel, anchor, R, ROT]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass", "K_a's already-compromise-revoked key must NOT authorize the later rotation, so K_b gets no spurious validFrom");
    assert.equal(r.code, "verified");
  });

  it("CONTRACT REJECT INVARIANT: K_b windowed in node.json (validFrom=effectiveAt) + a provable pre-effectiveAt release => REJECTED", () => {
    // Holds under the fix: a key is only valid from its window onward. A release provably anchored
    // before K_b's validFrom is out of window.
    writeNode([
      { name: "Rotation Target", keyId: "K_b", publicKey: kbPem, validFrom: EFFECTIVE_AT },
    ]);
    const rel = kbRelease("2026-06-23T00:00:00.000Z");
    const anchor = makeTrustedAnchorEvent({ anchorTs: "2026-06-24T00:00:00.000Z", partitionStart: "2026-05-01T00:00:00.000Z", partitionEnd: "2026-06-30T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel, anchor]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /predates validFrom/);
  });

  it("PRIOR-PROBE STILL GREEN (①): STRIPPED node.json + signed compromise-revocation => K_a's own post-compromise release STILL REJECTED", () => {
    // The §13.1 change must not regress Finding ①: derive-stricter still rejects K_a's own releases.
    writeNode([
      { name: "Compromised Dev", keyId: "K_a", publicKey: kaPem }, // window STRIPPED
      { name: "Surviving Dev", keyId: "K_surv", publicKey: survPem },
    ]);
    const rel = sign(
      { type: "ReleasePublished", repo: REPO, version: "2.0.0", commit: "c".repeat(40), timestamp: "2026-06-01T00:00:00.000Z", artifacts: [{ name: "y.tgz", sha256: "e".repeat(64), uri: "https://example.com/y.tgz" }], attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }] },
      kaKp.privateKey,
      "K_a"
    );
    const anchor = makeTrustedAnchorEvent({ anchorTs: "2026-06-19T00:00:00.000Z", partitionStart: "2026-05-01T00:00:00.000Z", partitionEnd: "2026-06-30T00:00:00.000Z" });
    const R = signedRevocation();
    const ctx = buildAttestorTimeCtx([rel, anchor, R]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /compromise invalidity date/);
  });

  it("GRANDFATHER byte-identical: no KeyRevocation/KeyRotation events => K_b release VERIFIES (today's behavior)", () => {
    writeNode([{ name: "Rotation Target", keyId: "K_b", publicKey: kbPem }]);
    const rel = kbRelease("2026-01-01T00:00:00.000Z");
    const ctx = buildAttestorTimeCtx([rel]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass");
    assert.equal(r.code, "verified");
  });
});
