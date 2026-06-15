// Wave-B2 COMPOSED CROSS-LAYER RE-AUDIT PROBE (contract §12.3, the headline).
//
// WRITTEN BY THE ADVERSARIAL RE-AUDITOR — a DIFFERENT agent than the Wave-B2 builders. This
// file does not exist to re-assert the builders' per-site regressions; it exists to prove, from
// ONE shared fixture, that the cross-family residual is closed at EVERY non-validate-ledger
// verification surface simultaneously. If any single layer re-grandfathered the stripped key,
// the GREEN verdict is FALSE.
//
// THE FINDING UNDER TEST (contract §12.1, cross-family verifier, HIGH): the non-validate-ledger
// verifiers (build-trust, CLI verify-release, tools/verify-release, verifiers/common, attestor)
// read window state from node.json and do NOT run the §8 ledger binding check. A tampered
// node.json that STRIPS a compromise-revoked key's window fields re-grandfathers it
// (isWindowed=false => the predicate short-circuits VALID), even though the SIGNED KeyRevocation
// event is STILL in the ledger. The §12.1 fix: derive the window from the SIGNED, AUTHORIZED
// KeyRotation/KeyRevocation events (deriveKeyWindowConstraints) and merge in the MOST RESTRICTIVE
// of node.json + derived (mergeStricterWindow) BEFORE the predicate.
//
// THE PROBE'S STRUCTURE (one fixture, two independent rejection mechanisms, five layers):
//   • node.json for the release repo STRIPS every window field off the compromised key
//     (keyId + publicKey only) — it grandfathers on node.json alone.
//   • The SIGNED KeyRevocation(reason:compromise, invalidAfter=C) REMAINS in the ledger, signed
//     by a SURVIVING same-node key (§4.2 authorized).
//   • Mechanism A (PROVABLE post-C): the release leaf is anchored by a bundled-trusted anchor at
//     a time AT/AFTER C  => isKeyValidForSignature rejects with "compromise invalidity date".
//   • Mechanism B (UNPROVABLE pre-C): the SAME release is UNANCHORED, self-timestamp backdated
//     to before C => compromise demands a provable time => rejected with "requires a provable".
//   Both mechanisms fire only because the SIGNED EVENT re-imposes the compromise window the
//   tampered node.json tried to erase. A control (no signed event in the ledger) confirms the
//   stripped key grandfathers — proving the rejection is caused by derive-stricter, not a dead
//   path.
//
// LAYERS DRIVEN (each through its REAL public entry where the §12.1 wrap actually runs):
//   1. registry/scripts/build-trust.mjs        -> buildTrust({ ...paths, write:false })  (sites 1/2/11)
//   2. verifiers/lib/common.mjs                -> getPublicKeyForKeyId(node, keyId, ev, ctx) (site 9)
//   3. attestor/scripts/attest-release.mjs     -> checkSignatureChain(rel, ctx)            (site 10)
//   4. packages/repomesh-cli verify-release    -> computeVerifyResult({ preloadedEvents, localDir }) (site 8)
//   5. tools/verify-release.mjs                -> SUBPROCESS (env-var fixture, asserts exit code) (sites 6/7)
//
// ROTATION-PREEMPT (§12.3) and FAIL-CLOSED (§12.2) are proven at the shared-predicate level (the
// one place the decision lives) so the proof binds every layer that imports the module.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

import { buildTrust } from "../../registry/scripts/build-trust.mjs";
import { getPublicKeyForKeyId } from "../../verifiers/lib/common.mjs";
import { computeVerifyResult } from "../../packages/repomesh-cli/src/verify/verify-release.mjs";
import {
  keyWindow,
  isKeyValidForSignature,
  deriveKeyWindowConstraints,
  __deriveLegacyForTests,
  mergeStricterWindow,
} from "../../verifiers/lib/key-window.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

// ---- constants -------------------------------------------------------------------------------
const RELEASE = "test-org/widget";
const ANCHOR = "test-org/anchor";       // the fixture anchor node (in OUR fixture policy's trustedAttestors)
// A REAL bundled-trusted anchor repo (in the live verifier.policy.json trustedAttestors). The
// attestor subprocess resolves trustedAttestors from the repo-root policy (ROOT is hard-derived
// from import.meta.dirname, ignoring REPOMESH_VERIFIER_POLICY_PATH), so the attestor's rung-2
// trust gate only accepts an anchor whose repo is in the LIVE policy. Use this for the attestor
// layer so the PROVABLE post-C anchor path is exercised end-to-end.
const REAL_ANCHOR = "mcp-tool-shop-org/repomesh-xrpl-anchor";
const C = "2026-06-18T00:00:00.000Z";   // the compromise invalidity date
const POST_C = "2026-06-20T00:00:00.000Z"; // anchor close-time AT/AFTER C (provable post-compromise)
const PRE_SELF = "2026-03-01T00:00:00.000Z"; // backdated self-timestamp (< C, but unprovable)

