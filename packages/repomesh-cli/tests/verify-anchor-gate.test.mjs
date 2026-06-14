// D4 tests for verify-release --anchored fail-closed behavior (CLI-002 + CLI-008).
// XRPL online verification is exercised separately/integration; here we prove the
// fail-closed invariants that DON'T need a live ledger connection:
//   - --anchored + NO anchor found  => result.ok=false + exit 1   (CLI-002)
//   - offline (no txHash / no network) strict --anchored          => FAIL, not silent PASS
//   - --anchored-or-local relaxes the strict requirement
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
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-anchor-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
}
function writeNode(orgRepo, keyId, publicPem, profileId) {
  const [org, repo] = orgRepo.split("/");
  const dir = join(tmpRoot, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "node.json"), JSON.stringify({
    id: orgRepo, kind: "compute", provides: [], consumes: [], interfaces: [], invariants: {},
    maintainers: [{ name: org, keyId, publicKey: publicPem, contact: "x@example.com" }],
  }, null, 2));
  if (profileId) fs.writeFileSync(join(dir, "repomesh.profile.json"), JSON.stringify({ profileId, profileVersion: "v1" }));
}
function writeEvents(events) {
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
}
async function runVerify(args) {
  const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let exitCode = null, out = "";
  process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
  process.cwd = () => tmpRoot;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try { await verifyRelease({ json: true, ...args }); }
  catch (e) { if (e.message !== "__EXIT__") throw e; }
  finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch {} }
  return { exitCode, out, result };
}

