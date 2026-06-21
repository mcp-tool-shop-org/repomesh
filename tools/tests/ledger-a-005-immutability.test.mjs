// LEDGER-A-005 (HIGH) regression — tools/verify-release.mjs must FAIL when a LOCAL ledger has been
// truncated/reordered relative to a COMMITTED anchor manifest's pinned Merkle root.
//
// THE EXPLOIT: an attacker drops a signed KeyRevocation event (and strips the matching node.json
// window fields) from a LOCAL checkout's ledger so a compromise-revoked key appears live, then runs
// `verify-release --local` on a post-revocation release. The derive-stricter defence cannot see a
// DELETED event. BUT the committed anchor manifests (anchor/xrpl/manifests/*.json) pin the ledger's
// Merkle root(s) — dropping/reordering ANY anchored event makes the recomputed root diverge from the
// pinned root. verify-release must recompute the committed manifests' roots over the loaded ledger and
// HARD-FAIL on any mismatch — exactly the unconditional check ledger/scripts/validate-ledger.mjs
// verifyAnchorManifests already performs, applied at verify time.
//
// TEST-FIRST: on the PRE-FIX tools/ code, a truncated ledger whose dropped event is NOT the release's
// own leaf verifies as PASS/0 (the per-release --anchored slice still resolves, or no --anchored is
// passed at all). After the immutability check is added, the verdict is a hard FAIL (exit != 0).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { merkleRootForAlgo } from "../../anchor/xrpl/scripts/merkle.mjs";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const ANCHOR_NODE = "mcp-tool-shop-org/repomesh-xrpl-anchor"; // bundled trusted attestor (signs anchors)
const WITNESS_ATTESTOR = "mcp-tool-shop-org/repomesh-license-verifier"; // independent passing witness

function makeTempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-ledger-a-005-")); }

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
  const stripped = JSON.parse(JSON.stringify(copy));
  delete stripped.signature;
  const hash = crypto.createHash("sha256").update(canonicalize(stripped), "utf8").digest("hex");
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), crypto.createPrivateKey(privateKeyPem));
  copy.signature = { alg: "ed25519", keyId, value: sig.toString("base64"), canonicalHash: hash };
  return copy;
}

function writeLedger(tmpDir, events) {
  const dir = path.join(tmpDir, "ledger", "events");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

function registerNode(tmpDir, repoId, kind, keyId, publicKeyPem) {
  const [org, repo] = repoId.split("/");
  const dir = path.join(tmpDir, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "node.json"),
    JSON.stringify({ id: repoId, kind, maintainers: [{ keyId, publicKey: publicKeyPem, contact: "x@x" }] }, null, 2), "utf8");
}

// Write a committed anchor manifest at anchor/xrpl/manifests/<name>.json pinning [range,count,root].
function writeManifest(tmpDir, name, manifest) {
  const dir = path.join(tmpDir, "anchor", "xrpl", "manifests");
  fs.mkdirSync(dir, { recursive: true });
  const { manifestHash, ...base } = manifest;
  const mh = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
  fs.writeFileSync(path.join(dir, `${name}.json`),
    JSON.stringify({ ...base, manifestHash: mh }, null, 2), "utf8");
}