// ---- crypto + canonicalization (mirror the ledger exactly) -----------------------------------
function genKeyPair() {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}
function canonicalHashOf(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.signature;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(copy)), "utf8").digest("hex");
}
function sign(ev, keyId, privateKey) {
  const unsigned = { ...ev };
  delete unsigned.signature;
  const hash = canonicalHashOf(unsigned);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  return { ...unsigned, signature: { alg: "ed25519", keyId, value: sig.toString("base64"), canonicalHash: hash } };
}

// ---- event builders --------------------------------------------------------------------------
function release({ keyId, timestamp = PRE_SELF } = {}) {
  return {
    type: "ReleasePublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp,
    artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/b.js" }],
    attestations: [],
  };
}

// An anchor AttestationPublished whose partition `range` (lexicographic) covers `leafHash`, with
// the chosen close-time `ts`. Mirrors the live ledger (notes carry a trailing JSON block). This
// is the model build-trust + the event-timestamp ladder consume offline.
function anchorFor(leafHash, ts) {
  const meta = {
    txHash: "DEADBEEF".repeat(8), network: "testnet", walletAddress: "rTest",
    partitionId: "p1", merkleRoot: "f".repeat(64), eventCount: 1,
    range: [leafHash, leafHash],
  };
  return {
    type: "AttestationPublished", repo: ANCHOR, version: "0.0.0-genesis", commit: "0000000",
    timestamp: ts,
    artifacts: [{ name: "anchor.json", sha256: "f".repeat(64), uri: "https://x/anchor.json" }],
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:DEADBEEF" }],
    notes: "ledger.anchor: pass\n" + JSON.stringify(meta),
  };
}

// A KeyRevocation(reason:compromise, invalidAfter=C) for `revokedKeyId`, key-family envelope (§3.2:
// no version/commit/artifacts).
function keyRevocation(revokedKeyId, invalidAfter) {
  return {
    type: "KeyRevocation", repo: RELEASE,
    timestamp: "2026-06-19T00:00:00.000Z",
    key: { action: "revoke", revokedKeyId, reason: "compromise", invalidAfter },
  };
}

// node.json manifest. maintainers passed as-is so a test can STRIP window fields.
function nodeManifest(id, kind, maintainers) {
  return {
    id, kind, description: `${kind} node`, provides: [`${kind}.v1`], consumes: [],
    interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
    invariants: { deterministicBuild: false, signedReleases: false, semver: true, changelog: true },
    maintainers, tags: ["test"],
  };
}
function maintainer(keyId, pubPem, window = {}) {
  return { name: "tester", keyId, publicKey: pubPem.trim(), contact: "t@example.com", ...window };
}

// ---- shared fixture ON DISK (the canonical ledger/nodes layout) ------------------------------
// One directory tree that EVERY disk-reading layer (build-trust, CLI local, tools subprocess)
// resolves against. Returns the paths + a teardown.
function stageFixture({ events, nodes }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-b2-composed-"));
  const nodesDir = path.join(dir, "ledger", "nodes");
  const eventsDir = path.join(dir, "ledger", "events");
  const profilesDir = path.join(dir, "profiles");
  const registryDir = path.join(dir, "registry");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(registryDir, { recursive: true });
  for (const n of nodes) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }
  const policyPath = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify({
    v: 1,
    trustedAttestors: [ANCHOR, RELEASE],
    trustedPolicy: [RELEASE],
    checks: {},
  }, null, 2));
  const ledgerPath = path.join(eventsDir, "events.jsonl");
  fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return { dir, nodesDir, ledgerPath, policyPath, profilesDir, registryDir };
}

