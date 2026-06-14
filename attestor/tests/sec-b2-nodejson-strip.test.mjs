// Wave-B2 §12.1 node.json-STRIP regression at the attestor sig-chain (contract site 10).
//
// THE FINDING (cross-family verifier, HIGH): the non-validate-ledger verifiers read window state
// from node.json and do NOT run the §8 ledger binding check. A tampered node.json that STRIPS a
// compromise-revoked key's window fields re-grandfathers it (isWindowed=false => VALID), even
// though the signed KeyRevocation event is STILL in the ledger.
//
// THE FIX (§12.1): each site derives the window from the SIGNED, AUTHORIZED KeyRevocation/KeyRotation
// events and merges in the MOST RESTRICTIVE of node.json + derived. A stripped node.json then only
// LOSES restriction it should not, but the derived constraint re-imposes it. The site STILL rejects.
//
// TEST-FIRST / RED before the §12.1 wrap: on the current (post-Wave-B) checkSignatureChain the key
// resolves only from node.json. With the window fields stripped the maintainer is grandfathered, the
// crypto verifies, and the result is "pass". This assertion (expecting REJECT) turns that into RED.
// After the §12.1 wrap (derive-stricter from the ledger events), it passes.
//
// GRANDFATHER stays byte-identical: the §9 grandfather case (no KeyRevocation/KeyRotation events for
// the repo) still produces an EMPTY constraint map => maintainer unchanged => VALID, re-asserted here.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Point the attestor at a crafted nodes dir BEFORE import (NODES_DIR is read at module load).
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-b2-strip-"));
const NODES = path.join(baseDir, "nodes");
process.env.REPOMESH_NODES_PATH = NODES;

const REPO = "test-org/widget";
// A bundled-trusted anchor node (must be in verifier.policy.json trustedAttestors so its
// self-asserted timestamp is a trusted offline clock — rung-2 gate, contract §5.2).
const ANCHOR_REPO = "mcp-tool-shop-org/repomesh-xrpl-anchor";

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

