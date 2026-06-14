// Key-lifecycle regression at the attestor sig-chain (contract site 10, §5.3 + §9/§10).
//
// THE BUG: attest-release's checkSignatureChain did an UNTIMED maintainers.find() and verified the
// release against the matched key with ZERO time check. A compromise-revoked-but-still-listed key
// therefore PASSED signature.chain. This file pins the contract's required behavior:
//
//   1. Grandfather: a window-less maintainer verifies byte-identically to today (VALID when the
//      signature cryptographically verifies). Proves non-destructive.
//   2. Forged-window probe (§9/§10): a real, internally-consistent ReleasePublished, correctly
//      SIGNED by a now-compromise-revoked key with a backdated self-timestamp, anchored AFTER
//      invalidAfter => REJECTED. The crypto verifies; the TIME gate rejects.
//   3. Compromise + NO anchor (unprovable) => REJECTED (a compromised key needs a provable time).
//   4. Compromise + provably-old (anchored < invalidAfter) => VALID (compromise is not retroactive).
//   5. The signing path (signEvent) is unaffected — signing never applies the time gate.
//
// TEST-FIRST / RED before fix: on the pre-fix code path checkSignatureChain has no ctx and applies
// no predicate, so cases 2 and 3 would PASS (result === "pass"). These assertions turn that into
// failures. After the fix, the windowed key is rejected with a time-gate code carrying dec.reason.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Point the attestor at a crafted nodes dir BEFORE import (NODES_DIR is read at module load).
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-kw-sig-"));
const NODES = path.join(baseDir, "nodes");
process.env.REPOMESH_NODES_PATH = NODES;

const REPO = "test-org/widget";
// A bundled-trusted anchor node (must be in verifier.policy.json trustedAttestors so its
// self-asserted timestamp is a trusted offline clock — rung-2 gate, contract §5.2).
const ANCHOR_REPO = "mcp-tool-shop-org/repomesh-xrpl-anchor";

let checkSignatureChain;
let buildAttestorTimeCtx;
let signEvent;

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

// Write a node.json maintainer (optionally windowed) for REPO.
function writeNode(maintainer) {
  const [org, repoName] = REPO.split("/");
  fs.mkdirSync(path.join(NODES, org, repoName), { recursive: true });
  fs.writeFileSync(
    path.join(NODES, org, repoName, "node.json"),
    JSON.stringify({ id: REPO, maintainers: [maintainer] }),
    "utf8"
  );
}

// A real ReleasePublished signed (correctly) by `privateKey`/`keyId`, with a chosen self-timestamp.
function makeSignedRelease({ privateKey, keyId, timestamp }) {
  const ev = {
    type: "ReleasePublished",
    repo: REPO,
    version: "1.0.0",
    commit: "a".repeat(40),
    timestamp,
    artifacts: [{ name: "x.tgz", sha256: "b".repeat(64), uri: "https://example.com/x.tgz" }],
    attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }],
    signature: { alg: "ed25519", keyId, value: "", canonicalHash: "" },
  };
  const hash = canonicalHashOf(ev);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  ev.signature.value = sig.toString("base64");
  ev.signature.canonicalHash = hash;
  return ev;
}

// A bundled-trusted ledger.anchor AttestationPublished whose partition timestamp-range covers the
// release event, with a chosen anchor timestamp = the trusted offline clock.
function makeTrustedAnchorEvent({ anchorTs, partitionStart, partitionEnd, anchorPrivateKey, anchorKeyId }) {
  const meta = {
    txHash: "TX-FORGE",
    network: "testnet",
    partitionId: "p-test",
    partitionStart,
    partitionEnd,
    merkleRoot: "d".repeat(64),
  };
  const ev = {
    type: "AttestationPublished",
    repo: ANCHOR_REPO,
    timestamp: anchorTs,
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:TX-FORGE" }],
    notes: `ledger.anchor: pass\n${JSON.stringify(meta)}`,
    signature: { alg: "ed25519", keyId: anchorKeyId, value: "", canonicalHash: "" },
  };
  const hash = canonicalHashOf(ev);
  if (anchorPrivateKey) {
    ev.signature.value = crypto.sign(null, Buffer.from(hash, "hex"), anchorPrivateKey).toString("base64");
  }
  ev.signature.canonicalHash = hash;
  return ev;
}

// A compromise-revoked maintainer with invalidity date C.
const C = "2026-06-18T00:00:00.000Z";