// Per-site verifyAndAuthorize the in-process layers (common, predicate-level) reuse. Mirrors the
// production gate: a key event counts only if its signature verifies against a SURVIVING same-node
// key (!= the affected key) per §4.2. (build-trust + the CLI + tools build their OWN internally;
// this is only for the direct getPublicKeyForKeyId / predicate calls.)
function makeVerifyAndAuthorize(nodes) {
  const byRepo = new Map(nodes.map((n) => [n.id, n]));
  return (ev) => {
    if (!ev || (ev.type !== "KeyRotation" && ev.type !== "KeyRevocation")) return false;
    const signerKeyId = ev?.signature?.keyId;
    const affected = ev?.key?.action === "revoke" ? ev?.key?.revokedKeyId : ev?.key?.retiringKeyId;
    if (!signerKeyId || (signerKeyId === affected && ev.type === "KeyRevocation")) return false;
    const node = byRepo.get(ev.repo);
    const signer = node?.maintainers?.find((m) => m.keyId === signerKeyId);
    if (!signer?.publicKey) return false;
    try {
      return crypto.verify(
        null, Buffer.from(ev.signature.canonicalHash, "hex"),
        String(signer.publicKey).trim(), Buffer.from(ev.signature.value || "", "base64")
      );
    } catch { return false; }
  };
}

// A ctx for getPublicKeyForKeyId that anchors a leaf to a trusted anchor at the given time AND
// carries events + repo + verifyAndAuthorize (the derive-stricter inputs).
function commonCtx({ events, nodes, anchorLeaf, anchorTs }) {
  const anchor = { type: "AttestationPublished", repo: ANCHOR, timestamp: anchorTs, signature: { canonicalHash: "c".repeat(64) } };
  return {
    findEarliestAnchorForLeaf: (leaf) => (anchorLeaf && leaf === anchorLeaf ? { anchor } : null),
    isBundledTrustedAnchor: (a) => a?.repo === ANCHOR,
    events,
    repo: RELEASE,
    verifyAndAuthorize: makeVerifyAndAuthorize(nodes),
  };
}

// ==============================================================================================
let RK, SK, NK; // compromised release key / surviving same-node key / anchor key
before(() => { RK = genKeyPair(); SK = genKeyPair(); NK = genKeyPair(); });

// The STRIPPED node set: the compromised key carries NO window fields (the tamper); a surviving
// same-node key signs the revocation; the anchor node holds the anchor key.
function strippedNodes() {
  return [
    nodeManifest(RELEASE, "registry", [
      maintainer("rel-key", RK.publicKey),     // window STRIPPED — grandfathers on node.json alone
      maintainer("rel-key-2", SK.publicKey),   // surviving same-node signer of the revocation
    ]),
    nodeManifest(ANCHOR, "attestor", [maintainer("anchor-key", NK.publicKey)]),
  ];
}

