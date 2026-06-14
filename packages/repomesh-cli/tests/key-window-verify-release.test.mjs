// Regression tests for the key-lifecycle window gate WIRED INTO the published-CLI verify-release
// resolution site (contract §1 site 8: extractKeyFromNode via findPublicKey; applied per §5.3).
//
// THE BUG (contract §1): every key-resolution site did an UNTIMED maintainers.find(keyId) and
// returned the key with ZERO time check. A compromised-but-still-listed key therefore scored full
// integrity and verified VALID. These tests drive the FULL verifyRelease({ local }) offline path
// (which uses the SYNC trusted-time resolver — local mode is offline, contract §5.2/§10) against a
// self-consistent temp ledger with WINDOWED maintainers + a real XRPL-anchor event.
//
// TEST-FIRST: on the PRE-FIX code path (no predicate; key resolved untimed) the compromise cases
// would resolve a valid signature and the release would NOT FAIL on the signature chain — these
// assertions are RED there and GREEN after the gate is wired in.
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

// The bundled trusted XRPL-anchor node — its signature on the anchor event is what makes the
// anchor-event timestamp a TRUSTED (provable) offline clock (rung-2 trust gate, contract §5.2).
const ANCHOR_NODE = "mcp-tool-shop-org/repomesh-xrpl-anchor";
const ANCHOR_KEY = "ci-xrpl-anchor-2026";

// Compromise invalidity date C (contract §4.2 fixture).
const C = "2026-06-18T00:00:00Z";

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
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-keywin-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
}

