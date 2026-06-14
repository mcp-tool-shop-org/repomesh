// Regression tests for the key-lifecycle window gate WIRED INTO tools/verify-release.mjs at the
// two repo-bound / third-party key-resolution sites (contract §1 sites 6 findPublicKeyInRepo + 7
// findPublicKeyAcrossNodes; applied per §5.3). tools/ runs OFFLINE => the SYNC resolver ladder.
//
// THE BUG (contract §1): every key-resolution site did an UNTIMED maintainers.find(keyId) and
// returned the key with ZERO time check, so a compromised-but-still-listed key verified VALID.
// These tests drive `node tools/verify-release.mjs --repo ... --version ... --json` against a
// self-consistent temp ledger (env-pointed) with WINDOWED maintainers + a bundled-trusted XRPL
// anchor event. They are the tools-surface mirror of
// packages/repomesh-cli/tests/key-window-verify-release.test.mjs.
//
// TEST-FIRST: on the PRE-FIX code path the compromise cases would resolve a valid signature
// (signatureValid:true) — these assertions are RED there, GREEN after the gate is wired in.
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
const C = "2026-06-18T00:00:00Z"; // compromise invalidity date

function makeTempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-keywin-tools-")); }

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

// Register a node with an arbitrary maintainer object (so window fields can be attached).
function registerNodeRaw(tmpDir, repoId, kind, maintainer) {
  const [org, repo] = repoId.split("/");
  const dir = path.join(tmpDir, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "node.json"),
    JSON.stringify({ id: repoId, kind, maintainers: [maintainer] }, null, 2), "utf8");
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

