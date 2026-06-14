// Stage C — verdict legibility tests for verify-release.
// Every operator/CI-visible non-pass result must carry a machine-readable reason
// AND an actionable hint. These are ADDITIVE legibility checks — they do NOT change
// any trust verdict (a forged release still fails, a clean one still passes).
//
//   B-OBS-01 — UNVERIFIED must populate gate.failures[] with {check, reason, hint}.
//   B-OBS-02 — human (non-json) final line prints the cause inline.
//   B-OBS-03 — an anchor signed by a non-allowlisted node surfaces signerReason.
//   B-FP-01  — an unknown/future merkle algo reports 'unsupported', not 'MISMATCH'.
//   B-FP-02  — every --json exit path emits the SAME (pretty) indentation.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }
const { canonicalize } = await import(toURL(resolve(srcDir, "verify", "canonicalize.mjs")));
const { merkleRootHex } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { privateKey, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
function signEvent(body, keyId, privateKey) {
  const ev = { ...body }; delete ev.signature;
  const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  const value = crypto.sign(null, Buffer.from(canonHash, "hex"), privateKey).toString("base64");
  return { ...ev, signature: { alg: "ed25519", keyId, value, canonicalHash: canonHash } };
}

let tmpRoot;
function setupRoot() {
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-leg-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
}
function writeNode(orgRepo, kind, keyId, publicPem, profileId) {
  const [org, repo] = orgRepo.split("/");
  const dir = join(tmpRoot, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "node.json"), JSON.stringify({
    id: orgRepo, kind, provides: [], consumes: [], interfaces: [], invariants: {},
    maintainers: [{ name: org, keyId, publicKey: publicPem, contact: "x@example.com" }],
  }, null, 2));
  if (profileId) fs.writeFileSync(join(dir, "repomesh.profile.json"), JSON.stringify({ profileId, profileVersion: "v1" }));
}
function writeEvents(events) {
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
}
async function runVerify(args, { json = true } = {}) {
  const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let exitCode = null, out = "", err = "";
  process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
  process.cwd = () => tmpRoot;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = (m) => { err += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  try { await verifyRelease({ json, ...args }); }
  catch (e) { if (e.message !== "__EXIT__") throw e; }
  finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch {} }
  return { exitCode, out, err, result };
}

function baselineRelease(key, keyId, repo = "org/app") {
  return signEvent({
    type: "ReleasePublished", repo, version: "1.0.0",
    commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
    artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
  }, keyId, key.privateKey);
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("B-OBS-01: UNVERIFIED carries machine-readable reason + hint", () => {
  it("a self-signed not-anchored release -> failures[] non-empty + actionable {check,reason,hint}", async () => {
    const k = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", k.publicPem, "baseline");
    writeEvents([baselineRelease(k, "ci-app-2026")]);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "self-signed-only baseline must NOT pass");
    assert.equal(result?.gate?.status, "UNVERIFIED");
    // FC1: UNVERIFIED -> exit 3 under default --fail-on=unverified (verdict unchanged).
    assert.equal(exitCode, 3);
    assert.ok(Array.isArray(result.gate.failures), "failures must be an array");
    assert.ok(result.gate.failures.length > 0, "UNVERIFIED must populate failures[] (was empty)");
    const f = result.gate.failures.find(x => /independent|witness/i.test(`${x.check} ${x.reason}`));
    assert.ok(f, "an independence failure entry must be present");
    assert.ok(typeof f.check === "string" && f.check.length > 0, "failure must carry a machine-readable check");
    assert.ok(typeof f.reason === "string" && f.reason.length > 0, "failure must carry a reason");
    assert.ok(typeof f.hint === "string" && f.hint.length > 0, "failure must carry an actionable hint");
  });

  it("a regulated release with a MISSING required attestation carries a hint per failure", async () => {
    const rel = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "regulated");
    writeEvents([baselineRelease(rel, "ci-app-2026")]); // no attestations at all
    const { result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false);
    assert.ok(result.gate.failures.length > 0);
    for (const f of result.gate.failures) {
      assert.ok(typeof f.check === "string" && f.check.length > 0, `failure ${JSON.stringify(f)} needs check`);
      assert.ok(typeof f.reason === "string" && f.reason.length > 0, `failure ${JSON.stringify(f)} needs reason`);
      assert.ok(typeof f.hint === "string" && f.hint.length > 0, `failure ${JSON.stringify(f)} needs hint`);
    }
  });
});

describe("B-OBS-02: human (non-json) verdict prints cause inline", () => {
  it("UNVERIFIED prints 'Verification: UNVERIFIED — <reason>'", async () => {
    const k = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", k.publicPem, "baseline");
    writeEvents([baselineRelease(k, "ci-app-2026")]);
    const { out } = await runVerify({ repo: "org/app", version: "1.0.0" }, { json: false });
    assert.match(out, /Verification:\s*UNVERIFIED\s*—\s*\S+/, "verdict line must include the cause inline");
  });
});