describe("contract site 10 — attestor sig-chain key-window gate", () => {
  let kp, pubPem;
  before(async () => {
    kp = crypto.generateKeyPairSync("ed25519");
    pubPem = kp.publicKey.export({ type: "spki", format: "pem" }).toString();
    ({ checkSignatureChain, buildAttestorTimeCtx, signEvent } = await import("../scripts/attest-release.mjs"));
  });

  // --- §9.1 grandfather: window-less key behaves byte-identically to today --------------------
  it("grandfather: a window-less maintainer with a valid signature still PASSES (no time gate)", () => {
    writeNode({ name: "Legacy Dev", keyId: "legacy-key", publicKey: pubPem });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "legacy-key", timestamp: "2026-01-01T00:00:00.000Z" });
    // No ctx at all => exactly today's call shape. Must still pass.
    const r = checkSignatureChain(rel);
    assert.equal(r.result, "pass");
    assert.equal(r.code, "verified");
  });

  it("grandfather: passes even WITH a ctx supplied (predicate returns valid for window-less keys)", () => {
    writeNode({ name: "Legacy Dev", keyId: "legacy-key", publicKey: pubPem });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "legacy-key", timestamp: "2026-01-01T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass");
    assert.equal(r.code, "verified");
  });

  // --- §9/§10 forged-window probe: compromise-revoked key, crypto-valid, anchored AFTER C -----
  it("FORGED-WINDOW PROBE: a compromise-revoked key, correctly signed, backdated self-time, anchored AFTER C => REJECTED", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    // The release self-claims 2026-06-01 (< C) — a backdated, untrustworthy timestamp.
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-01T00:00:00.000Z" });

    // A TRUSTED anchor whose partition range covers the release; its timestamp proves the leaf
    // existed by 2026-06-19 (> C). The anchor signer is in trustedAttestors => bundled-trusted.
    const anchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-19T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorKeyId: "anchor-key",
    });

    const ctx = buildAttestorTimeCtx([rel, anchor]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail", "a provably-post-compromise signature must be rejected even though the crypto verifies");
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /compromise invalidity date/);
  });

  it("compromise + NO anchor (unprovable self-time) => REJECTED", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    // Self-time claims 2026-06-01 (< C) but there is NO anchor covering the leaf => unprovable.
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-01T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel]); // no anchor in the ledger
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /provable \(anchored\) signature time/);
  });

  it("compromise + provably-OLD (anchored BEFORE C) => VALID (compromise is not retroactive)", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-15T00:00:00.000Z" });
    // Trusted anchor proves the leaf existed by 2026-06-17 (< C).
    const anchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-17T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorKeyId: "anchor-key",
    });
    const ctx = buildAttestorTimeCtx([rel, anchor]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass", "a provably-pre-compromise signature must remain valid");
    assert.equal(r.code, "verified");
  });

  it("untrusted (forged) anchor does NOT rescue a compromised key — its timestamp is not a trusted clock", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-01T00:00:00.000Z" });
    // Anchor signer NOT in trustedAttestors => rung-2 gate fails => falls to self (unprovable) => reject.
    const anchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-10T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorKeyId: "anchor-key",
    });
    anchor.repo = "evil-org/forged-anchor"; // not in trustedAttestors
    const ctx = buildAttestorTimeCtx([rel, anchor]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail", "a forged anchor cannot provide a trusted clock for a compromised key");
    assert.equal(r.code, "key-time-invalid");
  });

  // --- §9.5 routine rotation is prospective; pre-R signatures stay valid ----------------------
  it("routine rotation: a signature BEFORE validUntil(R) stays VALID (trusts the self time)", () => {
    const R = "2026-06-14T12:00:00.000Z";
    writeNode({
      name: "Rotating Dev",
      keyId: "rotating-key",
      publicKey: pubPem,
      validUntil: R,
      revokedAt: R,
      revocationReason: "rotation",
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "rotating-key", timestamp: "2026-06-10T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel]); // self-time is trusted for routine rotation
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass");
    assert.equal(r.code, "verified");
  });

  it("routine rotation: a signature AT/AFTER validUntil(R) is REJECTED", () => {
    const R = "2026-06-14T12:00:00.000Z";
    writeNode({
      name: "Rotating Dev",
      keyId: "rotating-key",
      publicKey: pubPem,
      validUntil: R,
      revokedAt: R,
      revocationReason: "rotation",
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "rotating-key", timestamp: "2026-07-01T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /validUntil|rotated out/);
  });
});

// --- §9.5 / §11 signing path is unaffected ---------------------------------------------------
describe("contract site 10 — signing path (signEvent) is unaffected by the time gate", () => {
  before(async () => {
    if (!signEvent) ({ signEvent } = await import("../scripts/attest-release.mjs"));
  });

  it("signEvent produces a crypto-verifiable signature regardless of any window fields", () => {
    const kp = crypto.generateKeyPairSync("ed25519");
    const pem = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const ev = {
      type: "AttestationPublished",
      repo: REPO,
      version: "1.0.0",
      commit: "a".repeat(40),
      timestamp: "2026-06-14T00:00:00.000Z",
      artifacts: [],
      attestations: [{ type: "sbom", uri: "x" }],
    };
    const signed = signEvent(ev, pem, "any-key");
    assert.equal(signed.signature.keyId, "any-key");
    assert.ok(signed.signature.value && signed.signature.canonicalHash);
    // Independently verify the signature is well-formed.
    const stripped = JSON.parse(JSON.stringify(signed));
    delete stripped.signature;
    const hash = crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
    assert.equal(hash, signed.signature.canonicalHash, "signEvent must not be altered by the key-window work");
    const ok = crypto.verify(
      null,
      Buffer.from(hash, "hex"),
      kp.publicKey.export({ type: "spki", format: "pem" }).toString(),
      Buffer.from(signed.signature.value, "base64")
    );
    assert.equal(ok, true, "the signing path stays a pure crypto operation — no time gate");
  });
});