describe("Wave-B2 COMPOSED — node.json-strip rejected at EVERY non-validate-ledger layer (§12.3)", () => {
  // ---------------------------------------------------------------------------------------------
  // LAYER 1 — registry/build-trust (sites 1/2/11). Provable post-C anchor.
  // ---------------------------------------------------------------------------------------------
  it("LAYER build-trust: STRIPPED node.json + signed KeyRevocation + provable post-C anchor => NOT scored", () => {
    const rel = sign(release({ keyId: "rel-key" }), "rel-key", RK.privateKey);
    const anchor = sign(anchorFor(rel.signature.canonicalHash, POST_C), "anchor-key", NK.privateKey);
    const revoke = sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);
    const fx = stageFixture({ events: [rel, anchor, revoke], nodes: strippedNodes() });
    const out = buildTrust({
      ledgerPath: fx.ledgerPath, nodesDir: fx.nodesDir, profilesDir: fx.profilesDir,
      registryDir: fx.registryDir, policyPath: fx.policyPath, write: false,
    });
    const entry = out.find((e) => e.repo === RELEASE && e.version === "1.0.0");
    assert.ok(!entry,
      "build-trust must NOT score a compromise-revoked key whose node.json window was stripped (signed event re-imposes the window)");
  });

  it("LAYER build-trust CONTROL: WITHOUT the signed KeyRevocation, the stripped key grandfathers (scores)", () => {
    const rel = sign(release({ keyId: "rel-key" }), "rel-key", RK.privateKey);
    const anchor = sign(anchorFor(rel.signature.canonicalHash, POST_C), "anchor-key", NK.privateKey);
    const fx = stageFixture({ events: [rel, anchor], nodes: strippedNodes() });
    const out = buildTrust({
      ledgerPath: fx.ledgerPath, nodesDir: fx.nodesDir, profilesDir: fx.profilesDir,
      registryDir: fx.registryDir, policyPath: fx.policyPath, write: false,
    });
    const entry = out.find((e) => e.repo === RELEASE && e.version === "1.0.0");
    assert.ok(entry, "with no signed key event there is no constraint to derive => grandfather (byte-identical to today)");
  });

  // ---------------------------------------------------------------------------------------------
  // LAYER 2 — verifiers/lib/common.mjs getPublicKeyForKeyId (site 9).
  // Mechanism A: provable post-C anchor => THROW "compromise invalidity date".
  // ---------------------------------------------------------------------------------------------
  it("LAYER verifiers/common: STRIPPED node.json + signed revocation + provable post-C => THROWS (compromise)", () => {
    const nodes = strippedNodes();
    const rel = sign(release({ keyId: "rel-key" }), "rel-key", RK.privateKey);
    const revoke = sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);
    const ctx = commonCtx({
      events: [rel, revoke], nodes,
      anchorLeaf: rel.signature.canonicalHash, anchorTs: POST_C,
    });
    const manifest = nodes.find((n) => n.id === RELEASE);
    assert.throws(
      () => getPublicKeyForKeyId(manifest, "rel-key", rel, ctx),
      /compromise invalidity date/,
      "stripped node.json must not re-grandfather a key the signed ledger event revoked for compromise");
  });

  it("LAYER verifiers/common: STRIPPED node.json + signed revocation + UNPROVABLE self-time < C => THROWS (requires provable)", () => {
    const nodes = strippedNodes();
    const rel = sign(release({ keyId: "rel-key", timestamp: PRE_SELF }), "rel-key", RK.privateKey);
    const revoke = sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);
    // No anchor => only the backdated self-time is available (provable:false). Compromise rejects.
    const ctx = commonCtx({ events: [rel, revoke], nodes, anchorLeaf: null, anchorTs: null });
    const manifest = nodes.find((n) => n.id === RELEASE);
    assert.throws(
      () => getPublicKeyForKeyId(manifest, "rel-key", rel, ctx),
      /provable \(anchored\) signature time/,
      "an unanchored post-compromise signature must be rejected even when its self-time predates C");
  });

  // ---------------------------------------------------------------------------------------------
  // LAYER 3 — attestor/scripts/attest-release.mjs checkSignatureChain (site 10).
  // Driven as a SUBPROCESS because the attestor reads NODES_DIR + verifier.policy.json at module
  // load from env/ROOT — a fresh process per fixture is the faithful end-to-end exercise.
  // ---------------------------------------------------------------------------------------------
  it("LAYER attestor: STRIPPED node.json + signed revocation + provable post-C anchor => sig-chain FAILS (subprocess)", () => {
    const nodes = strippedNodes();
    // The attestor's rung-2 trust gate accepts an anchor only if its repo is in the LIVE
    // verifier.policy.json trustedAttestors. ROOT is hard-derived from import.meta.dirname and
    // loadTrustedAttestors() ignores REPOMESH_VERIFIER_POLICY_PATH, so the gate is governed by the
    // real repo policy — use REAL_ANCHOR (a live trustedAttestor) so the PROVABLE post-C rung fires.
    const rel = sign(release({ keyId: "rel-key", timestamp: PRE_SELF }), "rel-key", RK.privateKey);
    const revoke = sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);
    const anchorMeta = {
      txHash: "TXB2", network: "testnet", partitionId: "p-b2",
      partitionStart: "2026-01-01T00:00:00.000Z", partitionEnd: "2026-12-31T00:00:00.000Z",
      merkleRoot: "d".repeat(64),
    };
    const anchor = sign({
      type: "AttestationPublished", repo: REAL_ANCHOR, timestamp: POST_C,
      attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:TXB2" }],
      notes: "ledger.anchor: pass\n" + JSON.stringify(anchorMeta),
    }, "anchor-key", NK.privateKey);

    const fx = stageFixture({ events: [rel, anchor, revoke], nodes });
    const attestorUrl = pathToFileURL(path.join(REPO_ROOT, "attestor/scripts/attest-release.mjs")).href;
    const driver = `
import assert from "node:assert/strict";
import { buildAttestorTimeCtx, checkSignatureChain } from ${JSON.stringify(attestorUrl)};
import fs from "node:fs";
const events = fs.readFileSync(${JSON.stringify(fx.ledgerPath.replace(/\\/g, "/"))}, "utf8").split("\\n").filter(Boolean).map((l) => JSON.parse(l));
const rel = events.find((e) => e.type === "ReleasePublished");
const ctx = buildAttestorTimeCtx(events);
const r = checkSignatureChain(rel, ctx);
assert.equal(r.result, "fail", "attestor must reject the stripped+revoked key: " + JSON.stringify(r));
assert.equal(r.code, "key-time-invalid", "rejection is the key-window gate: " + JSON.stringify(r));
// Either compromise rejection rung is correct: the provable-post-C boundary OR (if the anchor's
// trusted close-time were refused) the provability demand. Both prove the stripped key was
// re-revoked from the SIGNED event — never re-grandfathered.
assert.match(r.reason || "", /compromise invalidity date|provable \\(anchored\\) signature time/, "reason: " + JSON.stringify(r));
console.log("ATTESTOR_REJECTED " + r.code + " :: " + (/compromise invalidity date/.test(r.reason) ? "post-C-boundary" : "provability"));
`;
    const out = runDriver(driver, fx, {
      // Point the attestor's NODES at our stripped tree. ROOT stays the real repo so the LIVE
      // trustedAttestors (containing REAL_ANCHOR) governs the rung-2 gate.
      REPOMESH_NODES_PATH: fx.nodesDir,
    });
    assert.match(out, /ATTESTOR_REJECTED key-time-invalid/, out);
  });

  // ---------------------------------------------------------------------------------------------
  // LAYER 4 — packages/repomesh-cli computeVerifyResult (site 8). Local/offline mode.
  // Uses the UNPROVABLE mechanism (the offline CLI anchor lookup needs a Merkle manifest on disk;
  // the compromise-unprovable branch rejects without one and is the realistic mirror/cache threat).
  // ---------------------------------------------------------------------------------------------
  it("LAYER cli verify-release: STRIPPED node.json + signed revocation + unprovable self-time < C => status FAIL", async () => {
    const nodes = strippedNodes();
    const rel = sign(release({ keyId: "rel-key", timestamp: PRE_SELF }), "rel-key", RK.privateKey);
    const revoke = sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);
    const fx = stageFixture({ events: [rel, revoke], nodes });
    process.env.REPOMESH_FORCE_OFFLINE = "1";
    try {
      const { result, status } = await computeVerifyResult({
        repo: RELEASE, version: "1.0.0", local: true, localDir: fx.dir,
        preloadedEvents: [rel, revoke],
      });
      assert.equal(status, "FAIL",
        "CLI must FAIL a compromise-revoked key whose node.json window was stripped (signed event re-imposes it)");
      const reasons = JSON.stringify(result.gate?.failures || result.release || result);
      assert.match(reasons, /signature|key/i, "the FAIL is attributed to the signature/key gate: " + reasons);
    } finally {
      delete process.env.REPOMESH_FORCE_OFFLINE;
    }
  });

  it("LAYER cli verify-release CONTROL: WITHOUT the signed revocation, the stripped key grandfathers (status NOT FAIL)", async () => {
    const nodes = strippedNodes();
    const rel = sign(release({ keyId: "rel-key", timestamp: PRE_SELF }), "rel-key", RK.privateKey);
    const fx = stageFixture({ events: [rel], nodes });
    process.env.REPOMESH_FORCE_OFFLINE = "1";
    try {
      const { status } = await computeVerifyResult({
        repo: RELEASE, version: "1.0.0", local: true, localDir: fx.dir,
        preloadedEvents: [rel],
      });
      assert.notEqual(status, "FAIL",
        "with no signed key event a window-less key grandfathers => the signature gate passes (byte-identical to today)");
    } finally {
      delete process.env.REPOMESH_FORCE_OFFLINE;
    }
  });

  // ---------------------------------------------------------------------------------------------
  // LAYER 5 — tools/verify-release.mjs (sites 6/7). SUBPROCESS, asserts exit code != 0.
  // ---------------------------------------------------------------------------------------------
  it("LAYER tools verify-release: STRIPPED node.json + signed revocation + unprovable self-time < C => signature REJECTED (subprocess)", () => {
    // The discriminator at the tools layer is release.signatureValid (the key-window gate result),
    // NOT the process exit code — an unattested release exits non-zero on the UNVERIFIED attestation
    // gate even when the signature is valid. We assert the SIGNATURE gate itself rejected.
    const nodes = strippedNodes();
    const rel = sign(release({ keyId: "rel-key", timestamp: PRE_SELF }), "rel-key", RK.privateKey);
    const revoke = sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);
    const fx = stageFixture({ events: [rel, revoke], nodes });
    const { json } = runVerifyReleaseCli(fx);
    assert.equal(json.release?.signatureValid, false,
      "tools/verify-release must REJECT the signature when the stripped key is re-revoked by the signed ledger event");
    assert.match(String(json.release?.signatureReason || ""), /keyId=rel-key|no maintainer|not valid/i,
      "the rejection carries the no-key / key-window reason: " + JSON.stringify(json.release));
  });

  it("LAYER tools verify-release CONTROL: WITHOUT the signed revocation, the stripped key grandfathers (signature VALID)", () => {
    // Same stripped node.json, but no signed KeyRevocation => no constraint to derive => the key
    // grandfathers and the SIGNATURE gate passes (signatureValid:true). The overall verdict may
    // still be UNVERIFIED on the unrelated attestation gate — that is byte-identical to today.
    const nodes = strippedNodes();
    const rel = sign(release({ keyId: "rel-key", timestamp: PRE_SELF }), "rel-key", RK.privateKey);
    const fx = stageFixture({ events: [rel], nodes });
    const { json } = runVerifyReleaseCli(fx);
    assert.equal(json.release?.signatureValid, true,
      "with no signed key event the stripped (window-less) key grandfathers => signature VALID (byte-identical to today)");
    assert.equal(json.release?.signerNode, RELEASE, "the grandfathered key resolves to its own repo");
  });
});

