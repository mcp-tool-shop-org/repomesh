// Registry domain — key-lifecycle window enforcement in build-trust (contract §5.3, sites 1/2/11).
//
// THE LIVE BUG (key-lifecycle-contract §1): build-trust's key resolution did an UNTIMED
// `maintainers.find(m => m.keyId === keyId)` and returned the key with ZERO time check. A
// compromise-revoked-but-still-listed key therefore scored full integrity and verified VALID.
//
// This file is the build-trust regression for the predicate from verifiers/lib/key-window.mjs:
//   1. GRANDFATHER — a maintainer with no window fields verifies byte-identically to today.
//   2. COMPROMISE rejects post-invalidity — a revoked(compromise,invalidAfter=C) key whose signature
//      is PROVABLY anchored at/after C is dropped (not scored).
//   3. COMPROMISE keeps provably-old — the SAME key, signature provably anchored < C, still scores.
//   4. ROTATION is prospective — validUntil/reason:rotation drops at/after R, keeps before R.
//   5. SITE 11 (dispute path) — a compromise-revoked attestor's dispute is dropped (never downgrades).
//
// The window state lives on node.json maintainer fields (the contract's read surface, §6); the
// "trusted time" for an event comes from the OFFLINE anchor ladder (resolveTrustedSignatureTimeSync):
// an `AttestationPublished` carrying a `ledger.anchor` whose partition `range` covers the event's
// signature.canonicalHash supplies a provable upper-bound time. We anchor events here exactly the way
// the live ledger does (notes carry a trailing JSON block with `range` + `txHash`).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeForHash } from "../../ledger/scripts/canonicalize.mjs";
import { buildTrust } from "../scripts/build-trust.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// --- crypto + event helpers (mirror the validator/ledger canonicalization exactly) -------------
function genKeyPair() {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
function canonicalHash(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.signature;
  return crypto.createHash("sha256").update(canonicalizeForHash(copy), "utf8").digest("hex");
}
function sign(ev, keyId, privateKey) {
  const unsigned = { ...ev };
  delete unsigned.signature;
  const hash = canonicalHash(unsigned);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  return { ...unsigned, signature: { alg: "ed25519", keyId, value: sig.toString("base64"), canonicalHash: hash } };
}

const RELEASE = "test-org/test-repo";
const ATTESTOR = "test-org/attestor";   // a trusted attestor (used for the anchor + the dispute)
const ANCHOR = "test-org/anchor";       // the trusted anchor node (publishes ledger.anchor)

// A ReleasePublished signed by the RELEASE repo's maintainer key (`keyId`).
function release(keyId, over = {}) {
  return {
    type: "ReleasePublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T00:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/b.js" }],
    attestations: [], ...over,
  };
}

// An anchor AttestationPublished whose partition `range` covers `leafHash`, timestamped `ts`.
// Mirrors the live ledger: attestations[].type === "ledger.anchor", notes carry a trailing JSON
// block with partitionId/range/merkleRoot/txHash/network. The signature.canonicalHash of THIS
// anchor event is its own leaf; the COVERED leaf is in the JSON `range`.
function anchorFor(leafHash, ts, over = {}) {
  const meta = {
    txHash: "DEADBEEF".repeat(8),
    network: "testnet",
    walletAddress: "rTestWallet",
    partitionId: "p1",
    merkleRoot: "f".repeat(64),
    eventCount: 1,
    // The covered leaf sits inside [range[0], range[1]] (lexicographic, like the live anchors).
    range: [leafHash, leafHash],
  };
  return {
    type: "AttestationPublished", repo: ANCHOR, version: "0.0.0-genesis", commit: "0000000",
    timestamp: ts,
    artifacts: [{ name: "anchor.json", sha256: "f".repeat(64), uri: "https://x/anchor.json" }],
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:DEADBEEF" }],
    notes: "ledger.anchor: pass — Partition anchored to XRPL testnet\n" + JSON.stringify(meta),
    ...over,
  };
}

