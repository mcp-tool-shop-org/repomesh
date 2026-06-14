// Wave-B3 residual ③ regression — WIRED INTO tools/verify-release.mjs (contract §13.1). The tools
// surface mirror of packages/repomesh-cli/tests/key-window-b3-ordering.test.mjs (the two verify
// copies stay behaviorally identical). Drives `node tools/verify-release.mjs --json` against a
// self-consistent env-pointed temp ledger, exercising the SITE's NEW opts wiring
// (verifySignature/getMaintainer/timeOf/trustedPolicy) feeding the shared module's ORDER-AWARE pass.
//
// THE RESIDUAL (contract §13.1): the Wave-B2 derive-stricter protected the MAIN resolution path, but
// the AUTHORIZATION sub-check (is a key-lifecycle event's *signer* currently valid?) validated the
// signer against node.json ALONE. Exploit: attacker serves a node.json that STRIPS compromise-revoked
// K_a's window → the auth path sees K_a valid → K_a authorizes a LATER event → a legit key is falsely
// restricted / trust re-established. The fix makes deriveKeyWindowConstraints an order-aware forward
// pass: a signer's validity is evaluated against node.json MERGED WITH STRICTLY-EARLIER derived state.
//
// TEST-FIRST: on the PRE-FIX site (order-INSENSITIVE derive + node.json-alone signer validity), K_a's
// later event is honored → the surviving-key assertion is RED. After the §13.1 wiring it is GREEN.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const { merkleRootHex } = require("../../anchor/xrpl/scripts/merkle.mjs");

const ANCHOR_NODE = "mcp-tool-shop-org/repomesh-xrpl-anchor";
const ANCHOR_KEY = "ci-xrpl-anchor-2026";
const C = "2026-06-18T00:00:00Z"; // K_a's compromise invalidity date

function makeTempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-b3-tools-")); }
function generateTestKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}
function canonicalize(value) { return JSON.stringify(sortKeys(value)); }
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  }
  return v;
}
function signEvent(ev, privateKeyPem, keyId) {
  const copy = JSON.parse(JSON.stringify(ev));
  copy.signature = { alg: "ed25519", keyId, value: "", canonicalHash: "" };
  const stripped = JSON.parse(JSON.stringify(copy));
  delete stripped.signature;
  const hash = crypto.createHash("sha256").update(canonicalize(stripped), "utf8").digest("hex");
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), crypto.createPrivateKey(privateKeyPem));
  copy.signature.value = sig.toString("base64");
  copy.signature.canonicalHash = hash;
  return copy;
}
function buildLedger(tmpDir, events) {
  const dir = path.join(tmpDir, "ledger", "events");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8");
}
function registerNode(tmpDir, repoId, kind, maintainers) {
  const [org, repo] = repoId.split("/");
  const dir = path.join(tmpDir, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "node.json"),
    JSON.stringify({ id: repoId, kind, maintainers }, null, 2), "utf8");
}
function writeManifestForLeaf(tmpDir, leaf, partitionId, relPath) {
  const leaves = [leaf];
  const base = {
    v: 1, algo: "sha256-merkle-v1", partitionId, network: "testnet",
    prev: null, range: [leaf, leaf], count: 1, root: merkleRootHex(leaves),
  };
  const manifestHash = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ ...base, manifestHash }, null, 2), "utf8");
}
function anchorEventFor(tmpDir, repo, leaf, anchorTs) {
  const manifestRel = "anchor-test-manifests/b3.json";
  writeManifestForLeaf(tmpDir, leaf, "genesis", manifestRel);
  const anchorKeys = generateTestKeypair();
  registerNode(tmpDir, ANCHOR_NODE, "attestor",
    [{ keyId: ANCHOR_KEY, publicKey: anchorKeys.publicKeyPem, contact: "anchor@x" }]);
  return signEvent({
    type: "AttestationPublished", repo, version: "1.0.0", commit: "abc",
    timestamp: anchorTs, attestations: [{ type: "ledger.anchor" }],
    notes: `Anchor\n${JSON.stringify({ manifestPath: manifestRel, network: "testnet" })}`,
  }, anchorKeys.privateKeyPem, ANCHOR_KEY);
}
function runVerify(tmpDir, args) {
  const { execSync } = require("node:child_process");
  try {
    const stdout = execSync(`node tools/verify-release.mjs ${args}`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_ROOT: tmpDir,
        REPOMESH_OFFLINE: "1",
      },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || "" };
  }
}