// ==============================================================================================
// ROTATION-PREEMPT (§12.3) — proven at the shared predicate (the one place the decision lives).
// A self-issued KeyRotation cannot shield a compromised key from a later authorized compromise
// revocation, because mergeStricterWindow makes 'compromise' DOMINATE 'rotation'.
// ==============================================================================================
describe("Wave-B2 COMPOSED — rotation-preempt: compromise DOMINATES a prior self-issued rotation (§12.3)", () => {
  it("self-rotation(future) THEN authorized compromise(invalidAfter=C) => post-C REJECTED, pre-C survives", () => {
    const nodes = strippedNodes();
    // Attacker self-signs a rotation for their OWN compromised key with effectiveAt FAR future,
    // hoping the prospective 'rotation' window keeps post-compromise signatures valid.
    const rotation = sign({
      type: "KeyRotation", repo: RELEASE, timestamp: "2026-06-01T00:00:00.000Z",
      key: { action: "rotate", retiringKeyId: "rel-key", newKeyId: "rel-key-new",
        newPublicKey: NK.publicKey.trim(), effectiveAt: "2099-01-01T00:00:00.000Z" },
    }, "rel-key", RK.privateKey); // self-signed by the retiring key (rotation may be self-signed, §4.1)
    // A later AUTHORIZED compromise revocation (surviving same-node signer).
    const compromise = sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);

    const verifyAndAuthorize = makeVerifyAndAuthorize(nodes);
    // Pre-§13.1 order-insensitive derivation (the rotate/revoke FOLD is what this asserts, isolated from
    // the order-aware authorization) — reached via the explicit test-only export, not the production fn.
    const map = __deriveLegacyForTests([rotation, compromise], RELEASE, { verifyAndAuthorize });
    const c = map.get("rel-key");
    assert.ok(c, "a constraint was derived for the compromised key");
    assert.equal(c.revocationReason, "compromise", "compromise DOMINATES the prior rotation reason in the fold");

    // Merge with the (stripped) node.json maintainer and run the predicate at three times.
    const stripped = { keyId: "rel-key", publicKey: RK.publicKey.trim() };
    const eff = mergeStricterWindow(stripped, c);

    const postC = isKeyValidForSignature(eff, { time: new Date(POST_C), provable: true, source: "anchor-event" });
    assert.equal(postC.valid, false, "post-C signature rejected despite the future-dated rotation");
    assert.match(postC.reason, /compromise invalidity date/);

    const preC = isKeyValidForSignature(eff, { time: new Date("2026-06-17T00:00:00.000Z"), provable: true, source: "anchor-event" });
    assert.equal(preC.valid, true, "a provably-pre-C signature survives (compromise is not retroactive)");

    const unprovable = isKeyValidForSignature(eff, { time: new Date("2026-06-17T00:00:00.000Z"), provable: false, source: "self" });
    assert.equal(unprovable.valid, false, "an unprovable pre-C signature on the compromised key is rejected");
  });

  it("the self-rotation alone (no compromise) would have kept a pre-effectiveAt signature valid — proving the rotation IS preemptive absent the revocation", () => {
    // Control: with ONLY the self-rotation (effectiveAt 2099), a 2026 signature is BEFORE validUntil
    // => valid. This is what the attacker hoped to exploit; the compromise fold above defeats it.
    const nodes = strippedNodes();
    const rotation = sign({
      type: "KeyRotation", repo: RELEASE, timestamp: "2026-06-01T00:00:00.000Z",
      key: { action: "rotate", retiringKeyId: "rel-key", newKeyId: "rel-key-new",
        newPublicKey: NK.publicKey.trim(), effectiveAt: "2099-01-01T00:00:00.000Z" },
    }, "rel-key", RK.privateKey);
    const verifyAndAuthorize = makeVerifyAndAuthorize(nodes);
    const c = __deriveLegacyForTests([rotation], RELEASE, { verifyAndAuthorize }).get("rel-key");
    const eff = mergeStricterWindow({ keyId: "rel-key", publicKey: RK.publicKey.trim() }, c);
    const sig2026 = isKeyValidForSignature(eff, { time: new Date(POST_C), provable: false, source: "self" });
    assert.equal(sig2026.valid, true, "rotation-only keeps a pre-2099 signature valid — so the compromise dominance is load-bearing");
  });
});