// Build a release + (optionally) a bundled-trusted anchor event whose partition pins the leaf.
function buildAnchoredRelease(tmpDir, { repo, relKeyId, relKeys, selfTs, anchorTs, anchored = true }) {
  const release = signEvent({
    type: "ReleasePublished", repo, version: "1.0.0", commit: "abc",
    timestamp: selfTs, artifacts: [], notes: "",
  }, relKeys.privateKeyPem, relKeyId);

  const events = [release];
  if (anchored) {
    const leaf = release.signature.canonicalHash;
    const manifestRel = "anchor-test-manifests/keywin.json";
    writeManifestForLeaf(tmpDir, leaf, "genesis", manifestRel);
    const anchorKeys = generateTestKeypair();
    registerNodeRaw(tmpDir, ANCHOR_NODE, "attestor",
      { keyId: ANCHOR_KEY, publicKey: anchorKeys.publicKeyPem, contact: "anchor@x" });
    const anchor = signEvent({
      type: "AttestationPublished", repo, version: "1.0.0", commit: "abc",
      timestamp: anchorTs, attestations: [{ type: "ledger.anchor" }],
      notes: `Anchor\n${JSON.stringify({ manifestPath: manifestRel, network: "testnet" })}`,
    }, anchorKeys.privateKeyPem, ANCHOR_KEY);
    events.push(anchor);
  }
  return events;
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

describe("tools key-window gate — grandfather unchanged (contract §9.1)", () => {
  it("a window-less maintainer verifies its release signature byte-identically to today", () => {
    const tmpDir = makeTempDir();
    try {
      const relKeys = generateTestKeypair();
      registerNodeRaw(tmpDir, "org/legacy", "tool",
        { keyId: "ci-legacy-2026", publicKey: relKeys.publicKeyPem, contact: "x@x" });
      const events = buildAnchoredRelease(tmpDir, {
        repo: "org/legacy", relKeyId: "ci-legacy-2026", relKeys,
        selfTs: "2026-06-01T00:00:00Z", anchorTs: "2026-06-19T00:00:00Z",
      });
      buildLedger(tmpDir, events);
      const r = runVerify(tmpDir, `--repo org/legacy --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, true, "grandfathered key signature must still verify");
      assert.equal(out.release.signerNode, "org/legacy");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("tools key-window gate — compromise (contract §9.2/§9.3/§9.4)", () => {
  function compromisedMaintainer(keyId, publicKeyPem) {
    return {
      keyId, publicKey: publicKeyPem, contact: "x@x",
      revokedAt: "2026-06-20T09:00:00Z", revocationReason: "compromise", invalidAfter: C,
    };
  }

  it("REJECTS a release whose leaf is PROVABLY anchored AT/AFTER invalidAfter (compromise)", () => {
    const tmpDir = makeTempDir();
    try {
      const relKeys = generateTestKeypair();
      const repo = "org/comp-after";
      registerNodeRaw(tmpDir, repo, "tool", compromisedMaintainer("ci-comp-2026", relKeys.publicKeyPem));
      const events = buildAnchoredRelease(tmpDir, {
        repo, relKeyId: "ci-comp-2026", relKeys,
        selfTs: "2026-06-10T00:00:00Z", anchorTs: "2026-06-19T00:00:00Z", // proves leaf > C
      });
      buildLedger(tmpDir, events);
      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, false,
        "a provably-post-compromise signature must NOT verify (backdated self-time cannot rescue it)");
      assert.equal(out.ok, false);
      assert.notEqual(r.status, 0, "compromised release must exit non-zero");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("KEEPS VALID a release whose leaf is PROVABLY anchored BEFORE invalidAfter (compromise)", () => {
    const tmpDir = makeTempDir();
    try {
      const relKeys = generateTestKeypair();
      const repo = "org/comp-before";
      registerNodeRaw(tmpDir, repo, "tool", compromisedMaintainer("ci-comp-2026", relKeys.publicKeyPem));
      const events = buildAnchoredRelease(tmpDir, {
        repo, relKeyId: "ci-comp-2026", relKeys,
        selfTs: "2026-06-15T00:00:00Z", anchorTs: "2026-06-17T00:00:00Z", // proves leaf < C
      });
      buildLedger(tmpDir, events);
      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, true,
        "compromise must NOT retroactively kill a PROVABLY-old (pre-C, anchored) signature");
      assert.equal(out.release.signerNode, repo);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("REJECTS a release that is UNANCHORED (self-time only) under a compromised key", () => {
    const tmpDir = makeTempDir();
    try {
      const relKeys = generateTestKeypair();
      const repo = "org/comp-unanchored";
      registerNodeRaw(tmpDir, repo, "tool", compromisedMaintainer("ci-comp-2026", relKeys.publicKeyPem));
      const events = buildAnchoredRelease(tmpDir, {
        repo, relKeyId: "ci-comp-2026", relKeys,
        selfTs: "2026-06-10T00:00:00Z", anchorTs: null, anchored: false, // unanchored => self only
      });
      buildLedger(tmpDir, events);
      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, false,
        "a compromised key with only a self-asserted (unprovable) time must be rejected");
      assert.equal(out.ok, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("tools key-window gate — node.json-STRIP bypass (contract §12.1 / §12.3 probe)", () => {
  // THE WAVE-B2 BUG (§12.1 Finding ①): tools/verify-release.mjs reads window state from node.json
  // and does NOT run the binding check, so a tampered node.json that STRIPS a revoked key's window
  // fields re-grandfathers it (isWindowed=false => VALID). The defence (§12.1): derive the window
  // from the SIGNED KeyRevocation event and merge the STRICTER. A tampered node.json can only ADD
  // restriction, never remove what the signed event asserts.
  //
  // TEST-FIRST: on the post-Wave-B tools/ code (no derive-stricter at sites 6/7) the STRIPPED
  // node.json re-grandfathers k1 => the post-compromise release verifies VALID => RED. After the
  // §12.1 wrap it is GREEN.
  const C2 = "2026-06-18T00:00:00Z";

  it("STILL REJECTS a provably-post-compromise release when node.json window fields are STRIPPED", () => {
    const tmpDir = makeTempDir();
    try {
      const compromised = generateTestKeypair();
      const surviving = generateTestKeypair();
      const repo = "org/strip-comp";
      // node.json: k1 (compromised) GRANDFATHER-STRIPPED (no window fields — the tamper); k2 a
      // window-less surviving maintainer of the SAME node (authorized to sign the revocation, §4.2).
      const [org, repoName] = repo.split("/");
      const dir = path.join(tmpDir, "ledger", "nodes", org, repoName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "node.json"), JSON.stringify({
        id: repo, kind: "tool",
        maintainers: [
          { keyId: "ci-comp-2026", publicKey: compromised.publicKeyPem, contact: "x@x" }, // STRIPPED
          { keyId: "ci-surv-2026", publicKey: surviving.publicKeyPem, contact: "y@y" },     // grandfathered
        ],
      }, null, 2), "utf8");

      // Release signed by the compromised key, PROVABLY anchored AT/AFTER C (anchorTs 2026-06-19 > C).
      const events = buildAnchoredRelease(tmpDir, {
        repo, relKeyId: "ci-comp-2026", relKeys: compromised,
        selfTs: "2026-06-10T00:00:00Z", anchorTs: "2026-06-19T00:00:00Z",
      });
      // The SIGNED KeyRevocation remains in the ledger (only node.json was tampered). Signed by the
      // SURVIVING same-node key (authorized per §4.2).
      const revocation = signEvent({
        type: "KeyRevocation", repo, timestamp: "2026-06-20T09:00:00Z",
        key: { action: "revoke", revokedKeyId: "ci-comp-2026", reason: "compromise", invalidAfter: C2 },
      }, surviving.privateKeyPem, "ci-surv-2026");
      events.push(revocation);
      buildLedger(tmpDir, events);

      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, false,
        "a stripped node.json must NOT re-grandfather a key the SIGNED ledger revoked for compromise");
      assert.equal(out.ok, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("tools key-window gate — routine rotation is prospective-only (contract §9.5)", () => {
  const R = "2026-06-14T12:00:00Z";
  function rotatedMaintainer(keyId, publicKeyPem) {
    return { keyId, publicKey: publicKeyPem, contact: "x@x", validUntil: R, revokedAt: R, revocationReason: "rotation" };
  }

  it("a signature BEFORE the rotation time stays VALID (self time trusted for rotation)", () => {
    const tmpDir = makeTempDir();
    try {
      const relKeys = generateTestKeypair();
      const repo = "org/rot-before";
      registerNodeRaw(tmpDir, repo, "tool", rotatedMaintainer("ci-rot-2026", relKeys.publicKeyPem));
      const events = buildAnchoredRelease(tmpDir, {
        repo, relKeyId: "ci-rot-2026", relKeys,
        selfTs: "2026-06-01T00:00:00Z", anchorTs: null, anchored: false, // self < R
      });
      buildLedger(tmpDir, events);
      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, true,
        "a pre-rotation signature must stay valid (rotation is prospective)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("a signature AT/AFTER the rotation time is REJECTED (key rotated out)", () => {
    const tmpDir = makeTempDir();
    try {
      const relKeys = generateTestKeypair();
      const repo = "org/rot-after";
      registerNodeRaw(tmpDir, repo, "tool", rotatedMaintainer("ci-rot-2026", relKeys.publicKeyPem));
      const events = buildAnchoredRelease(tmpDir, {
        repo, relKeyId: "ci-rot-2026", relKeys,
        selfTs: "2026-07-01T00:00:00Z", anchorTs: null, anchored: false, // self > R
      });
      buildLedger(tmpDir, events);
      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, false,
        "a post-rotation signature must be rejected (key rotated out)");
      assert.equal(out.ok, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