describe("B-OBS-03: untrusted anchor signer surfaces a reason in result.anchor", () => {
  // Build a self-signed anchor (signed by the release's own key, NOT a bundled anchor node).
  function buildAnchoredLedger(k) {
    const release = baselineRelease(k, "ci-app-2026");
    const releaseHash = release.signature.canonicalHash;
    const leaves = [releaseHash];
    const root = merkleRootHex(leaves);
    const manifestBase = {
      v: 1, algo: "sha256-merkle-v1", partitionId: "2026-01-01", network: "testnet",
      prev: null, range: [releaseHash, releaseHash], count: 1, root,
    };
    const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
    const manifest = { ...manifestBase, manifestHash };
    fs.mkdirSync(join(tmpRoot, "anchor", "xrpl", "manifests"), { recursive: true });
    fs.writeFileSync(join(tmpRoot, "anchor", "xrpl", "manifests", "all.json"), JSON.stringify(manifest));
    const meta = { txHash: "DEADBEEF".repeat(8), network: "testnet", manifestPath: "anchor/xrpl/manifests/all.json", merkleRoot: root, manifestHash };
    const anchorEvent = signEvent({
      type: "AttestationPublished", repo: "org/app", version: "0.0.0-genesis",
      commit: "0000000", timestamp: "2026-01-05T00:00:00Z",
      artifacts: [{ name: "anchor.json", sha256: "c".repeat(64), uri: "x" }],
      attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:" + meta.txHash }],
      notes: "ledger.anchor: pass\n" + JSON.stringify(meta),
    }, "ci-app-2026", k.privateKey);
    return [release, anchorEvent];
  }

  it("--anchored-or-local with a non-allowlisted anchor signer: result.anchor.signerTrusted=false + signerReason", async () => {
    const k = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", k.publicPem, "baseline");
    writeEvents(buildAnchoredLedger(k));
    process.env.REPOMESH_FORCE_OFFLINE = "1";
    try {
      const { result } = await runVerify({ repo: "org/app", version: "1.0.0", anchored: true, anchoredOrLocal: true });
      assert.equal(result?.anchor?.signerTrusted, false, "self-signed anchor must NOT be trusted");
      assert.ok(typeof result.anchor.signerReason === "string" && result.anchor.signerReason.length > 0,
        "an untrusted anchor signer must surface a signerReason");
    } finally { delete process.env.REPOMESH_FORCE_OFFLINE; }
  });
});

describe("B-FP-01: unsupported merkle algo is distinct from MISMATCH (no false-tamper claim)", () => {
  function buildAnchoredLedgerWithAlgo(k, algo) {
    const release = baselineRelease(k, "ci-app-2026");
    const releaseHash = release.signature.canonicalHash;
    const leaves = [releaseHash];
    // root computed with v1, but manifest CLAIMS a future/unknown algo.
    const root = merkleRootHex(leaves);
    const manifestBase = {
      v: 2, algo, partitionId: "2026-01-01", network: "testnet",
      prev: null, range: [releaseHash, releaseHash], count: 1, root,
    };
    const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
    const manifest = { ...manifestBase, manifestHash };
    fs.mkdirSync(join(tmpRoot, "anchor", "xrpl", "manifests"), { recursive: true });
    fs.writeFileSync(join(tmpRoot, "anchor", "xrpl", "manifests", "all.json"), JSON.stringify(manifest));
    const meta = { txHash: "DEADBEEF".repeat(8), network: "testnet", manifestPath: "anchor/xrpl/manifests/all.json", merkleRoot: root, manifestHash };
    const anchorEvent = signEvent({
      type: "AttestationPublished", repo: "org/app", version: "0.0.0-genesis",
      commit: "0000000", timestamp: "2026-01-05T00:00:00Z",
      artifacts: [{ name: "anchor.json", sha256: "c".repeat(64), uri: "x" }],
      attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:" + meta.txHash }],
      notes: "ledger.anchor: pass\n" + JSON.stringify(meta),
    }, "ci-app-2026", k.privateKey);
    return [release, anchorEvent];
  }

  it("reports 'unsupported merkle algo ... — upgrade CLI', NOT a tamper MISMATCH", async () => {
    const k = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", k.publicPem, "baseline");
    writeEvents(buildAnchoredLedgerWithAlgo(k, "sha256-merkle-v99"));
    process.env.REPOMESH_FORCE_OFFLINE = "1";
    try {
      const { exitCode, result, out } = await runVerify({ repo: "org/app", version: "1.0.0", anchored: true, anchoredOrLocal: true });
      assert.equal(result?.ok, false, "an unverifiable algo must still fail closed");
      // FC1: a future/unsupported algo can't be verified -> soft UNVERIFIED -> exit 3 (verdict unchanged).
      assert.equal(result?.gate?.status, "UNVERIFIED");
      assert.equal(exitCode, 3);
      const blob = JSON.stringify(result).toLowerCase();
      assert.match(blob, /unsupported merkle algo/, "must name the unsupported algo, not claim MISMATCH");
      assert.ok(/upgrade/i.test(blob) || /upgrade/i.test(out), "must hint to upgrade the CLI");
    } finally { delete process.env.REPOMESH_FORCE_OFFLINE; }
  });
});

describe("B-FP-02: --json indentation is consistent (pretty) across exit paths", () => {
  it("early error path and final verdict path are both pretty-printed (multi-line)", async () => {
    // Final verdict path (UNVERIFIED): pretty.
    const k = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", k.publicPem, "baseline");
    writeEvents([baselineRelease(k, "ci-app-2026")]);
    const { out } = await runVerify({ repo: "org/app", version: "1.0.0" });
    const blob = (out.match(/\{[\s\S]*\}/g) || []).pop() || "";
    assert.match(blob, /\n {2}"/, "final --json output must be pretty-printed (2-space indent)");

    // Early error path (ReleasePublished not found): must ALSO be pretty.
    const r2 = await runVerify({ repo: "org/app", version: "9.9.9" });
    const blob2 = (r2.out.match(/\{[\s\S]*\}/g) || []).pop() || "";
    assert.match(blob2, /\n {2}"/, "early-error --json output must be pretty-printed too");
  });
});
