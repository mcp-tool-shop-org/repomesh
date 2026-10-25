// Anchor signers and ledger order (review fy of #153).
//
// An anchor's own timestamp is chosen by whoever holds its key, so a rotated-out anchor key could
// sign a new anchor dated before its rotation and have it counted as a trusted clock. These tests
// pin the ledger-order rule in isBundledTrustedAnchorEvent and drive each case through all three
// real paths: validate-ledger (VL), ledger/scripts/verify-release.mjs (LVR) and
// attestor/scripts/attest-release.mjs (AR). Each case asks one question: does a release signed by
// a compromise-revoked key, with a backdated self-time, verify on the strength of the anchor?
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const VALIDATOR = path.join(REPO_ROOT, "ledger", "scripts", "validate-ledger.mjs");

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-anchor-order-"));
const NODES = path.join(baseDir, "nodes");
process.env.REPOMESH_NODES_PATH = NODES;

const REL_REPO = "test-org/widget";
const ANCHOR_REPO = "mcp-tool-shop-org/repomesh-xrpl-anchor";
const ROT = "2026-08-01T00:00:00.000Z";

let buildAttestorTimeCtx;
let checkSignatureChain;
let isKeyValidForSignature;

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonicalize(v[k]);
    return o;
  }
  return v;
}
function sign(ev, privateKey) {
  const s = JSON.parse(JSON.stringify(ev));
  delete s.signature;
  const h = crypto.createHash("sha256").update(JSON.stringify(canonicalize(s)), "utf8").digest("hex");
  ev.signature.canonicalHash = h;
  ev.signature.value = crypto.sign(null, Buffer.from(h, "hex"), privateKey).toString("base64");
  return ev;
}
const pemOf = (k) => k.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
const relKp = crypto.generateKeyPairSync("ed25519");
const oldKp = crypto.generateKeyPairSync("ed25519");
const newKp = crypto.generateKeyPairSync("ed25519");

function release() {
  return sign({
    type: "ReleasePublished", repo: REL_REPO, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-07-10T00:00:00.000Z",
    artifacts: [{ name: "x.tgz", sha256: "b".repeat(64), uri: "https://example.com/x.tgz" }],
    attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }],
    signature: { alg: "ed25519", keyId: "compromised-key", value: "", canonicalHash: "" },
  }, relKp.privateKey);
}
function anchor(leaf) {
  const meta = {
    txHash: "TX-ORDER", network: "testnet", partitionId: "p-order",
    partitionStart: "2026-05-01T00:00:00.000Z", partitionEnd: "2026-10-01T00:00:00.000Z",
    range: [leaf, leaf], merkleRoot: "d".repeat(64),
  };
  return sign({
    type: "AttestationPublished", repo: ANCHOR_REPO, version: "0.0.0-anchor", commit: "c".repeat(40),
    timestamp: "2026-07-15T00:00:00.000Z",
    artifacts: [{ name: "anchor.json", sha256: "d".repeat(64), uri: "https://example.com/anchor.json" }],
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:TX-ORDER" }],
    notes: `ledger.anchor: pass\n${JSON.stringify(meta)}`,
    signature: { alg: "ed25519", keyId: "anchor-old", value: "", canonicalHash: "" },
  }, oldKp.privateKey);
}
function keyRotation() {
  return sign({
    type: "KeyRotation", repo: ANCHOR_REPO, timestamp: "2026-07-31T23:00:00.000Z",
    key: { action: "rotate", retiringKeyId: "anchor-old", newKeyId: "anchor-new", newPublicKey: pemOf(newKp), effectiveAt: ROT },
    signature: { alg: "ed25519", keyId: "anchor-old", value: "", canonicalHash: "" },
  }, oldKp.privateKey);
}
function keyRevocation() {
  return sign({
    type: "KeyRevocation", repo: ANCHOR_REPO, timestamp: "2026-06-20T00:00:00.000Z",
    key: { action: "revoke", revokedKeyId: "anchor-old", reason: "compromise", invalidAfter: "2026-06-16T00:00:00.000Z" },
    signature: { alg: "ed25519", keyId: "anchor-new", value: "", canonicalHash: "" },
  }, newKp.privateKey);
}

const OLD = { name: "Old", keyId: "anchor-old", publicKey: pemOf(oldKp), contact: "o@example.com" };
const NEW = { name: "New", keyId: "anchor-new", publicKey: pemOf(newKp), contact: "n@example.com" };
const ROTATED = [{ ...OLD, validUntil: ROT, revokedAt: ROT, revocationReason: "rotation" }, { ...NEW, validFrom: ROT }];

function manifest(id, kind, maintainers) {
  return {
    id, kind, description: `${kind} node`, provides: [`${kind}.test.v1`], consumes: [],
    interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
    invariants: { deterministicBuild: false, signedReleases: false, semver: true, changelog: true },
    maintainers, tags: ["test"],
  };
}
function writeNodes(anchorMaintainers) {
  fs.rmSync(NODES, { recursive: true, force: true });
  fs.cpSync(path.join(REPO_ROOT, "ledger", "nodes"), NODES, { recursive: true });
  const write = (n) => {
    const [o, r] = n.id.split("/");
    fs.mkdirSync(path.join(NODES, o, r), { recursive: true });
    fs.writeFileSync(path.join(NODES, o, r, "node.json"), JSON.stringify(n, null, 2), "utf8");
  };
  write(manifest(ANCHOR_REPO, "attestor", anchorMaintainers));
  write(manifest(REL_REPO, "compute", [{
    name: "Dev", keyId: "compromised-key", publicKey: pemOf(relKp), contact: "d@example.com",
    revokedAt: "2026-09-02T00:00:00.000Z", revocationReason: "compromise", invalidAfter: "2026-09-01T00:00:00.000Z",
  }]));
}