// A dispute (site 11): an AttestationPublished carrying attestation.dispute against the release.
function dispute(over = {}) {
  return {
    type: "AttestationPublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-20T00:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/b.js" }],
    attestations: [{ type: "attestation.dispute", uri: "repomesh:dispute:integrity" }],
    notes: `attestation.dispute against released artifact disputed:${"b".repeat(64)} — forged`,
    ...over,
  };
}

// A KeyRevocation(compromise) for the RELEASE repo's `revokedKeyId` (contract §4.2 envelope). The
// key-family event carries no version/commit/artifacts (§3.2). It is signed by a SURVIVING same-node
// maintainer key (!= revokedKeyId, itself valid) per §4.2 authorization — the test signs it with
// `rel-key-2`. This is the SIGNED authorization that re-imposes the window even if node.json strips it.
function keyRevocation(revokedKeyId, invalidAfter, over = {}) {
  return {
    type: "KeyRevocation", repo: RELEASE,
    timestamp: "2026-06-18T00:00:00.000Z",
    key: { action: "revoke", revokedKeyId, reason: "compromise", invalidAfter },
    ...over,
  };
}

// A KeyRotation retiringKeyId->newKeyId for the RELEASE repo (contract §4.1 envelope). The key-family
// event carries no version/commit/artifacts (§3.2). Per §4.1 the authorized signer is the RETIRING key
// itself (possession). `effectiveAt`/`timestamp` default to the same instant the live emitter uses.
function keyRotation(retiringKeyId, newKeyId, newPublicKey, effectiveAt, over = {}) {
  return {
    type: "KeyRotation", repo: RELEASE,
    timestamp: effectiveAt,
    key: { action: "rotate", retiringKeyId, newKeyId, newPublicKey: newPublicKey.trim(), effectiveAt },
    ...over,
  };
}

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

let RK, AK, NK, SK, BK; // release / attestor / anchor / surviving-same-node / rotated-to (K_b) keys
before(() => { RK = genKeyPair(); AK = genKeyPair(); NK = genKeyPair(); SK = genKeyPair(); BK = genKeyPair(); });

// Build a sandbox: nodes tree (with per-node maintainer windows) + events.jsonl + policy.
// policyOver lets a test override the verifier policy (e.g. drop RELEASE from trustedPolicy so a
// same-node key is NOT a governance-floor signer). Default preserves the original policy exactly.
function sandbox(events, nodes, policyOver = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-keywin-"));
  const nodesDir = path.join(dir, "nodes");
  const profilesDir = path.join(dir, "profiles");
  const registryDir = path.join(dir, "registry");
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
    trustedAttestors: [ATTESTOR, ANCHOR, RELEASE],
    trustedPolicy: [RELEASE],
    checks: {},
    ...policyOver,
  }, null, 2));
  const ledgerPath = path.join(dir, "events.jsonl");
  fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return {
    run() {
      return buildTrust({ ledgerPath, nodesDir, profilesDir, registryDir, policyPath, write: false });
    },
  };
}
const entryFor = (out, repo = RELEASE, version = "1.0.0") =>
  out.find((e) => e.repo === repo && e.version === version);

// Shared node set: the anchor node (its key must be windowless/valid), plus a release node whose
// maintainer window is the variable under test.
function nodesWith(releaseMaintainer) {
  return [
    nodeManifest(RELEASE, "registry", [releaseMaintainer]),
    nodeManifest(ANCHOR, "attestor", [maintainer("anchor-key", NK.publicKey)]),
    nodeManifest(ATTESTOR, "attestor", [maintainer("att-key", AK.publicKey)]),
  ];
}