// ==============================================================================================
// FAIL-CLOSED (§12.2) — a windowed key with a revocation intent but NO resolvable boundary date
// is REJECTED, not valid. Proven at the predicate (binds every importing layer).
// ==============================================================================================
describe("Wave-B2 COMPOSED — fail-closed: windowed revocation intent w/o a resolvable boundary => REJECTED (§12.2)", () => {
  const tt = { time: new Date(PRE_SELF), provable: true, source: "anchor-event" };

  it("revocationReason set but revokedAt/invalidAfter/validUntil all absent => REJECTED", () => {
    const m = { keyId: "k", publicKey: "PK", revocationReason: "compromise" };
    assert.equal(keyWindow(m).isWindowed, true, "a lone revocationReason makes the key windowed (not grandfathered)");
    const dec = isKeyValidForSignature(m, tt);
    assert.equal(dec.valid, false, "a revocation intent without a usable boundary must fail closed");
    assert.match(dec.reason, /revocation intent without a resolvable boundary date/);
  });

  it("revocationReason set with an UNPARSEABLE revokedAt (no other boundary) => REJECTED", () => {
    const m = { keyId: "k", publicKey: "PK", revocationReason: "compromise", revokedAt: "not-a-date" };
    assert.equal(keyWindow(m).revokedAt, null, "the unparseable date normalizes to null");
    const dec = isKeyValidForSignature(m, tt);
    assert.equal(dec.valid, false, "an unparseable boundary is no boundary => fail closed");
    assert.match(dec.reason, /resolvable boundary date/);
  });

  it("a raw revokedAt field present but unparseable, NO reason => still REJECTED (raw-field intent)", () => {
    const m = { keyId: "k", publicKey: "PK", revokedAt: "" , invalidAfter: "garbage" };
    // revokedAt:"" is treated as absent by keyWindow's hasField; invalidAfter:"garbage" is the
    // raw intent that normalizes to null => fail closed.
    const dec = isKeyValidForSignature(m, tt);
    assert.equal(dec.valid, false, "a present-but-unparseable invalidAfter is a revocation intent without a boundary => rejected");
    assert.match(dec.reason, /resolvable boundary date/);
  });

  it("GRANDFATHER unaffected: a window-less key is NOT subject to fail-closed (stays valid)", () => {
    const m = { keyId: "k", publicKey: "PK" };
    assert.equal(keyWindow(m).isWindowed, false);
    const dec = isKeyValidForSignature(m, tt);
    assert.equal(dec.valid, true, "grandfather (no window fields) is byte-identical to today");
  });
});

