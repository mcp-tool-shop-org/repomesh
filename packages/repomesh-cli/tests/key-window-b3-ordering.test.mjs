// Wave-B3 residual ③ regression — WIRED INTO the published-CLI verify-release resolution site
// (contract §13.1). Drives the FULL verifyRelease({ local }) offline path against a self-consistent
// temp ledger, so it exercises the SITE's NEW opts wiring (verifySignature/getMaintainer/timeOf/
// trustedPolicy) feeding the shared module's ORDER-AWARE single forward pass.
//
// THE RESIDUAL (contract §13.1): the Wave-B2 derive-stricter protected the MAIN resolution path, but
// the AUTHORIZATION sub-check (is a KeyRotation/KeyRevocation's *signer* currently valid?) validated
// the signer against node.json ALONE. Exploit: attacker holds compromise-revoked K_a; serves a
// node.json that STRIPS K_a's window; the auth path then sees K_a valid → K_a authorizes a LATER
// key-lifecycle event → trust re-established / a legit key falsely restricted. The fix makes
// deriveKeyWindowConstraints an ORDER-AWARE forward pass: a signer's validity is evaluated against
// node.json MERGED WITH the window state from STRICTLY-EARLIER events (derivedSoFar), so an already-
// compromise-revoked K_a can no longer authorize an event that appears LATER in the ledger.
//
// TEST-FIRST: on the PRE-FIX site (order-INSENSITIVE derive + node.json-alone signer validity) the
// stripped K_a is treated as valid, so K_a's later event is honored → these assertions are RED. After
// the §13.1 order-aware wiring they are GREEN.
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