// Write a node.json for REPO with the given maintainers array (each as-is).
function writeNode(maintainers) {
  const [org, repoName] = REPO.split("/");
  fs.mkdirSync(path.join(NODES, org, repoName), { recursive: true });
  fs.writeFileSync(
    path.join(NODES, org, repoName, "node.json"),
    JSON.stringify({ id: REPO, maintainers }),
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
function makeTrustedAnchorEvent({ anchorTs, partitionStart, partitionEnd }) {
  const meta = {
    txHash: "TX-B2",
    network: "testnet",
    partitionId: "p-b2",
    partitionStart,
    partitionEnd,
    merkleRoot: "d".repeat(64),
  };
  const ev = {
    type: "AttestationPublished",
    repo: ANCHOR_REPO,
    timestamp: anchorTs,
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:TX-B2" }],
    notes: `ledger.anchor: pass\n${JSON.stringify(meta)}`,
    signature: { alg: "ed25519", keyId: "anchor-key", value: "", canonicalHash: "" },
  };
  ev.signature.canonicalHash = canonicalHashOf(ev);
  return ev;
}

// A signed KeyRevocation(reason:compromise, invalidAfter:C) for `revokedKeyId`, signed by a SURVIVING
// same-node key (`signerPrivateKey`/`signerKeyId`). The signature is real so verifyAndAuthorize at the
// site can verify it against the surviving key's PEM in node.json.
function makeSignedRevocation({ revokedKeyId, invalidAfter, timestamp, signerPrivateKey, signerKeyId }) {
  const ev = {
    type: "KeyRevocation",
    repo: REPO,
    timestamp,
    key: { action: "revoke", revokedKeyId, reason: "compromise", invalidAfter },
    signature: { alg: "ed25519", keyId: signerKeyId, value: "", canonicalHash: "" },
  };
  const hash = canonicalHashOf(ev);
  ev.signature.value = crypto.sign(null, Buffer.from(hash, "hex"), signerPrivateKey).toString("base64");
  ev.signature.canonicalHash = hash;
  return ev;
}

const C = "2026-06-18T00:00:00.000Z";

describe("Wave-B2 §12.1 — attestor sig-chain node.json-STRIP bypass closed", () => {
  let compromisedKp, survivingKp, compromisedPem, survivingPem;
  before(async () => {
    compromisedKp = crypto.generateKeyPairSync("ed25519");
    survivingKp = crypto.generateKeyPairSync("ed25519");
    compromisedPem = compromisedKp.publicKey.export({ type: "spki", format: "pem" }).toString();
    survivingPem = survivingKp.publicKey.export({ type: "spki", format: "pem" }).toString();
    ({ checkSignatureChain, buildAttestorTimeCtx } = await import("../scripts/attest-release.mjs"));
  });

  it("STRIPPED node.json + signed KeyRevocation in ledger => post-compromise signature STILL REJECTED", () => {
    // node.json: the compromised key's window fields are STRIPPED (only keyId+publicKey) — it
    // grandfathers on node.json alone. A surviving same-node key signs the revocation.
    writeNode([
      { name: "Compromised Dev", keyId: "compromised-key", publicKey: compromisedPem },
      { name: "Surviving Dev", keyId: "surviving-key", publicKey: survivingPem },
    ]);

    // The release self-claims 2026-06-01 (< C) — backdated; the anchor proves it existed by 2026-06-19.
    const rel = makeSignedRelease({
      privateKey: compromisedKp.privateKey,
      keyId: "compromised-key",
      timestamp: "2026-06-01T00:00:00.000Z",
    });
    const anchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-19T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
    });
    // The SIGNED KeyRevocation remains in the ledger (left behind by the tamper that stripped node.json).
    const revocation = makeSignedRevocation({
      revokedKeyId: "compromised-key",
      invalidAfter: C,
      timestamp: "2026-06-20T09:00:00.000Z",
      signerPrivateKey: survivingKp.privateKey,
      signerKeyId: "surviving-key",
    });

    const ctx = buildAttestorTimeCtx([rel, anchor, revocation]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(
      r.result,
      "fail",
      "a stripped node.json must not re-grandfather a key the signed ledger event revoked for compromise"
    );
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /compromise invalidity date/);
  });

  it("STRIPPED node.json + UNSIGNED/forged revocation in ledger => NOT re-imposed (forged event has no authority)", () => {
    // A self-issued revocation signed by the COMPROMISED key itself is NOT authorized (§4.2: a
    // revocation cannot be signed by the revoked key). It must contribute NO derived constraint, so
    // the stripped (grandfathered) key stays VALID — proving derive-stricter only trusts AUTHORIZED
    // events and does not let an attacker forge restriction either way.
    writeNode([
      { name: "Compromised Dev", keyId: "compromised-key", publicKey: compromisedPem },
    ]);
    const rel = makeSignedRelease({
      privateKey: compromisedKp.privateKey,
      keyId: "compromised-key",
      timestamp: "2026-06-01T00:00:00.000Z",
    });
    const anchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-19T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
    });
    // "Revocation" self-signed by the compromised key — unauthorized (§4.2).
    const forged = makeSignedRevocation({
      revokedKeyId: "compromised-key",
      invalidAfter: C,
      timestamp: "2026-06-20T09:00:00.000Z",
      signerPrivateKey: compromisedKp.privateKey,
      signerKeyId: "compromised-key",
    });
    const ctx = buildAttestorTimeCtx([rel, anchor, forged]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(
      r.result,
      "pass",
      "an unauthorized (self-signed) revocation must not impose a window — derive-stricter trusts only authorized events"
    );
    assert.equal(r.code, "verified");
  });

  it("GRANDFATHER byte-identical: no KeyRevocation/KeyRotation events => empty constraints => key stays VALID", () => {
    writeNode([
      { name: "Legacy Dev", keyId: "legacy-key", publicKey: survivingPem },
    ]);
    const rel = makeSignedRelease({
      privateKey: survivingKp.privateKey,
      keyId: "legacy-key",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    // Ledger has NO key-lifecycle events for the repo.
    const ctx = buildAttestorTimeCtx([rel]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass", "a window-less key with no key events grandfathers exactly as today");
    assert.equal(r.code, "verified");
  });
});