// ==============================================================================================
// MERGE IS RESTRICTION-ONLY — a tampered node.json cannot LOOSEN what the signed events assert.
// Inspect mergeStricterWindow directly: every axis takes the stricter side; a node.json trying to
// widen a window is overruled by the derived constraint.
// ==============================================================================================
describe("Wave-B2 COMPOSED — mergeStricterWindow only ever ADDS restriction (§12.1)", () => {
  it("node.json with a LATER (looser) invalidAfter cannot push the boundary past the signed event's earlier one", () => {
    // node.json claims the compromise boundary is far in the future (loosening); the signed event
    // says C. mergeStricterWindow must keep the EARLIER (stricter) C.
    const m = { keyId: "k", publicKey: "PK", revokedAt: "2099-01-01T00:00:00.000Z",
      revocationReason: "compromise", invalidAfter: "2099-01-01T00:00:00.000Z" };
    const constraint = { revokedAt: new Date(C), revocationReason: "compromise", invalidAfter: new Date(C) };
    const eff = mergeStricterWindow(m, constraint);
    assert.equal(new Date(eff.invalidAfter).toISOString(), new Date(C).toISOString(),
      "invalidAfter = min(node.json, derived) => the earlier signed boundary wins");
    // A signature provably after C is now rejected (the node.json's 2099 loosening did NOT take).
    const dec = isKeyValidForSignature(eff, { time: new Date(POST_C), provable: true, source: "anchor-event" });
    assert.equal(dec.valid, false, "the loosened node.json cannot move the boundary later");
  });

  it("node.json reason 'rotation' cannot downgrade a signed 'compromise' (compromise dominates)", () => {
    const m = { keyId: "k", publicKey: "PK", revokedAt: C, revocationReason: "rotation" };
    const constraint = { revokedAt: new Date(C), revocationReason: "compromise", invalidAfter: new Date(C) };
    const eff = mergeStricterWindow(m, constraint);
    assert.equal(eff.revocationReason, "compromise", "node.json 'rotation' is overruled by the signed 'compromise'");
    // Under the merged compromise, an unprovable pre-boundary signature is rejected (a plain
    // rotation would have ACCEPTED it) — proving the reason upgrade is load-bearing.
    const dec = isKeyValidForSignature(eff, { time: new Date("2026-06-10T00:00:00.000Z"), provable: false, source: "self" });
    assert.equal(dec.valid, false, "compromise demands provability where rotation would have trusted self-time");
  });

  it("node.json with a STRICTER (earlier) bound than the event is preserved (merge never loosens the node.json either)", () => {
    // Symmetry: if node.json is the stricter side, the merge keeps node.json's bound. Restriction
    // is monotone from BOTH inputs — the result is the intersection-of-restrictions.
    const m = { keyId: "k", publicKey: "PK", revokedAt: "2026-06-10T00:00:00.000Z", revocationReason: "compromise", invalidAfter: "2026-06-10T00:00:00.000Z" };
    const constraint = { revokedAt: new Date(C), revocationReason: "compromise", invalidAfter: new Date(C) };
    const eff = mergeStricterWindow(m, constraint);
    assert.equal(new Date(eff.invalidAfter).toISOString(), "2026-06-10T00:00:00.000Z",
      "the earlier (node.json) boundary is the stricter one and is kept");
  });

  it("grandfather-safe identity: mergeStricterWindow(m, undefined) === m and mergeStricterWindow(m, null) === m", () => {
    const m = { keyId: "k", publicKey: "PK" };
    assert.equal(mergeStricterWindow(m, undefined), m, "undefined constraint returns the SAME object (===)");
    assert.equal(mergeStricterWindow(m, null), m, "null constraint returns the SAME object (===)");
  });
});

