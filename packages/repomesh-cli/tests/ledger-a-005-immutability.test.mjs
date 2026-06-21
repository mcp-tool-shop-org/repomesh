// LEDGER-A-005 (HIGH) regression — the published CLI (packages/repomesh-cli/src/verify/verify-release.mjs)
// must FAIL when a LOCAL ledger has been truncated/reordered relative to a COMMITTED anchor manifest's
// pinned Merkle root.
//
// THE EXPLOIT: an attacker drops a signed KeyRevocation event (+ strips node.json window fields) from a
// LOCAL checkout's ledger so a compromise-revoked key appears live, then runs `repomesh verify-release
// --local` on a post-revocation release. The §12.1 derive-stricter window defence CANNOT see a DELETED
// event. The committed anchor manifests (anchor/xrpl/manifests/*.json) pin each partition's Merkle root,
// so dropping/reordering ANY anchored event makes the recomputed root diverge from the pinned root.
// verify-release must recompute the committed manifests' roots over the loaded ledger and HARD-FAIL on
// any mismatch — byte-identical in behaviour to ledger/scripts/validate-ledger.mjs verifyAnchorManifests.
//
// TEST-FIRST: on the PRE-FIX CLI code, a truncated ledger whose dropped event is NOT the release's leaf
// verifies as PASS (exit 0). After the immutability check is added, the verdict is a hard FAIL (exit 1).
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
const { merkleRootForAlgo } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { privateKey, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

function signEvent(body, keyId, privateKey) {
  const ev = { ...body };
  delete ev.signature;
  const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  const value = crypto.sign(null, Buffer.from(canonHash, "hex"), privateKey).toString("base64");
  return { ...ev, signature: { alg: "ed25519", keyId, value, canonicalHash: canonHash } };
}

let tmpRoot;

function setupRoot() {
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-ledger-a-005-"));
  // mode.mjs requires ledger/events/events.jsonl + registry/ + schemas/ to consider it "local".
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
  if (profileId) {
    fs.writeFileSync(join(dir, "repomesh.profile.json"),
      JSON.stringify({ profileId, profileVersion: "v1" }, null, 2));
  }
}

function writeEvents(events) {
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"),
    events.map(e => JSON.stringify(e)).join("\n") + "\n");
}

function writeManifest(name, manifest) {
  const dir = join(tmpRoot, "anchor", "xrpl", "manifests");
  fs.mkdirSync(dir, { recursive: true });
  const { manifestHash, ...base } = manifest;
  const mh = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
  fs.writeFileSync(join(dir, `${name}.json`), JSON.stringify({ ...base, manifestHash: mh }, null, 2));
}

// Run verifyRelease capturing exit code + JSON result, with cwd pointed at tmpRoot.
async function runVerify(args) {
  const { verifyRelease } = await import(
    toURL(resolve(srcDir, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let exitCode = null, out = "";
  process.exit = (code) => { exitCode = code; throw new Error("__EXIT__"); };
  process.cwd = () => tmpRoot;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try {
    await verifyRelease({ json: true, local: true, ...args });
  } catch (e) {
    if (e.message !== "__EXIT__") throw e;
  } finally {
    process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr;
  }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch { /* ignore */ } }
  return { exitCode, out, result };
}

// Build the honest partition: a release + an independent passing witness + two filler anchored events.
// The SECOND filler is the DROPPABLE one — anchored (inside the pinned range) but NOT the release leaf.
function buildScenario(algo) {
  const relKeys = makeKeypair();
  const witnessKeys = makeKeypair();
  writeNode("org/app", "compute", "ci-app-2026", relKeys.publicPem, "baseline");
  // license-verifier is a bundled trusted attestor — its valid signature is an independent witness.
  writeNode("mcp-tool-shop-org/repomesh-license-verifier", "attestor", "ci-witness-2026", witnessKeys.publicPem);

  const release = signEvent({
    type: "ReleasePublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
    timestamp: "2026-01-01T00:00:00Z",
    artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
  }, "ci-app-2026", relKeys.privateKey);

  const witness = signEvent({
    type: "AttestationPublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
    timestamp: "2026-01-02T00:00:00Z",
    attestations: [{ type: "license.audit", uri: "https://example/license.audit" }],
    notes: "license.audit: pass — note",
  }, "ci-witness-2026", witnessKeys.privateKey);

  const filler1 = signEvent({
    type: "AttestationPublished", repo: "org/other", version: "9.9.9", commit: "f1",
    timestamp: "2026-01-03T00:00:00Z",
    attestations: [{ type: "sbom", uri: "https://example/sbom1" }], notes: "sbom: pass — filler 1",
  }, "ci-witness-2026", witnessKeys.privateKey);
  const droppable = signEvent({
    type: "AttestationPublished", repo: "org/other", version: "9.9.10", commit: "f2",
    timestamp: "2026-01-04T00:00:00Z",
    attestations: [{ type: "sbom", uri: "https://example/sbom2" }], notes: "sbom: pass — filler 2 (DROPPABLE)",
  }, "ci-witness-2026", witnessKeys.privateKey);

  const fullEvents = [release, witness, filler1, droppable];
  const leaves = fullEvents.map(e => e.signature.canonicalHash);
  const root = merkleRootForAlgo(leaves, algo);
  writeManifest("all", {
    v: 1, algo, partitionId: "all", network: "testnet", prev: null,
    range: [leaves[0], leaves[leaves.length - 1]], count: leaves.length, root,
  });
  return { fullEvents, droppable };
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("LEDGER-A-005 CLI — truncated/reordered local ledger must FAIL against committed manifests", () => {
  it("v1: dropping a signed anchored event (not the release leaf) => FAIL", async () => {
    const { fullEvents, droppable } = buildScenario("sha256-merkle-v1");
    // EXPLOIT: write the ledger WITHOUT the droppable anchored event.
    writeEvents(fullEvents.filter(e => e !== droppable));
    const { exitCode, result, out } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "a truncated local ledger must NOT pass");
    assert.equal(exitCode, 1, "a truncated local ledger must exit 1 (hard FAIL)");
    assert.match(out, /immutab|merkle|manifest|truncat|reorder/i,
      "the failure must name the manifest immutability violation");
  });

  it("v2: dropping a signed anchored event (not the release leaf) => FAIL", async () => {
    const { fullEvents, droppable } = buildScenario("sha256-merkle-v2");
    writeEvents(fullEvents.filter(e => e !== droppable));
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "a truncated local ledger (v2 manifest) must NOT pass");
    assert.equal(exitCode, 1, "a truncated local ledger (v2) must exit 1");
  });

  it("HONEST ledger (no tamper) still verifies (no false positive)", async () => {
    const { fullEvents } = buildScenario("sha256-merkle-v1");
    writeEvents(fullEvents);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, true, "an honest ledger must not trip the immutability check");
    assert.notEqual(exitCode, 1, "an honest ledger must not hard-FAIL");
  });
});