// Write a node.json with an arbitrary maintainer object (so window fields can be attached).
function writeNodeRaw(orgRepo, kind, maintainer, profileId) {
  const [org, repo] = orgRepo.split("/");
  const dir = join(tmpRoot, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "node.json"), JSON.stringify({
    id: orgRepo, kind, provides: [], consumes: [], interfaces: [], invariants: {},
    maintainers: [maintainer],
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

// Write a manifest for a single-leaf partition and return its relative path.
function writeManifestForLeaf(leaf, partitionId, relPath) {
  const leaves = [leaf];
  const manifestBase = {
    v: 1, algo: "sha256-merkle-v1", partitionId, network: "testnet",
    prev: null, range: [leaf, leaf], count: 1, root: merkleRootForAlgo(leaves, "sha256-merkle-v1"),
  };
  const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
  const manifest = { ...manifestBase, manifestHash };
  const abs = join(tmpRoot, relPath);
  fs.mkdirSync(dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(manifest, null, 2));
  return relPath;
}

async function runVerify(args) {
  const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit;
  const origLog = console.log;
  const origErr = console.error;
  let exitCode = null;
  let out = "";
  process.exit = (code) => { exitCode = code; throw new Error("__EXIT__"); };
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try {
    // local + localDir: explicit offline checkout root => SYNC resolver path.
    await verifyRelease({ json: true, local: true, localDir: tmpRoot, ...args });
  } catch (e) {
    if (e.message !== "__EXIT__") throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch { /* ignore */ } }
  return { exitCode, out, result };
}

// Build a release signed by `relKeyId` for repo `repo` at a backdated self-timestamp, plus a
// bundled-trusted anchor event whose partition pins the release leaf, anchored at `anchorTs`.
// `anchored=false` => no anchor event (the leaf stays unanchored => self time only).
function buildAnchoredRelease({ repo, relKeyId, relPriv, selfTs, anchorTs, anchored = true }) {
  const release = signEvent({
    type: "ReleasePublished", repo, version: "1.0.0", commit: "abcdef0",
    timestamp: selfTs, artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
  }, relKeyId, relPriv);

  const events = [release];
  if (anchored) {
    const leaf = release.signature.canonicalHash;
    const partitionId = "genesis";
    const manifestRel = "anchor-test-manifests/keywin.json";
    writeManifestForLeaf(leaf, partitionId, manifestRel);
    const anchorKeys = makeKeypair();
    writeNodeRaw(ANCHOR_NODE, "attestor",
      { name: "anchor", keyId: ANCHOR_KEY, publicKey: anchorKeys.publicPem, contact: "anchor@x" });
    const anchor = signEvent({
      type: "AttestationPublished", repo, version: "1.0.0", commit: "abcdef0",
      timestamp: anchorTs, attestations: [{ type: "ledger.anchor" }],
      notes: `Anchor\n${JSON.stringify({ manifestPath: manifestRel, network: "testnet" })}`,
    }, ANCHOR_KEY, anchorKeys.privateKey);
    events.push(anchor);
  }
  return events;
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("CLI key-window gate — grandfather unchanged (contract §9.1)", () => {
  it("a window-less maintainer verifies its release signature byte-identically to today", async () => {
    const rel = makeKeypair();
    writeNodeRaw("org/legacy", "compute",
      { name: "org", keyId: "ci-legacy-2026", publicKey: rel.publicPem, contact: "x@x" }, "baseline");
    const events = buildAnchoredRelease({
      repo: "org/legacy", relKeyId: "ci-legacy-2026", relPriv: rel.privateKey,
      selfTs: "2026-06-01T00:00:00Z", anchorTs: "2026-06-19T00:00:00Z",
    });
    writeEvents(events);
    const { result } = await runVerify({ repo: "org/legacy", version: "1.0.0" });
    // The signature must still resolve + verify against the grandfathered key — exactly today.
    assert.equal(result?.release?.signatureValid, true, "grandfathered key signature must still verify");
    assert.equal(result?.release?.signerNode, "org/legacy");
  });
});

describe("CLI key-window gate — compromise (contract §9.2/§9.3/§9.4)", () => {
  // The compromised maintainer: revoked with reason compromise + invalidAfter=C.
  function writeCompromised(repo, keyId, publicPem) {
    writeNodeRaw(repo, "compute", {
      name: "org", keyId, publicKey: publicPem, contact: "x@x",
      revokedAt: "2026-06-20T09:00:00Z", revocationReason: "compromise", invalidAfter: C,
    }, "baseline");
  }

  it("REJECTS a release whose leaf is PROVABLY anchored AT/AFTER invalidAfter (compromise)", async () => {
    const rel = makeKeypair();
    const repo = "org/comp-after";
    writeCompromised(repo, "ci-comp-2026", rel.publicPem);
    // Backdated self-timestamp (< C) but the trusted anchor proves the leaf existed at 2026-06-19 (> C).
    const events = buildAnchoredRelease({
      repo, relKeyId: "ci-comp-2026", relPriv: rel.privateKey,
      selfTs: "2026-06-10T00:00:00Z", anchorTs: "2026-06-19T00:00:00Z",
    });
    writeEvents(events);
    const { result } = await runVerify({ repo, version: "1.0.0" });
    // The compromised key resolves to NO key at the post-C provable time => signature chain FAILS.
    assert.equal(result?.release?.signatureValid, false,
      "a provably-post-compromise signature must NOT verify (backdated self-time cannot rescue it)");
    assert.equal(result?.ok, false);
  });

  it("KEEPS VALID a release whose leaf is PROVABLY anchored BEFORE invalidAfter (compromise)", async () => {
    const rel = makeKeypair();
    const repo = "org/comp-before";
    writeCompromised(repo, "ci-comp-2026", rel.publicPem);
    // Trusted anchor proves the leaf existed at 2026-06-17 (< C) => the past signature stays valid.
    const events = buildAnchoredRelease({
      repo, relKeyId: "ci-comp-2026", relPriv: rel.privateKey,
      selfTs: "2026-06-15T00:00:00Z", anchorTs: "2026-06-17T00:00:00Z",
    });
    writeEvents(events);
    const { result } = await runVerify({ repo, version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, true,
      "compromise must NOT retroactively kill a PROVABLY-old (pre-C, anchored) signature");
    assert.equal(result?.release?.signerNode, repo);
  });

  it("REJECTS a release that is UNANCHORED (self-time only) under a compromised key", async () => {
    const rel = makeKeypair();
    const repo = "org/comp-unanchored";
    writeCompromised(repo, "ci-comp-2026", rel.publicPem);
    // No anchor event => the leaf is unanchored => only the (untrustworthy) self time is available.
    const events = buildAnchoredRelease({
      repo, relKeyId: "ci-comp-2026", relPriv: rel.privateKey,
      selfTs: "2026-06-10T00:00:00Z", anchorTs: null, anchored: false,
    });
    writeEvents(events);
    const { result } = await runVerify({ repo, version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, false,
      "a compromised key with only a self-asserted (unprovable) time must be rejected");
    assert.equal(result?.ok, false);
  });
});

describe("CLI key-window gate — node.json-STRIP bypass (contract §12.1 / §12.3 probe)", () => {
  // THE WAVE-B2 BUG (§12.1 Finding ①): a verifier reads window state from node.json and (unlike
  // validate-ledger) does NOT run the binding check. A tampered node.json that STRIPS a revoked
  // key's window fields re-grandfathers it (isWindowed=false => VALID). The defence (§12.1): derive
  // the window from the SIGNED KeyRevocation event in the ledger and merge the STRICTER — a tampered
  // node.json can only ADD restriction, never remove what the signed event asserts.
  //
  // TEST-FIRST: on the post-Wave-B code (no derive-stricter at this site) the STRIPPED node.json
  // re-grandfathers k1 => the post-compromise release verifies VALID => this assertion is RED.
  // After the §12.1 wrap it is GREEN (the signed event re-imposes the compromise window).

  // Build a KeyRevocation(compromise, invalidAfter=C) for `revokedKeyId` on `repo`, signed by a
  // SURVIVING same-node key (authorized per §4.2). Returns the signed event.
  function buildKeyRevocation({ repo, revokedKeyId, survivingKeyId, survivingPriv, invalidAfter, ts }) {
    return signEvent({
      type: "KeyRevocation", repo, timestamp: ts,
      key: { action: "revoke", revokedKeyId, reason: "compromise", invalidAfter },
    }, survivingKeyId, survivingPriv);
  }

  it("STILL REJECTS a provably-post-compromise release when node.json window fields are STRIPPED", async () => {
    const compromised = makeKeypair();
    const surviving = makeKeypair();
    const repo = "org/strip-comp";
    // node.json: k1 (compromised) is GRANDFATHER-STRIPPED (NO window fields — the tamper), k2 is a
    // window-less surviving maintainer of the SAME node (authorized to sign the revocation, §4.2).
    const [org, repoName] = repo.split("/");
    const dir = join(tmpRoot, "ledger", "nodes", org, repoName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, "node.json"), JSON.stringify({
      id: repo, kind: "compute", provides: [], consumes: [], interfaces: [], invariants: {},
      maintainers: [
        { name: "org", keyId: "ci-comp-2026", publicKey: compromised.publicPem, contact: "x@x" }, // STRIPPED
        { name: "org", keyId: "ci-surv-2026", publicKey: surviving.publicPem, contact: "y@y" },     // grandfathered
      ],
    }, null, 2));
    fs.writeFileSync(join(dir, "repomesh.profile.json"),
      JSON.stringify({ profileId: "baseline", profileVersion: "v1" }, null, 2));

    // Release signed by the compromised key, PROVABLY anchored AT/AFTER C (anchorTs 2026-06-19 > C).
    const events = buildAnchoredRelease({
      repo, relKeyId: "ci-comp-2026", relPriv: compromised.privateKey,
      selfTs: "2026-06-10T00:00:00Z", anchorTs: "2026-06-19T00:00:00Z",
    });
    // The SIGNED revocation event remains in the ledger (only node.json was tampered).
    events.push(buildKeyRevocation({
      repo, revokedKeyId: "ci-comp-2026",
      survivingKeyId: "ci-surv-2026", survivingPriv: surviving.privateKey,
      invalidAfter: C, ts: "2026-06-20T09:00:00Z",
    }));
    writeEvents(events);

    const { result } = await runVerify({ repo, version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, false,
      "a stripped node.json must NOT re-grandfather a key the SIGNED ledger revoked for compromise");
    assert.equal(result?.ok, false);
  });
});

describe("CLI key-window gate — routine rotation is prospective-only (contract §9.5)", () => {
  it("a signature BEFORE the rotation time stays VALID (self time trusted for rotation)", async () => {
    const rel = makeKeypair();
    const repo = "org/rot-before";
    const R = "2026-06-14T12:00:00Z";
    writeNodeRaw(repo, "compute", {
      name: "org", keyId: "ci-rot-2026", publicKey: rel.publicPem, contact: "x@x",
      validUntil: R, revokedAt: R, revocationReason: "rotation",
    }, "baseline");
    // self-time < R, unanchored — rotation trusts the self time (no anchor required).
    const events = buildAnchoredRelease({
      repo, relKeyId: "ci-rot-2026", relPriv: rel.privateKey,
      selfTs: "2026-06-01T00:00:00Z", anchorTs: null, anchored: false,
    });
    writeEvents(events);
    const { result } = await runVerify({ repo, version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, true,
      "a pre-rotation signature must stay valid (rotation is prospective)");
  });

  it("a signature AT/AFTER the rotation time is REJECTED (key rotated out)", async () => {
    const rel = makeKeypair();
    const repo = "org/rot-after";
    const R = "2026-06-14T12:00:00Z";
    writeNodeRaw(repo, "compute", {
      name: "org", keyId: "ci-rot-2026", publicKey: rel.publicPem, contact: "x@x",
      validUntil: R, revokedAt: R, revocationReason: "rotation",
    }, "baseline");
    // self-time AFTER R, unanchored — rotation trusts the self time => at/after R is rejected.
    const events = buildAnchoredRelease({
      repo, relKeyId: "ci-rot-2026", relPriv: rel.privateKey,
      selfTs: "2026-07-01T00:00:00Z", anchorTs: null, anchored: false,
    });
    writeEvents(events);
    const { result } = await runVerify({ repo, version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, false,
      "a post-rotation signature must be rejected (key rotated out)");
    assert.equal(result?.ok, false);
  });
});