describe("key-window enforcement in build-trust (contract §5.3, sites 1/2/11)", () => {
  // ---- 1. GRANDFATHER: a maintainer with NO window fields is byte-identical to today --------
  it("GRANDFATHER: a windowless maintainer key still scores (today's behavior)", () => {
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const nodes = nodesWith(maintainer("rel-key", RK.publicKey)); // no window fields
    const e = entryFor(sandbox([rel], nodes).run());
    assert.ok(e, "windowless (grandfathered) key MUST verify and score, unchanged from today");
    assert.equal(e.integrityScore, 45, "grandfather integrity = signed(15)+artifacts(15)+noPolicy(15)");
  });

  // ---- 2. COMPROMISE rejects post-invalidity (provably anchored at/after C) -----------------
  it("COMPROMISE: a release provably anchored AT/AFTER invalidAfter is REJECTED (not scored)", () => {
    // Release self-timestamp is backdated (2026-03-01), but the anchor proves the leaf existed by
    // 2026-06-20 — at/after invalidAfter C=2026-06-18 → REJECTED.
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const anchor = sign(anchorFor(rel.signature.canonicalHash, "2026-06-20T00:00:00.000Z"),
      "anchor-key", NK.privateKey);
    const nodes = nodesWith(maintainer("rel-key", RK.publicKey, {
      revokedAt: "2026-06-18T00:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: "2026-06-18T00:00:00.000Z",
    }));
    const out = sandbox([rel, anchor], nodes).run();
    assert.ok(!entryFor(out), "compromise-revoked key with provable post-invalidity time must NOT score");
  });

  // ---- 3. COMPROMISE keeps provably-old (same key, provably anchored < C) -------------------
  it("COMPROMISE: the SAME key with a signature provably anchored BEFORE invalidAfter still scores", () => {
    // SAME compromise window; this time the anchor proves the leaf existed by 2026-06-10 (< C) →
    // a provably-old signature is NOT retroactively killed by a later compromise.
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const anchor = sign(anchorFor(rel.signature.canonicalHash, "2026-06-10T00:00:00.000Z"),
      "anchor-key", NK.privateKey);
    const nodes = nodesWith(maintainer("rel-key", RK.publicKey, {
      revokedAt: "2026-06-18T00:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: "2026-06-18T00:00:00.000Z",
    }));
    const e = entryFor(sandbox([rel, anchor], nodes).run());
    assert.ok(e, "a provably-pre-invalidity signature of a compromised key MUST still score");
    assert.equal(e.integrityScore, 45, "provably-old release scores normally");
  });

  // ---- 3b. COMPROMISE rejects UNPROVABLE (self-timestamp only) ------------------------------
  it("COMPROMISE: an UNANCHORED release (self-time only) is REJECTED even when its self-time < C", () => {
    // No anchor event → only the self-asserted (backdated) timestamp is available (provable:false).
    // A compromised key demands a PROVABLE pre-invalidity time → REJECTED.
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey); // self ts 2026-03-01 < C
    const nodes = nodesWith(maintainer("rel-key", RK.publicKey, {
      revokedAt: "2026-06-18T00:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: "2026-06-18T00:00:00.000Z",
    }));
    const out = sandbox([rel], nodes).run();
    assert.ok(!entryFor(out), "compromised key with only a self-asserted (unprovable) time must NOT score");
  });

  // ---- 4. ROUTINE ROTATION: prospective only -----------------------------------------------
  it("ROTATION: a release whose trusted time is BEFORE validUntil still scores (prospective)", () => {
    // Rotation is prospective: past signatures stay valid. The self-time 2026-03-01 is before the
    // rotation R=2026-06-15; rotation trusts the self time (no anchor needed) → scores.
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const nodes = nodesWith(maintainer("rel-key", RK.publicKey, {
      validUntil: "2026-06-15T00:00:00.000Z",
      revokedAt: "2026-06-15T00:00:00.000Z",
      revocationReason: "rotation",
    }));
    const e = entryFor(sandbox([rel], nodes).run());
    assert.ok(e, "a rotated-out key's PRE-rotation signature must still score");
    assert.equal(e.integrityScore, 45);
  });

  it("ROTATION: a release whose trusted time is AT/AFTER validUntil is REJECTED", () => {
    // Self time pushed to 2026-06-20 (>= R). Rotation drops it (rotated out of validity).
    const rel = sign(release("rel-key", { timestamp: "2026-06-20T00:00:00.000Z" }),
      "rel-key", RK.privateKey);
    const nodes = nodesWith(maintainer("rel-key", RK.publicKey, {
      validUntil: "2026-06-15T00:00:00.000Z",
      revokedAt: "2026-06-15T00:00:00.000Z",
      revocationReason: "rotation",
    }));
    const out = sandbox([rel], nodes).run();
    assert.ok(!entryFor(out), "a post-rotation signature of a rotated-out key must NOT score");
  });

  // ---- 5. SITE 11 (dispute path): a compromise-revoked attestor's dispute is dropped --------
  it("SITE 11: a dispute signed by a compromise-revoked attestor key is DROPPED (no downgrade)", () => {
    // The release is clean and scores. A dispute is then signed by the attestor's key — but that
    // attestor key is compromise-revoked with an invalidAfter BEFORE the dispute is provably
    // anchored. verifyEventSignature (site 11) must reject the dispute event → no DISPUTED downgrade.
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const disp = sign(dispute(), "att-key", AK.privateKey);
    // Anchor the dispute's leaf at a time at/after the attestor key's invalidAfter → dispute dropped.
    const anchor = sign(anchorFor(disp.signature.canonicalHash, "2026-06-20T00:00:00.000Z"),
      "anchor-key", NK.privateKey);
    const nodes = [
      nodeManifest(RELEASE, "registry", [maintainer("rel-key", RK.publicKey)]),
      nodeManifest(ANCHOR, "attestor", [maintainer("anchor-key", NK.publicKey)]),
      nodeManifest(ATTESTOR, "attestor", [maintainer("att-key", AK.publicKey, {
        revokedAt: "2026-06-18T00:00:00.000Z",
        revocationReason: "compromise",
        invalidAfter: "2026-06-18T00:00:00.000Z",
      })]),
    ];
    const e = entryFor(sandbox([rel, disp, anchor], nodes).run());
    assert.ok(e, "the release itself (windowless key) still scores");
    assert.equal(e.disputed, false, "a dispute from a compromise-revoked key MUST be dropped → no downgrade");
    assert.notEqual(e.verdict, "DISPUTED", "no DISPUTED verdict from a rejected dispute");
  });

  it("SITE 11 control: the SAME dispute from a VALID (windowless) attestor key DOES downgrade", () => {
    // Proves the dispute machinery is reachable: with no window on the attestor key, the dispute
    // verifies and downgrades — so test 5's non-downgrade is caused by the window, not a dead path.
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const disp = sign(dispute(), "att-key", AK.privateKey);
    const nodes = nodesWith(maintainer("rel-key", RK.publicKey));
    const e = entryFor(sandbox([rel, disp], nodes).run());
    assert.ok(e, "release scored");
    assert.equal(e.disputed, true, "a valid attestor's dispute MUST downgrade (machinery is live)");
    assert.equal(e.verdict, "DISPUTED");
  });

  // ---- 6. node.json-STRIP bypass (contract §12.1, Finding ①) --------------------------------
  // Verifiers read window state from node.json and do NOT run the ledger binding check, so a
  // tampered node.json that STRIPS a revoked key's window fields re-grandfathers it
  // (isWindowed=false => VALID). The §12.1 fix derives the window from the SIGNED KeyRevocation
  // event that REMAINS in the ledger and merges in the STRICTER, so the strip cannot loosen.
  //
  // RED on post-Wave-B code: build-trust there applies the predicate to the (stripped) node.json
  // maintainer only — grandfather => VALID => the compromised release scores. GREEN after the
  // derive-stricter wrap re-imposes the compromise window from the event.
  it("node.json-STRIP: a compromise-revoked release whose node.json window is STRIPPED is STILL rejected (derive-stricter)", () => {
    const C = "2026-06-18T00:00:00.000Z";
    // Release signed by the compromised key, provably anchored AT/AFTER C (post-compromise).
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const anchor = sign(anchorFor(rel.signature.canonicalHash, "2026-06-20T00:00:00.000Z"),
      "anchor-key", NK.privateKey);
    // The SIGNED authorization that survives in the ledger. Signed by a SURVIVING same-node key
    // (rel-key-2 != rel-key, itself windowless/valid) — §4.2 authorized.
    const revoke = sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);
    // node.json has the window fields STRIPPED off rel-key (re-grandfathered) — the tamper.
    const nodes = [
      nodeManifest(RELEASE, "registry", [
        maintainer("rel-key", RK.publicKey),       // NO window fields (stripped)
        maintainer("rel-key-2", SK.publicKey),     // surviving same-node signer of the revocation
      ]),
      nodeManifest(ANCHOR, "attestor", [maintainer("anchor-key", NK.publicKey)]),
      nodeManifest(ATTESTOR, "attestor", [maintainer("att-key", AK.publicKey)]),
    ];
    const out = sandbox([rel, anchor, revoke], nodes).run();
    assert.ok(!entryFor(out),
      "a compromise-revoked key STILL rejects post-compromise signatures even when node.json strips the window (signed event re-imposes it)");
  });

  it("node.json-STRIP control: WITHOUT the signed KeyRevocation in the ledger, the stripped key grandfathers (proves the derive path is what rejects)", () => {
    // SAME stripped node.json + SAME post-compromise anchor — but NO KeyRevocation event. With no
    // signed authorization in the ledger, there is no constraint to derive, so the key grandfathers
    // and scores. This proves the rejection in test 6 comes from the derived signed-event window,
    // not from some unrelated path, and that grandfather stays byte-identical with no key events.
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const anchor = sign(anchorFor(rel.signature.canonicalHash, "2026-06-20T00:00:00.000Z"),
      "anchor-key", NK.privateKey);
    const nodes = [
      nodeManifest(RELEASE, "registry", [
        maintainer("rel-key", RK.publicKey),       // stripped — and no event re-imposes the window
        maintainer("rel-key-2", SK.publicKey),
      ]),
      nodeManifest(ANCHOR, "attestor", [maintainer("anchor-key", NK.publicKey)]),
      nodeManifest(ATTESTOR, "attestor", [maintainer("att-key", AK.publicKey)]),
    ];
    const e = entryFor(sandbox([rel, anchor], nodes).run());
    assert.ok(e, "with no signed key event, a window-less maintainer grandfathers (byte-identical to today)");
    assert.equal(e.integrityScore, 45, "grandfather scores normally");
  });

  it("node.json-STRIP: an UNAUTHORIZED (self-signed by the compromised key) KeyRevocation does NOT re-impose the window", () => {
    // A KeyRevocation signed by the REVOKED key itself is NOT §4.2-authorized (the signer must be a
    // surviving DIFFERENT key or a trustedPolicy node). An unauthorized event must contribute NOTHING
    // (fail-closed). With node.json also stripped AND RELEASE removed from trustedPolicy (so the
    // same-node key is NOT a governance-floor signer either), there is no window from anywhere → the
    // key grandfathers. This guards the fail-closed authorization gate: a compromised key cannot
    // self-issue a window that the derive path would honor.
    const rel = sign(release("rel-key"), "rel-key", RK.privateKey);
    const anchor = sign(anchorFor(rel.signature.canonicalHash, "2026-06-20T00:00:00.000Z"),
      "anchor-key", NK.privateKey);
    // Self-signed by rel-key (the revoked key) — unauthorized per §4.2.
    const selfRevoke = sign(keyRevocation("rel-key", "2026-06-18T00:00:00.000Z"), "rel-key", RK.privateKey);
    const nodes = [
      nodeManifest(RELEASE, "registry", [maintainer("rel-key", RK.publicKey)]),
      nodeManifest(ANCHOR, "attestor", [maintainer("anchor-key", NK.publicKey)]),
      nodeManifest(ATTESTOR, "attestor", [maintainer("att-key", AK.publicKey)]),
    ];
    // RELEASE is NOT a trustedPolicy node here → its own key cannot authorize a revocation via the
    // governance floor, so the self-signed event is genuinely unauthorized.
    const e = entryFor(sandbox([rel, anchor, selfRevoke], nodes, { trustedPolicy: [] }).run());
    assert.ok(e, "a self-signed (unauthorized) KeyRevocation must NOT re-impose a window — fail-closed derivation grandfathers the key");
    assert.equal(e.integrityScore, 45);
  });
});