const jsonl = (evs) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";

// Run one ledger through all three paths. `base` is the already-merged prefix (VL only validates
// what follows it); `head` is the full ledger. Returns whether the release verifies on each path.
function onAllThreePaths({ anchorMaintainers, base = [], head, rel }) {
  writeNodes(anchorMaintainers);
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), "rm-anchor-order-sb-"));
  try {
    const manifests = path.join(sb, "manifests");
    fs.mkdirSync(manifests);
    fs.writeFileSync(path.join(sb, "base.jsonl"), base.length ? jsonl(base) : "", "utf8");
    fs.writeFileSync(path.join(sb, "head.jsonl"), jsonl(head), "utf8");
    const vl = spawnSync(process.execPath, [VALIDATOR], {
      encoding: "utf8",
      env: { ...process.env, BASE_LEDGER: path.join(sb, "base.jsonl"), HEAD_LEDGER: path.join(sb, "head.jsonl"),
        REPOMESH_NODES_PATH: NODES, REPOMESH_MANIFESTS_PATH: manifests },
    }).status === 0;

    const vr = path.join(sb, "vr");
    for (const d of ["ledger/scripts", "ledger/events", "verifiers/lib"]) fs.mkdirSync(path.join(vr, d), { recursive: true });
    fs.cpSync(NODES, path.join(vr, "ledger", "nodes"), { recursive: true });
    for (const f of ["ledger/scripts/verify-release.mjs", "ledger/scripts/canonicalize.mjs", "verifiers/lib/key-window.mjs", "verifier.policy.json"]) {
      fs.copyFileSync(path.join(REPO_ROOT, f), path.join(vr, f));
    }
    fs.writeFileSync(path.join(vr, "ledger/events/events.jsonl"), jsonl(head), "utf8");
    const lvr = spawnSync(process.execPath, [path.join(vr, "ledger/scripts/verify-release.mjs"), "--repo", REL_REPO, "--version", "1.0.0"], {
      encoding: "utf8",
      env: { ...process.env, REPOMESH_VERIFIER_POLICY_PATH: path.join(vr, "verifier.policy.json") },
    }).status === 0;

    const ar = checkSignatureChain(rel, buildAttestorTimeCtx(head)).result === "pass";
    return { vl, lvr, ar };
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
}

describe("anchor signers honour ledger order across validate-ledger, ledger verify-release and attest-release", () => {
  before(async () => {
    ({ buildAttestorTimeCtx, checkSignatureChain } = await import("../scripts/attest-release.mjs"));
    ({ isKeyValidForSignature } = await import("../../verifiers/lib/key-window.mjs"));
  });
  after(() => fs.rmSync(baseDir, { recursive: true, force: true }));

  it("control: with no anchor, the compromised release key fails on all three paths", () => {
    const rel = release();
    assert.deepEqual(onAllThreePaths({ anchorMaintainers: ROTATED, head: [keyRotation(), rel], rel }), { vl: false, lvr: false, ar: false });
  });

  it("a rotated-out anchor key's new anchor, appended after its KeyRotation event and dated before it, is refused", () => {
    const rel = release();
    const r = onAllThreePaths({ anchorMaintainers: ROTATED, head: [keyRotation(), rel, anchor(rel.signature.canonicalHash)], rel });
    assert.deepEqual(r, { vl: false, lvr: false, ar: false });
  });

  it("an anchor by the same key that sits before its KeyRotation event in the ledger still counts", () => {
    const rel = release();
    const r = onAllThreePaths({ anchorMaintainers: ROTATED, head: [rel, anchor(rel.signature.canonicalHash), keyRotation()], rel });
    assert.deepEqual(r, { vl: true, lvr: true, ar: true });
  });

  it("a rotation recorded only in node.json gives no ordering evidence, so the anchor is refused", () => {
    const rel = release();
    const r = onAllThreePaths({ anchorMaintainers: ROTATED, head: [rel, anchor(rel.signature.canonicalHash)], rel });
    assert.deepEqual(r, { vl: false, lvr: false, ar: false });
  });

  it("a compromise KeyRevocation in the ledger refuses the anchor key even when node.json omits it", () => {
    const rel = release();
    const rev = keyRevocation();
    const r = onAllThreePaths({ anchorMaintainers: [OLD, NEW], base: [rev], head: [rev, rel, anchor(rel.signature.canonicalHash)], rel });
    assert.deepEqual(r, { vl: false, lvr: false, ar: false });
  });

  it("a revocation boundary with no reason is a compromise for every signer", () => {
    const self = { time: new Date("2026-06-10T00:00:00.000Z"), provable: false, source: "self" };
    const late = { time: new Date("2026-07-15T00:00:00.000Z"), provable: false, source: "self" };
    assert.equal(isKeyValidForSignature({ ...OLD, revokedAt: "2026-06-16T00:00:00.000Z" }, self).valid, false);
    assert.equal(isKeyValidForSignature({ ...OLD, invalidAfter: "2026-06-16T00:00:00.000Z" }, late).valid, false);
    assert.equal(isKeyValidForSignature({ ...OLD, revocationReason: "compromise", invalidAfter: "2026-06-16T00:00:00.000Z" }, late).valid, false);
    // An explicit routine reason stays prospective.
    assert.equal(isKeyValidForSignature({ ...OLD, revokedAt: "2026-06-16T00:00:00.000Z", revocationReason: "rotation" }, self).valid, true);
  });
});
