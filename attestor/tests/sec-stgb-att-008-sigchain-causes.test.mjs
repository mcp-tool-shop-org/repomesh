// STGB-ATT-008 — checkSignatureChain previously lumped its distinct failure causes under "fail" with
// similar prose. Each cause now carries a DISTINCT machine-readable `code`:
//   node-not-registered / keyid-not-found / hash-mismatch / sig-invalid / verification-error
//   (+ STGB-ATT-009: signature-missing / signature-keyid-missing presence guards).
// Verdict correctness is UNCHANGED — every failing cause still yields result "fail"; only a fully
// verified signature passes (code "verified").
//
// STGB-ATT-009 — a release event with NO signature block (or a signature block missing keyId) must
// produce a legible "signature-missing"/"signature-keyid-missing" verdict, NOT a raw TypeError from
// dereferencing releaseEvent.signature.keyId.
//
// RED before fix: a missing signature block threw `TypeError: Cannot read properties of undefined`;
// distinct causes all read as generic "fail" with no `code`.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Point the attestor at a crafted nodes dir BEFORE import (NODES_DIR is read at module load).
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-att008-"));
const NODES = path.join(baseDir, "nodes");
process.env.REPOMESH_NODES_PATH = NODES;

const REPO = "test-org/widget";
let checkSignatureChain;

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}

function writeNode(keyId, publicKeyPem) {
  const [org, repoName] = REPO.split("/");
  fs.mkdirSync(path.join(NODES, org, repoName), { recursive: true });
  fs.writeFileSync(
    path.join(NODES, org, repoName, "node.json"),
    JSON.stringify({ id: REPO, maintainers: [{ name: "Test Dev", keyId, publicKey: publicKeyPem }] }),
    "utf8"
  );
}

function baseEvent() {
  return {
    type: "ReleasePublished",
    repo: REPO,
    version: "1.0.0",
    commit: "a".repeat(40),
    timestamp: "2026-01-01T00:00:00.000Z",
    artifacts: [{ name: "x.tgz", sha256: "b".repeat(64), uri: "https://example.com/x.tgz" }],
    attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }],
  };
}

function signEventWith(privateKey, keyId, ev) {
  ev.signature = { alg: "ed25519", keyId, value: "", canonicalHash: "" };
  const stripped = JSON.parse(JSON.stringify(ev));
  delete stripped.signature;
  const hash = crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  ev.signature.value = sig.toString("base64");
  ev.signature.canonicalHash = hash;
  return ev;
}

describe("STGB-ATT-008 distinct signature.chain failure causes", () => {
  let keyPair, publicKeyPem;
  before(async () => {
    keyPair = crypto.generateKeyPairSync("ed25519");
    publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    ({ checkSignatureChain } = await import("../scripts/attest-release.mjs"));
  });

  it("node-not-registered: repo with no node.json", () => {
    const ev = baseEvent();
    ev.repo = "test-org/unregistered";
    ev.signature = { alg: "ed25519", keyId: "k1", value: "AA==", canonicalHash: "x" };
    const r = checkSignatureChain(ev);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "node-not-registered");
    assert.ok(r.hint, "carries a fix hint");
  });

  it("keyid-not-found: signed with a keyId not in node.json", () => {
    writeNode("registered-key", publicKeyPem);
    const ev = signEventWith(keyPair.privateKey, "DIFFERENT-key", baseEvent());
    const r = checkSignatureChain(ev);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "keyid-not-found");
  });

  it("hash-mismatch: body altered after signing", () => {
    writeNode("registered-key", publicKeyPem);
    const ev = signEventWith(keyPair.privateKey, "registered-key", baseEvent());
    ev.version = "9.9.9"; // mutate body AFTER signing -> canonical hash no longer matches
    const r = checkSignatureChain(ev);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "hash-mismatch");
  });

  it("sig-invalid: correct hash claimed but signature value is wrong", () => {
    writeNode("registered-key", publicKeyPem);
    const ev = signEventWith(keyPair.privateKey, "registered-key", baseEvent());
    // Keep canonicalHash (so we pass the hash check) but corrupt the signature value.
    const other = crypto.generateKeyPairSync("ed25519");
    const badSig = crypto.sign(null, Buffer.from(ev.signature.canonicalHash, "hex"), other.privateKey);
    ev.signature.value = badSig.toString("base64");
    const r = checkSignatureChain(ev);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "sig-invalid");
  });

  it("verification-error: malformed public key material throws -> distinct code", () => {
    writeNode("registered-key", "-----BEGIN PUBLIC KEY-----\nNOT-A-REAL-KEY\n-----END PUBLIC KEY-----");
    const ev = signEventWith(keyPair.privateKey, "registered-key", baseEvent());
    const r = checkSignatureChain(ev);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "verification-error");
  });

  it("verified: a valid signature passes with code 'verified'", () => {
    writeNode("registered-key", publicKeyPem);
    const ev = signEventWith(keyPair.privateKey, "registered-key", baseEvent());
    const r = checkSignatureChain(ev);
    assert.equal(r.result, "pass");
    assert.equal(r.code, "verified");
  });
});

describe("STGB-ATT-009 signature presence guard (no raw TypeError)", () => {
  before(async () => {
    if (!checkSignatureChain) ({ checkSignatureChain } = await import("../scripts/attest-release.mjs"));
  });

  it("a release with NO signature block -> 'signature-missing', not a thrown TypeError", () => {
    const ev = baseEvent(); // no .signature at all
    let r;
    assert.doesNotThrow(() => { r = checkSignatureChain(ev); }, "must not dereference undefined .keyId");
    assert.equal(r.result, "fail");
    assert.equal(r.code, "signature-missing");
    assert.ok(r.hint);
  });

  it("a signature block with no keyId -> 'signature-keyid-missing'", () => {
    const ev = baseEvent();
    ev.signature = { alg: "ed25519", value: "AA==", canonicalHash: "x" }; // keyId absent
    const r = checkSignatureChain(ev);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "signature-keyid-missing");
  });
});