describe("tools ③ order-aware authorization (contract §13.1)", () => {
  // Literal §13.3 exploit probe — K_b's release REJECTED (K_a could not authorize the rotation).
  it("REJECTS K_b's release — its only standing is a rotation signed by an already-compromise-revoked K_a", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "org/b3-rot";
      const Ka = generateTestKeypair(), Kb = generateTestKeypair(), Ksurv = generateTestKeypair();
      const E = "2026-06-25T12:00:00Z";
      registerNode(tmpDir, repo, "tool", [
        { keyId: "Ka", publicKey: Ka.publicKeyPem, contact: "a@x" }, // STRIPPED
        { keyId: "Kb", publicKey: Kb.publicKeyPem, contact: "b@x", validFrom: E },
        { keyId: "Ksurv", publicKey: Ksurv.publicKeyPem, contact: "s@x" },
      ]);
      const Trel = "2026-06-20T00:00:00Z"; // C < Trel < E
      const rel = signEvent({
        type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: Trel, artifacts: [], notes: "",
      }, Kb.privateKeyPem, "Kb");
      const leaf = rel.signature.canonicalHash;
      const anchor = anchorEventFor(tmpDir, repo, leaf, Trel);
      const revokeKa = signEvent({
        type: "KeyRevocation", repo, timestamp: "2026-06-18T09:00:00Z",
        key: { action: "revoke", revokedKeyId: "Ka", reason: "compromise", invalidAfter: C },
      }, Ksurv.privateKeyPem, "Ksurv");
      const rotate = signEvent({
        type: "KeyRotation", repo, timestamp: "2026-06-19T00:00:00Z",
        key: { action: "rotate", retiringKeyId: "Ka", newKeyId: "Kb", newPublicKey: Kb.publicKeyPem,
               effectiveAt: "2026-06-19T00:00:00Z" },
      }, Ka.privateKeyPem, "Ka");
      buildLedger(tmpDir, [revokeKa, rotate, rel, anchor]);

      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, false,
        "K_b's pre-effectiveAt release must be REJECTED — K_a (compromise-revoked earlier) could not authorize the rotation re-issuing K_b's validFrom");
      assert.equal(out.ok, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Distinguishing site probe — RED on the pre-fix order-INSENSITIVE site.
  it("an already-compromise-revoked K_a CANNOT authorize a LATER revocation of the surviving release key", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "org/b3-surv";
      const Ka = generateTestKeypair(), Krel = generateTestKeypair(), Kroot = generateTestKeypair();
      const Trel = "2026-06-22T00:00:00Z";
      registerNode(tmpDir, repo, "tool", [
        { keyId: "Ka", publicKey: Ka.publicKeyPem, contact: "a@x" }, // STRIPPED (grandfathered)
        { keyId: "Krel", publicKey: Krel.publicKeyPem, contact: "r@x" }, // grandfathered release key
        { keyId: "Kroot", publicKey: Kroot.publicKeyPem, contact: "root@x" },
      ]);
      const rel = signEvent({
        type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: Trel, artifacts: [], notes: "",
      }, Krel.privateKeyPem, "Krel");
      const leaf = rel.signature.canonicalHash;
      const anchor = anchorEventFor(tmpDir, repo, leaf, Trel);
      const revokeKa = signEvent({
        type: "KeyRevocation", repo, timestamp: "2026-06-18T09:00:00Z",
        key: { action: "revoke", revokedKeyId: "Ka", reason: "compromise", invalidAfter: C },
      }, Kroot.privateKeyPem, "Kroot");
      const revokeKrel = signEvent({
        type: "KeyRevocation", repo, timestamp: "2026-06-20T09:00:00Z",
        key: { action: "revoke", revokedKeyId: "Krel", reason: "compromise", invalidAfter: "2026-06-19T00:00:00Z" },
      }, Ka.privateKeyPem, "Ka"); // self-signed by the ALREADY-compromised K_a
      buildLedger(tmpDir, [revokeKa, revokeKrel, rel, anchor]);

      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, true,
        "K_rel's release must stay VALID — an already-compromise-revoked K_a cannot authorize a later revocation of the surviving key (order-aware §13.1)");
      assert.equal(out.release.signerNode, repo);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // CONVERSE — a rotation that PRECEDES K_a's compromise still legitimizes K_b's release.
  it("a rotation that PRECEDES K_a's compromise-revocation still legitimizes K_b's release", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "org/b3-conv";
      const Ka = generateTestKeypair(), Kb = generateTestKeypair(), Ksurv = generateTestKeypair();
      const E = "2026-06-10T12:00:00Z"; // BEFORE K_a's compromise
      registerNode(tmpDir, repo, "tool", [
        { keyId: "Ka", publicKey: Ka.publicKeyPem, contact: "a@x",
          validUntil: E, revokedAt: E, revocationReason: "rotation" },
        { keyId: "Kb", publicKey: Kb.publicKeyPem, contact: "b@x", validFrom: E },
        { keyId: "Ksurv", publicKey: Ksurv.publicKeyPem, contact: "s@x" },
      ]);
      const Trel = "2026-06-15T00:00:00Z"; // after E => within K_b's window
      const rel = signEvent({
        type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: Trel, artifacts: [], notes: "",
      }, Kb.privateKeyPem, "Kb");
      const leaf = rel.signature.canonicalHash;
      const anchor = anchorEventFor(tmpDir, repo, leaf, Trel);
      const rotate = signEvent({
        type: "KeyRotation", repo, timestamp: E,
        key: { action: "rotate", retiringKeyId: "Ka", newKeyId: "Kb", newPublicKey: Kb.publicKeyPem, effectiveAt: E },
      }, Ka.privateKeyPem, "Ka"); // K_a still valid at E
      const revokeKa = signEvent({
        type: "KeyRevocation", repo, timestamp: "2026-06-20T09:00:00Z",
        key: { action: "revoke", revokedKeyId: "Ka", reason: "compromise", invalidAfter: C },
      }, Ksurv.privateKeyPem, "Ksurv");
      buildLedger(tmpDir, [rotate, revokeKa, rel, anchor]);

      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, true,
        "K_b's release under a rotation that PRECEDED K_a's compromise must stay VALID (order-aware, not blanket-rejecting)");
      assert.equal(out.release.signerNode, repo);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