// ---- 7. Residual ③ — order-aware authorization sub-path (contract §13.1) -----------------------
//
// THE WAVE-B3 BUG (§13.1 Finding ③): Wave-B2 derive-stricter protected the MAIN resolution path, but
// the AUTHORIZATION sub-check (is a KeyRotation's *signer* currently valid?) validated the signer
// against node.json ALONE. Exploit: K_a is compromise-revoked by an EARLIER signed KeyRevocation
// (authorized by a surviving key). The attacker serves a node.json that STRIPS K_a's window
// (re-grandfathered there). The MAIN path still rejects K_a's OWN releases (Wave-B2 ① holds, derived
// from the signed event). BUT the legacy authorization saw K_a "valid" in the stripped node.json and
// AUTHORIZED a LATER `KeyRotation K_a→K_b` on possession alone → minted a FRESH derived `validFrom`
// window on K_b → trust re-established via rotation.
//
// THE FIX (§13.1): deriveKeyWindowConstraints is an ORDER-AWARE single forward pass; an event's signer
// must be VALID at the event's trusted time per derive-stricter against the window state from
// STRICTLY-EARLIER events. Because the revocation of K_a precedes the rotation in ledger order, K_a is
// INVALID at the rotation's effectiveAt → the rotation is UNAUTHORIZED → K_b receives NO derived window.
//
// Build-trust OBSERVABLE: build-trust resolves a release key from node.json and derive-stricter only
// ever ADDS restriction (§13.2 inherent boundary — a brand-new attacker-added key in a tampered
// node.json grandfathers; build-trust cannot reject K_b's key on window grounds alone). So the
// load-bearing, layer-faithful observable is the LAUNDERED CONSTRAINT itself: the unauthorized rotation
// must NOT mint a `validFrom=effectiveAt` window onto K_b. We surface that via a K_b release whose
// trusted time is BEFORE effectiveAt:
//   - laundered window present  (current code) => `validFrom=E` is imposed → release predates validFrom
//                                                 → K_b release is WRONGLY REJECTED (RED).
//   - laundered window absent    (fixed code)   => K_b grandfathers (node.json stripped) → release SCORES.
// The CONTROL below proves the derive path is LIVE and ORDER-SENSITIVE: with NO prior revocation the
// rotation IS authorized, the `validFrom=E` window IS minted, and the SAME pre-E release is rejected.
describe("Residual ③ — order-aware signer-validity in build-trust (contract §13.1)", () => {
  const C = "2026-06-18T00:00:00.000Z";  // K_a compromise invalidity date
  const E = "2026-06-25T00:00:00.000Z";  // rotation effectiveAt (AFTER C)

  // A K_b release whose trusted time is BEFORE E (so a laundered validFrom=E would reject it).
  function kbRelease() {
    return sign(release("k-b", { timestamp: "2026-06-22T00:00:00.000Z" }), "k-b", BK.privateKey);
  }
  // The §4.2-authorized revocation of K_a (compromise), signed by the surviving key SK (= "rel-key-2").
  function revokeKa() {
    return sign(keyRevocation("rel-key", C), "rel-key-2", SK.privateKey);
  }
  // The K_a-signed rotation K_a→K_b (possession; §4.1). On the buggy code this is authorized on
  // possession alone even though K_a is already compromise-revoked.
  function rotateKaToKb() {
    return sign(keyRotation("rel-key", "k-b", BK.publicKey, E), "rel-key", RK.privateKey);
  }
  // node.json with BOTH K_a and K_b STRIPPED (window-less) — the tamper. K_surv (rel-key-2) survives.
  function strippedNodes() {
    return [
      nodeManifest(RELEASE, "registry", [
        maintainer("rel-key", RK.publicKey),     // K_a — STRIPPED (window-less)
        maintainer("rel-key-2", SK.publicKey),   // K_surv — surviving same-node signer of the revocation
        maintainer("k-b", BK.publicKey),         // K_b — STRIPPED (window-less); attacker-added rotated-to key
      ]),
      nodeManifest(ANCHOR, "attestor", [maintainer("anchor-key", NK.publicKey)]),
      nodeManifest(ATTESTOR, "attestor", [maintainer("att-key", AK.publicKey)]),
    ];
  }

  it("EXPLOIT BLOCKED: a K_a-signed rotation AFTER K_a's revocation mints NO window on K_b (K_b release grandfathers, not laundered-rejected)", () => {
    // Ledger order: revoke(K_a) BEFORE rotate(K_a→K_b). The rotation is signed by the ALREADY
    // compromise-revoked K_a → UNAUTHORIZED (order-aware §13.1) → K_b gets NO derived validFrom.
    // With node.json stripping K_b, K_b grandfathers → its pre-E release SCORES.
    //
    // RED on current (post-Wave-B2) code: the legacy authorization authorizes the rotation on K_a's
    // possession (ignoring its earlier revocation), launders `validFrom=E` onto K_b, and the pre-E
    // release "predates validFrom" → K_b is wrongly REJECTED → this assertion FAILS. GREEN after the
    // order-aware forward pass refuses to authorize a rotation signed by an already-revoked key.
    const relB = kbRelease();
    const anchorB = sign(anchorFor(relB.signature.canonicalHash, "2026-06-22T00:00:00.000Z"),
      "anchor-key", NK.privateKey);
    const out = sandbox([revokeKa(), rotateKaToKb(), relB, anchorB], strippedNodes()).run();
    const e = entryFor(out);
    assert.ok(e,
      "K_b's pre-effectiveAt release MUST score — the rotation that would have laundered a validFrom window onto K_b was signed by an already-compromise-revoked K_a and is UNAUTHORIZED");
    assert.equal(e.integrityScore, 45, "K_b grandfathers (no laundered window) and scores normally");
  });

  it("CONTROL (derive path is LIVE + ORDER-SENSITIVE): with NO prior revocation the rotation IS authorized → validFrom=E is minted → the SAME pre-E K_b release is REJECTED", () => {
    // SAME stripped node.json, SAME pre-E K_b release — but K_a is NOT revoked, so the rotation is
    // legitimately authorized (K_a valid at effectiveAt). The authorized rotation derives
    // `K_b: validFrom=E`; merged over the stripped node.json it IMPOSES validFrom=E; the release
    // (trusted time 2026-06-22 < E) predates validFrom → REJECTED. This proves the rejection in the
    // exploit-control direction comes from the LIVE derive path, and that ledger ORDER flips the
    // verdict (revoke-first => unauthorized => no window; no-revoke => authorized => window imposed).
    const relB = kbRelease();
    const anchorB = sign(anchorFor(relB.signature.canonicalHash, "2026-06-22T00:00:00.000Z"),
      "anchor-key", NK.privateKey);
    const out = sandbox([rotateKaToKb(), relB, anchorB], strippedNodes()).run();
    assert.ok(!entryFor(out),
      "with the rotation authorized, validFrom=E is derived onto K_b and the pre-effectiveAt release predates it → REJECTED (derive path is live)");
  });
});