// A baseline (no required checks) release so the attestation gate passes and we
// can isolate anchor behavior.
function baselineRelease(key, keyId) {
  return signEvent({
    type: "ReleasePublished", repo: "org/app", version: "1.0.0",
    commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
    artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
  }, keyId, key.privateKey);
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("CLI-002: --anchored fail-closed", () => {
  it("--anchored with NO anchor partition => ok:false + exit 3 (UNVERIFIED)", async () => {
    const k = makeKeypair();
    writeNode("org/app", "ci-app-2026", k.publicPem, "baseline");
    writeEvents([baselineRelease(k, "ci-app-2026")]);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0", anchored: true });
    assert.equal(result?.ok, false, "--anchored with no anchor must NOT pass");
    // FC1: not-yet-anchored is the soft UNVERIFIED path -> exit 3 (verdict unchanged).
    assert.equal(result?.gate?.status, "UNVERIFIED");
    assert.equal(exitCode, 3);
  });

  it("WITHOUT --anchored, the anchor CHECK does not run (no 'no anchor' exit-1 path)", async () => {
    // anchor is opt-in: without --anchored we must NOT hit the CLI-002 "no anchor -> exit 1"
    // path. A self-signed-only baseline release is still UNVERIFIED (D5 independence), but
    // it is NOT failed for lack of an anchor specifically.
    const k = makeKeypair();
    writeNode("org/app", "ci-app-2026", k.publicPem, "baseline");
    writeEvents([baselineRelease(k, "ci-app-2026")]);
    const { result } = await runVerify({ repo: "org/app", version: "1.0.0", anchored: false });
    // No anchor object at all (the check was skipped), and the verdict is UNVERIFIED (not "no anchor").
    assert.equal(result?.anchor, null, "anchor check should not have run");
    assert.equal(result?.gate?.status, "UNVERIFIED", "self-signed-only baseline is UNVERIFIED, not PASS");
  });
});

describe("D4: offline anchor degradation is FAIL under strict --anchored", () => {
  // Build an anchor event whose partition includes the release leaf, with a txHash,
  // but force network OFF so XRPL can't be contacted. Strict --anchored must FAIL,
  // and must NOT print a verified-looking 'tx=' line. --anchored-or-local relaxes it.
  // anchorKey: an INDEPENDENT anchor node signs the anchor event (realistic — the
  // XRPL anchor node is a separate attestor). This makes the anchor an independent
  // witness so a baseline release can pass once the anchor's local manifest verifies.
  function buildAnchoredLedger(k, anchorKey) {
    const ak = anchorKey || k;
    const release = baselineRelease(k, "ci-app-2026");
    const releaseHash = release.signature.canonicalHash;
    // Anchor a DATE-prefix partition "2026-01-01" so only the release (ts 2026-01-01...)
    // is included — the anchor event itself (ts 2026-01-05) is excluded. leaves=[releaseHash].
    const leaves = [releaseHash];
    const root = merkleRootHex(leaves); // real v1 root over the partition
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
    }, anchorKey ? "ci-anchor-2026" : "ci-app-2026", ak.privateKey);
    return [release, anchorEvent];
  }

  it("strict --anchored offline => ok:false (no silent PASS on unverified tx)", async () => {
    const k = makeKeypair();
    writeNode("org/app", "ci-app-2026", k.publicPem, "baseline");
    writeEvents(buildAnchoredLedger(k));
    // Force offline: bogus ws-url + a flag the impl reads. We simulate offline by
    // setting REPOMESH_FORCE_OFFLINE which the verifier honors.
    process.env.REPOMESH_FORCE_OFFLINE = "1";
    try {
      const { exitCode, result, out } = await runVerify({ repo: "org/app", version: "1.0.0", anchored: true });
      assert.equal(result?.ok, false, "offline strict --anchored must FAIL");
      // FC1: XRPL-not-verified (offline) is the soft UNVERIFIED path -> exit 3 (verdict unchanged).
      assert.equal(result?.gate?.status, "UNVERIFIED");
      assert.equal(exitCode, 3);
      assert.doesNotMatch(out, /Anchored: YES \(.*tx=[A-F0-9]/i, "must not print a verified-looking tx line offline");
    } finally { delete process.env.REPOMESH_FORCE_OFFLINE; }
  });

  it("--anchored-or-local offline => ok:true but flagged local-manifest-only", async () => {
    // D18: the anchor event must be signed by a TRUSTED anchor node to count as a witness.
    // Sign it with the bundled xrpl-anchor node so the --anchored-or-local witness is legitimate.
    const k = makeKeypair();
    const anchorKey = makeKeypair();
    writeNode("org/app", "ci-app-2026", k.publicPem, "baseline");
    writeNode("mcp-tool-shop-org/repomesh-xrpl-anchor", "ci-anchor-2026", anchorKey.publicPem);
    fs.writeFileSync(join(tmpRoot, "ledger", "nodes", "mcp-tool-shop-org", "repomesh-xrpl-anchor", "node.json"),
      JSON.stringify({ id: "mcp-tool-shop-org/repomesh-xrpl-anchor", kind: "attestor", provides: [], consumes: [], interfaces: [], invariants: {},
        maintainers: [{ name: "anchor", keyId: "ci-anchor-2026", publicKey: anchorKey.publicPem, contact: "a@example.com" }] }, null, 2));
    writeEvents(buildAnchoredLedger(k, anchorKey));
    process.env.REPOMESH_FORCE_OFFLINE = "1";
    try {
      const { result } = await runVerify({ repo: "org/app", version: "1.0.0", anchored: true, anchoredOrLocal: true });
      assert.equal(result?.ok, true, "--anchored-or-local should pass offline with a trusted-signer anchor");
      assert.equal(result?.anchor?.xrplVerified, false, "must flag XRPL as NOT verified");
    } finally { delete process.env.REPOMESH_FORCE_OFFLINE; }
  });

  it("D18: --anchored-or-local with a FORGED (non-trusted-signer) anchor does NOT flip UNVERIFIED->PASS", async () => {
    // The anchor event is signed by the release's OWN key (node org/app — NOT a trusted anchor
    // node). Its local manifest + root recompute fine, but the anchor EVENT's signature does not
    // resolve to a bundled trusted attestor/anchor node, so it must NOT be credited as a witness.
    // RED on pre-D18 (anchor witness credited on rootMatch alone), GREEN after.
    const k = makeKeypair();
    writeNode("org/app", "ci-app-2026", k.publicPem, "baseline");
    writeEvents(buildAnchoredLedger(k)); // no anchorKey -> anchor signed by ci-app-2026 (org/app)
    process.env.REPOMESH_FORCE_OFFLINE = "1";
    try {
      const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0", anchored: true, anchoredOrLocal: true });
      assert.equal(result?.ok, false, "a forged (self-signed) anchor must NOT make the release PASS");
      assert.equal(result?.gate?.status, "UNVERIFIED", "no trusted witness => UNVERIFIED, never PASS");
      // FC1: UNVERIFIED -> exit 3 (the verdict is unchanged; only the exit code is tri-state).
      assert.equal(exitCode, 3);
    } finally { delete process.env.REPOMESH_FORCE_OFFLINE; }
  });

  it("anchor merkle root mismatch => ok:false (recompute enforced)", async () => {
    const k = makeKeypair();
    writeNode("org/app", "ci-app-2026", k.publicPem, "baseline");
    const events = buildAnchoredLedger(k);
    // Tamper the manifest root AND recompute manifestHash so the manifestHash check
    // still passes — only the leaf-merkle-recompute (D4 step 2) can catch this.
    const mp = join(tmpRoot, "anchor", "xrpl", "manifests", "all.json");
    const m = JSON.parse(fs.readFileSync(mp, "utf8"));
    m.root = "f".repeat(64); // doesn't match merkle recompute of the leaves
    const { manifestHash: _mh, ...base } = m;
    m.manifestHash = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
    fs.writeFileSync(mp, JSON.stringify(m));
    writeEvents(events);
    process.env.REPOMESH_FORCE_OFFLINE = "1";
    try {
      const { result } = await runVerify({ repo: "org/app", version: "1.0.0", anchored: true, anchoredOrLocal: true });
      assert.equal(result?.ok, false, "manifest root mismatch must fail even in local mode");
    } finally { delete process.env.REPOMESH_FORCE_OFFLINE; }
  });
});