const ANCHOR_NODE = "mcp-tool-shop-org/repomesh-xrpl-anchor";
const ANCHOR_KEY = "ci-xrpl-anchor-2026";
// K_a's compromise invalidity date.
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
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-b3-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
}
function writeNode(orgRepo, kind, maintainers, profileId = "baseline") {
  const [org, repo] = orgRepo.split("/");
  const dir = join(tmpRoot, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "node.json"), JSON.stringify({
    id: orgRepo, kind, provides: [], consumes: [], interfaces: [], invariants: {}, maintainers,
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
function writeManifestForLeaf(leaf, partitionId, relPath) {
  const leaves = [leaf];
  const base = {
    v: 1, algo: "sha256-merkle-v1", partitionId, network: "testnet",
    prev: null, range: [leaf, leaf], count: 1, root: merkleRootForAlgo(leaves, "sha256-merkle-v1"),
  };
  const manifestHash = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
  const abs = join(tmpRoot, relPath);
  fs.mkdirSync(dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ ...base, manifestHash }, null, 2));
  return relPath;
}
// A bundled-trusted XRPL-anchor event whose single-leaf partition pins `leaf` at `anchorTs` (so the
// release leaf gets a PROVABLE trusted clock — the rung-2 trust gate is satisfied by the anchor node).
function anchorEventFor(repo, leaf, anchorTs) {
  const manifestRel = "anchor-test-manifests/b3.json";
  writeManifestForLeaf(leaf, "genesis", manifestRel);
  const anchorKeys = makeKeypair();
  // Register the anchor node (its publicKey makes its signature trusted). NOTE: written AFTER the
  // primary repo node so it never clobbers it.
  writeNode(ANCHOR_NODE, "attestor",
    [{ name: "anchor", keyId: ANCHOR_KEY, publicKey: anchorKeys.publicPem, contact: "anchor@x" }], null);
  return signEvent({
    type: "AttestationPublished", repo, version: "1.0.0", commit: "abcdef0",
    timestamp: anchorTs, attestations: [{ type: "ledger.anchor" }],
    notes: `Anchor\n${JSON.stringify({ manifestPath: manifestRel, network: "testnet" })}`,
  }, ANCHOR_KEY, anchorKeys.privateKey);
}

async function runVerify(args) {
  const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit, origLog = console.log, origErr = console.error;
  let exitCode = null, out = "";
  process.exit = (code) => { exitCode = code; throw new Error("__EXIT__"); };
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try {
    await verifyRelease({ json: true, local: true, localDir: tmpRoot, ...args });
  } catch (e) {
    if (e.message !== "__EXIT__") throw e;
  } finally {
    process.exit = origExit; console.log = origLog; console.error = origErr;
  }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch { /* ignore */ } }
  return { exitCode, result };
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

// =============================================================================================
// ③ — order-aware single forward pass. The signer of a LATER key-lifecycle event must be VALID
// against STRICTLY-EARLIER derived state, not node.json alone.
// =============================================================================================
describe("CLI ③ order-aware authorization (contract §13.1)", () => {
  // ── Literal §13.3 exploit probe: K_a compromise-revoked (earlier) → K_a-signed LATER rotation
  //    K_a→K_b → K_b's release is REJECTED (K_a could not authorize the rotation, so K_b never
  //    gains the rotation's legitimacy). node.json[K_a] is STRIPPED (the tamper); K_b's window in
  //    node.json reflects the rotation the attacker is REPLAYING (validFrom=effectiveAt), so K_b's
  //    standing depends entirely on the (now-unauthorized) rotation.
  it("REJECTS K_b's release — its only standing is a rotation signed by an already-compromise-revoked K_a", async () => {
    const repo = "org/b3-rot";
    const Ka = makeKeypair(), Kb = makeKeypair(), Ksurv = makeKeypair();
    const E = "2026-06-25T12:00:00Z"; // rotation effectiveAt (K_b's validFrom)
    // node.json: K_a STRIPPED (re-grandfathered by the tamper); K_b carries the rotation's window
    // (validFrom=E); K_surv is a grandfathered surviving maintainer that authorizes K_a's revocation.
    writeNode(repo, "compute", [
      { name: "a", keyId: "Ka", publicKey: Ka.publicPem, contact: "a@x" }, // STRIPPED
      { name: "b", keyId: "Kb", publicKey: Kb.publicPem, contact: "b@x", validFrom: E },
      { name: "s", keyId: "Ksurv", publicKey: Ksurv.publicPem, contact: "s@x" },
    ]);
    // K_b's release anchored at Trel ∈ (C, E): node.json's validFrom=E alone REJECTS it (predates
    // validFrom). The exploit's ONLY way to flip it VALID is to have K_a's rotation re-issue K_b with
    // an EARLIER validFrom — which an already-compromise-revoked K_a must NOT be allowed to do.
    const Trel = "2026-06-20T00:00:00Z";
    const rel = signEvent({
      type: "ReleasePublished", repo, version: "1.0.0", commit: "abcdef0",
      timestamp: Trel, artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "Kb", Kb.privateKey);
    const leaf = rel.signature.canonicalHash;
    const anchor = anchorEventFor(repo, leaf, Trel);
    // (E1) EARLIER authorized compromise-revocation of K_a (signed by the surviving key, §4.2).
    const revokeKa = signEvent({
      type: "KeyRevocation", repo, timestamp: "2026-06-18T09:00:00Z",
      key: { action: "revoke", revokedKeyId: "Ka", reason: "compromise", invalidAfter: C },
    }, "Ksurv", Ksurv.privateKey);
    // (E2) LATER rotation K_a→K_b self-signed by K_a, re-issuing K_b with an EARLIER validFrom (the
    // attacker's attempt to make the pre-E release valid).
    const rotate = signEvent({
      type: "KeyRotation", repo, timestamp: "2026-06-19T00:00:00Z",
      key: { action: "rotate", retiringKeyId: "Ka", newKeyId: "Kb", newPublicKey: Kb.publicPem,
             effectiveAt: "2026-06-19T00:00:00Z" },
    }, "Ka", Ka.privateKey);
    writeEvents([revokeKa, rotate, rel, anchor]);

    const { result } = await runVerify({ repo, version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, false,
      "K_b's pre-effectiveAt release must be REJECTED — K_a (compromise-revoked earlier) could not authorize the rotation that would re-issue K_b's validFrom");
    assert.equal(result?.ok, false);
  });

  // ── Distinguishing site probe (RED on the pre-fix order-INSENSITIVE site): a compromise-revoked
  //    K_a tries to wield authority AFTER its own revocation — here it self-signs a KeyRevocation of
  //    the SURVIVING release key K_rel. On the OLD site (node.json-alone signer validity, K_a
  //    stripped → grandfathered → "valid"), K_a's revocation of K_rel is HONORED → K_rel's release
  //    is falsely REJECTED. The order-aware fix sees K_a already compromise-invalid at that event's
  //    time → the revocation is UNAUTHORIZED → K_rel's legit release VERIFIES.
  it("an already-compromise-revoked K_a CANNOT authorize a LATER revocation of the surviving release key", async () => {
    const repo = "org/b3-surv";
    const Ka = makeKeypair(), Krel = makeKeypair(), Kroot = makeKeypair();
    const Trel = "2026-06-22T00:00:00Z";
    writeNode(repo, "compute", [
      { name: "a", keyId: "Ka", publicKey: Ka.publicPem, contact: "a@x" }, // STRIPPED (grandfathered)
      { name: "r", keyId: "Krel", publicKey: Krel.publicPem, contact: "r@x" }, // grandfathered release key
      { name: "root", keyId: "Kroot", publicKey: Kroot.publicPem, contact: "root@x" },
    ]);
    const rel = signEvent({
      type: "ReleasePublished", repo, version: "1.0.0", commit: "abcdef0",
      timestamp: Trel, artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "Krel", Krel.privateKey);
    const leaf = rel.signature.canonicalHash;
    const anchor = anchorEventFor(repo, leaf, Trel);
    // (E1) authorized compromise-revocation of K_a, signed by the root key.
    const revokeKa = signEvent({
      type: "KeyRevocation", repo, timestamp: "2026-06-18T09:00:00Z",
      key: { action: "revoke", revokedKeyId: "Ka", reason: "compromise", invalidAfter: C },
    }, "Kroot", Kroot.privateKey);
    // (E2) LATER revocation of K_rel self-signed by the (already-compromised) K_a — invalidAfter
    // BEFORE Trel, so IF honored it would kill K_rel's release.
    const revokeKrel = signEvent({
      type: "KeyRevocation", repo, timestamp: "2026-06-20T09:00:00Z",
      key: { action: "revoke", revokedKeyId: "Krel", reason: "compromise", invalidAfter: "2026-06-19T00:00:00Z" },
    }, "Ka", Ka.privateKey);
    writeEvents([revokeKa, revokeKrel, rel, anchor]);

    const { result } = await runVerify({ repo, version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, true,
      "K_rel's release must stay VALID — an already-compromise-revoked K_a cannot authorize a later revocation of the surviving key (order-aware §13.1)");
    assert.equal(result?.release?.signerNode, repo);
  });

  // ── CONVERSE (a rotation BEFORE the signer's revocation still stands): K_a rotates to K_b while
  //    still valid, THEN K_a is compromise-revoked. K_b's release (anchored after the rotation,
  //    before/after the later revocation) stays VALID — the fix must not over-reject.
  it("a rotation that PRECEDES K_a's compromise-revocation still legitimizes K_b's release", async () => {
    const repo = "org/b3-conv";
    const Ka = makeKeypair(), Kb = makeKeypair(), Ksurv = makeKeypair();
    const E = "2026-06-10T12:00:00Z"; // rotation effectiveAt — BEFORE K_a's compromise
    writeNode(repo, "compute", [
      { name: "a", keyId: "Ka", publicKey: Ka.publicPem, contact: "a@x",
        validUntil: E, revokedAt: E, revocationReason: "rotation" },
      { name: "b", keyId: "Kb", publicKey: Kb.publicPem, contact: "b@x", validFrom: E },
      { name: "s", keyId: "Ksurv", publicKey: Ksurv.publicPem, contact: "s@x" },
    ]);
    const Trel = "2026-06-15T00:00:00Z"; // after E => within K_b's window
    const rel = signEvent({
      type: "ReleasePublished", repo, version: "1.0.0", commit: "abcdef0",
      timestamp: Trel, artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "Kb", Kb.privateKey);
    const leaf = rel.signature.canonicalHash;
    const anchor = anchorEventFor(repo, leaf, Trel);
    // ROTATION first (K_a still valid at E), THEN the later compromise-revocation of K_a.
    const rotate = signEvent({
      type: "KeyRotation", repo, timestamp: E,
      key: { action: "rotate", retiringKeyId: "Ka", newKeyId: "Kb", newPublicKey: Kb.publicPem, effectiveAt: E },
    }, "Ka", Ka.privateKey);
    const revokeKa = signEvent({
      type: "KeyRevocation", repo, timestamp: "2026-06-20T09:00:00Z",
      key: { action: "revoke", revokedKeyId: "Ka", reason: "compromise", invalidAfter: C },
    }, "Ksurv", Ksurv.privateKey);
    writeEvents([rotate, revokeKa, rel, anchor]);

    const { result } = await runVerify({ repo, version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, true,
      "K_b's release under a rotation that PRECEDED K_a's compromise must stay VALID (the fix is order-aware, not blanket-rejecting)");
    assert.equal(result?.release?.signerNode, repo);
  });
});