// ---- subprocess helpers ----------------------------------------------------------------------
// Run a small ESM driver string in a fresh node process with the given env, against the fixture.
function runDriver(driverSrc, fx, extraEnv) {
  const driverPath = path.join(fx.dir, "driver.mjs");
  fs.writeFileSync(driverPath, driverSrc, "utf8");
  return execFileSync(process.execPath, [driverPath], {
    cwd: REPO_ROOT,
    env: { ...process.env, REPOMESH_FORCE_OFFLINE: "1", ...extraEnv },
    encoding: "utf8",
  });
}

// Drive tools/verify-release.mjs as the real CLI does (via its exported verifyRelease, which
// process.exit()s), pointing it at the fixture through env vars. Captures the exit code AND the
// parsed JSON result. tools/verify-release exits non-zero whenever the overall verdict is not
// VERIFIED (e.g. UNVERIFIED on the attestation gate) — so the KEY-WINDOW discriminator is
// result.release.signatureValid, parsed from the --json output, NOT the exit code.
function runVerifyReleaseCli(fx) {
  const cliPath = path.join(REPO_ROOT, "tools", "verify-release.mjs");
  const driverPath = path.join(fx.dir, "tools-driver.mjs");
  const cliUrl = pathToFileURL(cliPath).href;
  fs.writeFileSync(driverPath, `
import { verifyRelease } from ${JSON.stringify(cliUrl)};
await verifyRelease({ repo: ${JSON.stringify(RELEASE)}, version: "1.0.0", anchored: false, anchoredOrLocal: false, json: true });
`, "utf8");
  const env = {
    ...process.env,
    REPOMESH_FORCE_OFFLINE: "1",
    REPOMESH_ROOT: fx.dir,
    REPOMESH_LEDGER_PATH: fx.ledgerPath,
    REPOMESH_NODES_PATH: fx.nodesDir,
    REPOMESH_VERIFIER_POLICY_PATH: fx.policyPath,
  };
  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, [driverPath], {
      cwd: REPO_ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    code = e.status ?? 1;
    stdout = e.stdout || "";
    stderr = e.stderr || "";
  }
  // The JSON result is the last balanced JSON object printed to stdout.
  let json = null;
  const objStart = stdout.lastIndexOf("\n{");
  const candidate = objStart >= 0 ? stdout.slice(objStart + 1) : stdout.trim();
  try { json = JSON.parse(candidate); }
  catch {
    const m = stdout.match(/\{[\s\S]*\}\s*$/);
    if (m) { try { json = JSON.parse(m[0]); } catch { /* leave null */ } }
  }
  return { code, json: json || {}, output: stdout + stderr };
}