function runVerify(tmpDir, args) {
  const { execSync } = require("node:child_process");
  try {
    const stdout = execSync(`node tools/verify-release.mjs ${args}`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        REPOMESH_ROOT: tmpDir,
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_MANIFESTS_PATH: path.join(tmpDir, "anchor", "xrpl", "manifests"),
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

// Build a full scenario: a release + an independent passing witness + several anchor "filler" events,
// all committed under a single manifest pinning the partition's Merkle root. The dropped event is one
// of the filler events (NOT the release's leaf) so the per-release path alone would still PASS.
function buildScenario(tmpDir, { algo }) {
  const repo = "org/app";
  const relKeys = generateTestKeypair();
  const witnessKeys = generateTestKeypair();
  const anchorKeys = generateTestKeypair();

  registerNode(tmpDir, repo, "tool", "ci-app-2026", relKeys.publicKeyPem);
  registerNode(tmpDir, WITNESS_ATTESTOR, "attestor", "ci-witness-2026", witnessKeys.publicKeyPem);
  registerNode(tmpDir, ANCHOR_NODE, "attestor", "ci-anchor-2026", anchorKeys.publicKeyPem);

  const release = signEvent({
    type: "ReleasePublished", repo, version: "1.0.0", commit: "abc",
    timestamp: "2026-06-01T00:00:00Z", artifacts: [], notes: "",
  }, relKeys.privateKeyPem, "ci-app-2026");

  const witness = signEvent({
    type: "AttestationPublished", repo, version: "1.0.0", commit: "abc",
    timestamp: "2026-06-02T00:00:00Z",
    attestations: [{ type: "license.audit", uri: "https://example/license.audit" }],
    notes: "license.audit: pass — note",
  }, witnessKeys.privateKeyPem, "ci-witness-2026");

  // Two filler attestations (the kind of events a real ledger carries between anchors). The SECOND
  // one is the one we will DROP — it is anchored (inside the pinned range) but is NOT the release leaf.
  const filler1 = signEvent({
    type: "AttestationPublished", repo: "org/other", version: "9.9.9", commit: "f1",
    timestamp: "2026-06-03T00:00:00Z",
    attestations: [{ type: "sbom", uri: "https://example/sbom1" }],
    notes: "sbom: pass — filler 1",
  }, witnessKeys.privateKeyPem, "ci-witness-2026");
  const droppable = signEvent({
    type: "AttestationPublished", repo: "org/other", version: "9.9.10", commit: "f2",
    timestamp: "2026-06-04T00:00:00Z",
    attestations: [{ type: "sbom", uri: "https://example/sbom2" }],
    notes: "sbom: pass — filler 2 (DROPPABLE)",
  }, witnessKeys.privateKeyPem, "ci-witness-2026");

  // The full, honest partition in ledger order.
  const fullEvents = [release, witness, filler1, droppable];
  const leaves = fullEvents.map(e => e.signature.canonicalHash);
  const root = merkleRootForAlgo(leaves, algo);

  // Commit the manifest pinning the HONEST partition (range = [first, last], count = 4).
  writeManifest(tmpDir, "all", {
    v: 1, algo, partitionId: "all", network: "testnet", prev: null,
    range: [leaves[0], leaves[leaves.length - 1]], count: leaves.length, root,
  });

  return { repo, fullEvents, droppable };
}

describe("LEDGER-A-005 tools — truncated/reordered local ledger must FAIL against committed manifests", () => {
  it("v1: dropping a signed anchored event (not the release leaf) => FAIL", () => {
    const tmpDir = makeTempDir();
    try {
      const { repo, fullEvents, droppable } = buildScenario(tmpDir, { algo: "sha256-merkle-v1" });

      // EXPLOIT: write the ledger WITHOUT the droppable anchored event (truncation/reorder).
      const tampered = fullEvents.filter(e => e !== droppable);
      writeLedger(tmpDir, tampered);

      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      assert.notEqual(r.status, 0, "a truncated local ledger must hard-FAIL the verdict (exit != 0)");
      // The dropped event must be detectable as a partition immutability violation.
      assert.match(r.stdout + "", /immutab|merkle|manifest|truncat|reorder/i,
        "the failure must name the manifest immutability violation");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("v2: dropping a signed anchored event (not the release leaf) => FAIL", () => {
    const tmpDir = makeTempDir();
    try {
      const { repo, fullEvents, droppable } = buildScenario(tmpDir, { algo: "sha256-merkle-v2" });
      const tampered = fullEvents.filter(e => e !== droppable);
      writeLedger(tmpDir, tampered);

      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      assert.notEqual(r.status, 0, "a truncated local ledger (v2 manifest) must hard-FAIL the verdict");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("HONEST ledger (no tamper) still verifies (no false positive)", () => {
    const tmpDir = makeTempDir();
    try {
      const { repo, fullEvents } = buildScenario(tmpDir, { algo: "sha256-merkle-v1" });
      // Write the FULL, honest partition — the committed manifest's root recomputes exactly.
      writeLedger(tmpDir, fullEvents);

      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      // The release has an independent witness (license.audit pass), so it PASSes; crucially the
      // immutability check must NOT fire on an untampered ledger.
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, true, "an honest ledger must not trip the immutability check");
      assert.equal(r.status, 0, "an honest ledger must verify (exit 0)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
