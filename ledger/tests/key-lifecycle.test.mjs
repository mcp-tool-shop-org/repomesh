// RepoMesh Ledger — Key-lifecycle (rotation/revocation) regression suite.
//
// These are the BUG'S regression for the B-ledger sites (contract §1 sites 3/4/5 + §8):
//   - verify-release.mjs (site 3, inline maintainers.find)
//   - validate-ledger.mjs (site 4 extractPublicKey, site 5 resolveTrustedKey, §8 event validation)
//
// The live bug: every key-resolution site did an UNTIMED maintainers.find and returned the key with
// zero time check, so a compromised-but-still-listed key scored full integrity and verified VALID.
// The fix gates each resolved key on the signature's TRUSTED time via the shared predicate
// (verifiers/lib/key-window.mjs). A maintainer with NO window fields is GRANDFATHERED = always valid,
// so the whole existing ledger verifies byte-identically (the grandfather tests prove this).
//
// Strategy: write each fixture ledger + node tree to a temp dir, run the real script as a subprocess
// (the honest way to exercise the top-level control flow), assert on exit code / output. OFFLINE: the
// trusted clock is the bundled-trusted ANCHOR EVENT's timestamp (rung-2), so fixtures that need a
// PROVABLE time include a ledger.anchor AttestationPublished signed by a trustedAttestors node.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalizeForHash } from "../scripts/canonicalize.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR = path.join(HERE, "..", "scripts", "validate-ledger.mjs");
const VERIFY_RELEASE = path.join(HERE, "..", "scripts", "verify-release.mjs");

// ---------------------------------------------------------------------------
// Crypto + event helpers (mirror the validator's canonicalization exactly)
// ---------------------------------------------------------------------------

function genKeyPair() {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function computeCanonicalHash(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.signature;
  const canonical = canonicalizeForHash(copy);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function sign(ev, keyId, privateKey) {
  const unsigned = { ...ev };
  delete unsigned.signature;
  const hash = computeCanonicalHash(unsigned);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  return {
    ...unsigned,
    signature: { alg: "ed25519", keyId, value: sig.toString("base64"), canonicalHash: hash },
  };
}

function release(overrides = {}) {
  return {
    type: "ReleasePublished",
    repo: "test-org/test-repo",
    version: "1.0.0",
    commit: "a".repeat(40),
    timestamp: new Date().toISOString(),
    artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/bundle.js" }],
    attestations: [],
    ...overrides,
  };
}

// A ledger.anchor AttestationPublished whose notes pin a partition [firstLeaf..lastLeaf]. When signed
// by a trustedAttestors node, its timestamp becomes a PROVABLE upper-bound clock (rung-2, contract §5.2).
function anchorEvent(range, timestamp, overrides = {}) {
  return {
    type: "AttestationPublished",
    repo: "test-org/anchor",
    version: "0.0.0-anchor",
    commit: "c".repeat(40),
    timestamp,
    artifacts: [{ name: "anchor.json", sha256: "d".repeat(64), uri: "https://example.com/anchor.json" }],
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:DEADBEEF" }],
    notes: "ledger.anchor: pass\n" + JSON.stringify({ partitionId: "p1", range }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Node manifest builder — maintainers may carry lifecycle window fields.
// ---------------------------------------------------------------------------

function maintainer(name, keyId, pubPem, windowFields = {}) {
  return {
    name,
    keyId,
    publicKey: pubPem.trim(),
    contact: `${keyId}@example.com`,
    ...windowFields,
  };
}

function nodeManifest(id, kind, maintainers) {
  return {
    id,
    kind,
    description: `${kind} node for tests`,
    provides: [`${kind}.test.v1`],
    consumes: [],
    interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
    invariants: { deterministicBuild: false, signedReleases: false, semver: true, changelog: true },
    maintainers,
    tags: ["test"],
  };
}

// ---------------------------------------------------------------------------
// Fixture sandbox — nodes/ tree + events.jsonl + an isolated (empty) manifests dir, plus a policy.
// ---------------------------------------------------------------------------

function sandbox({ nodes, events, trustedAttestors, trustedPolicy }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-keylc-"));
  const nodesDir = path.join(dir, "nodes");
  const eventsPath = path.join(dir, "events.jsonl");
  const manifestsDir = path.join(dir, "manifests"); // empty → no anchor-manifest immutability check
  fs.mkdirSync(manifestsDir, { recursive: true });

  for (const n of nodes) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }

  fs.writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  const policyPath = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify({
    v: 1,
    checks: {},
    trustedAttestors: trustedAttestors ?? ["test-org/anchor"],
    trustedPolicy: trustedPolicy ?? ["test-org/policy"],
  }, null, 2));

  const env = {
    ...process.env,
    REPOMESH_NODES_PATH: nodesDir,
    REPOMESH_MANIFESTS_PATH: manifestsDir,
    REPOMESH_VERIFIER_POLICY_PATH: policyPath,
    HEAD_LEDGER: eventsPath,
  };

  function runValidator(extraEnv = {}) {
    const res = spawnSync("node", [VALIDATOR], { env: { ...env, ...extraEnv }, encoding: "utf8" });
    return { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
  }

  return { dir, nodesDir, eventsPath, env, runValidator };
}

// verify-release.mjs reads its ledger + nodes from a FIXED tree relative to the script (ROOT =
// scriptDir/.. ; REPO_ROOT = ROOT/.. ; events at ROOT/events/events.jsonl, nodes at ROOT/nodes/…),
// and it imports ../../verifiers/lib/key-window.mjs (REPO_ROOT/verifiers/lib/…). So we mirror the FULL
// repo-relative layout into a temp dir and run the COPIED script there — every relative path (sibling
// canonicalize.mjs AND the cross-package key-window import) resolves to our fixture, never the real repo.
function runVerifyRelease({ nodes, events, repo, version }) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rm-vr-"));
  const ledgerDir = path.join(repoRoot, "ledger");
  const scriptsDir = path.join(ledgerDir, "scripts");
  const eventsDir = path.join(ledgerDir, "events");
  const nodesDir = path.join(ledgerDir, "nodes");
  const libDir = path.join(repoRoot, "verifiers", "lib");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  // Copy the two sibling modules + the shared predicate at the exact relative offsets the script uses.
  for (const f of ["verify-release.mjs", "canonicalize.mjs"]) {
    fs.copyFileSync(path.join(HERE, "..", "scripts", f), path.join(scriptsDir, f));
  }
  fs.copyFileSync(
    path.join(HERE, "..", "..", "verifiers", "lib", "key-window.mjs"),
    path.join(libDir, "key-window.mjs"),
  );

  fs.writeFileSync(path.join(eventsDir, "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  for (const n of nodes) {
    const [org, repoName] = n.id.split("/");
    const p = path.join(nodesDir, org, repoName);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }
  // Point the policy env var at a policy that trusts our anchor node so the anchor-event clock is provable.
  const policyPath = path.join(repoRoot, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify({
    v: 1, trustedAttestors: ["test-org/anchor"], trustedPolicy: ["test-org/policy"],
  }, null, 2));
  const res = spawnSync("node", [path.join(scriptsDir, "verify-release.mjs"),
    "--repo", repo, "--version", version], {
    env: { ...process.env, REPOMESH_VERIFIER_POLICY_PATH: policyPath },
    encoding: "utf8",
  });
  return { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
}

// ---------------------------------------------------------------------------
// Shared keypairs
// ---------------------------------------------------------------------------

let REL;       // the release/repo signing key
let SURVIVOR;  // a surviving sibling maintainer key on the same node
let ANCHOR;    // a trusted anchor node key (provable clock)
let POLICY;    // a trustedPolicy node key (governance floor)

before(() => {
  REL = genKeyPair();
  SURVIVOR = genKeyPair();
  ANCHOR = genKeyPair();
  POLICY = genKeyPair();
});

// Helper: build a ledger where `rel` is anchored. Returns [anchorEv, relEv] so the anchor's range
// covers rel's leaf. The anchor is signed by the trusted ANCHOR node (provable clock).
function anchoredLedger(relEv, anchorTimestamp) {
  const leaf = relEv.signature.canonicalHash;
  const anchor = sign(anchorEvent([leaf, leaf], anchorTimestamp), "anchor-key", ANCHOR.privateKey);
  return [anchor, relEv];
}

const ANCHOR_NODE = () => nodeManifest("test-org/anchor", "attestor",
  [maintainer("anchorer", "anchor-key", ANCHOR.publicKey)]);
const POLICY_NODE = () => nodeManifest("test-org/policy", "policy",
  [maintainer("policymaker", "policy-key", POLICY.publicKey)]);

// ===========================================================================
// 1. GRANDFATHER — windowless key is byte-identically valid (today's behavior).
// ===========================================================================

describe("Grandfather — windowless keys unchanged", () => {
  it("validate-ledger ACCEPTS a release signed by a windowless maintainer", () => {
    const rel = sign(release(), "rel-key", REL.privateKey);
    const repoNode = nodeManifest("test-org/test-repo", "registry",
      [maintainer("dev", "rel-key", REL.publicKey)]); // NO window fields
    const sb = sandbox({ nodes: [repoNode], events: [rel] });
    const r = sb.runValidator();
    assert.equal(r.code, 0, "grandfathered key must pass unchanged\n" + r.err);
  });

  it("verify-release ACCEPTS a release signed by a windowless maintainer", () => {
    const rel = sign(release(), "rel-key", REL.privateKey);
    const repoNode = nodeManifest("test-org/test-repo", "registry",
      [maintainer("dev", "rel-key", REL.publicKey)]);
    const r = runVerifyRelease({ nodes: [repoNode], events: [rel], repo: "test-org/test-repo", version: "1.0.0" });
    assert.equal(r.code, 0, "grandfathered key must verify\n" + r.err);
  });
});

// ===========================================================================
// 2. COMPROMISE — a now-compromise-revoked key's POST-invalidity release is REJECTED.
//    invalidAfter = C. A release provably anchored at/after C must be rejected (sites 3 + 4).
// ===========================================================================

describe("Compromise — post-invalidity release rejected", () => {
  const C = "2026-05-18T00:00:00.000Z";

  // The repo node: rel-key is compromise-revoked with invalidAfter=C; a survivor key remains.
  function repoNodeCompromised() {
    return nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey, {
        revokedAt: "2026-05-20T09:00:00.000Z",
        revocationReason: "compromise",
        invalidAfter: C,
      }),
      maintainer("survivor", "survivor-key", SURVIVOR.publicKey),
    ]);
  }

  it("validate-ledger REJECTS a release anchored AT/AFTER the invalidity date", () => {
    // Release self-timestamp is backdated, but it is PROVABLY anchored after C.
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const events = anchoredLedger(rel, "2026-05-19T00:00:00.000Z"); // anchor (provable) AFTER C
    const sb = sandbox({ nodes: [repoNodeCompromised(), ANCHOR_NODE()], events });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "compromised key with provable post-C time must be REJECTED\n" + r.out + r.err);
    assert.match(r.err + r.out, /compromise|invalidity|usable key/i);
  });

  it("verify-release REJECTS a release anchored AT/AFTER the invalidity date", () => {
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const events = anchoredLedger(rel, "2026-05-19T00:00:00.000Z");
    const r = runVerifyRelease({
      nodes: [repoNodeCompromised(), ANCHOR_NODE()], events,
      repo: "test-org/test-repo", version: "1.0.0",
    });
    assert.equal(r.code, 1, "verify-release must reject compromised post-C signature\n" + r.out + r.err);
    assert.match(r.err + r.out, /compromise|invalidity|No usable key/i);
  });

  it("validate-ledger REJECTS a release whose time cannot be PROVEN (unanchored, compromise)", () => {
    // No anchor → only the self-timestamp (provable:false). A compromised key requires a provable time.
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const sb = sandbox({ nodes: [repoNodeCompromised()], events: [rel] });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "unanchored compromised signature must be REJECTED\n" + r.out + r.err);
    assert.match(r.err + r.out, /provable|anchored|compromise|usable key/i);
  });

  it("validate-ledger ACCEPTS a release PROVABLY anchored BEFORE the invalidity date", () => {
    // Compromise does NOT retroactively kill provably-old signatures.
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const events = anchoredLedger(rel, "2026-05-15T00:00:00.000Z"); // anchor (provable) BEFORE C
    const sb = sandbox({ nodes: [repoNodeCompromised(), ANCHOR_NODE()], events });
    const r = sb.runValidator();
    assert.equal(r.code, 0, "provably-old compromised signature must remain VALID\n" + r.out + r.err);
  });
});

// ===========================================================================
// 3. ROTATION — prospective: a signature BEFORE effectiveAt valid, AT/AFTER rejected.
// ===========================================================================

describe("Rotation — prospective only", () => {
  const R = "2026-05-14T12:00:00.000Z";

  function repoNodeRotated() {
    return nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey, {
        validUntil: R,
        revokedAt: R,
        revocationReason: "rotation",
      }),
    ]);
  }

  it("ACCEPTS a signature provably anchored BEFORE the rotation time", () => {
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const events = anchoredLedger(rel, "2026-05-12T00:00:00.000Z"); // before R
    const sb = sandbox({ nodes: [repoNodeRotated(), ANCHOR_NODE()], events });
    const r = sb.runValidator();
    assert.equal(r.code, 0, "pre-rotation signature must stay VALID\n" + r.out + r.err);
  });

  it("REJECTS a signature at/after the rotation time", () => {
    // Self-time after R (rotation trusts the self time → no anchor needed to reject).
    const rel = sign(release({ timestamp: "2026-05-20T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const sb = sandbox({ nodes: [repoNodeRotated()], events: [rel] });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "post-rotation signature must be REJECTED\n" + r.out + r.err);
    assert.match(r.err + r.out, /rotat|validUntil|revocation|usable key/i);
  });
});

// ===========================================================================
// 3b. NODE.JSON-STRIP (contract §12.1 / §12.3) — derive-the-stricter-window.
//
//   Finding ① (Wave-B2): verify-release reads window state from node.json and does NOT run the
//   ledger binding check. A tampered node.json that STRIPS a compromise-revoked key's window
//   fields re-grandfathers it (isWindowed=false → VALID), even though the SIGNED KeyRevocation
//   event is still in the ledger. The fix derives the window independently from the signed
//   KeyRotation/KeyRevocation events (whose signature verifies AND signer is authorized, §4) and
//   merges the MOST RESTRICTIVE of node.json + derived, so a stripped node.json can only ADD
//   restriction, never remove what the signed event asserts.
//
//   This regression FAILS on post-Wave-B code (stripped node.json → grandfathered → accepted) and
//   PASSES after the verify-release site is wrapped with derive-stricter.
// ===========================================================================

describe("Node.json-strip — derive-stricter rejects post-compromise (§12.1)", () => {
  const C = "2026-05-18T00:00:00.000Z";

  // The signed KeyRevocation that authorizes rel-key's compromise. Signed by the SURVIVING same-node
  // key (authorized per §4.2), so verifyAndAuthorize accepts it and the derived constraint applies.
  function revokeEvent() {
    return {
      type: "KeyRevocation",
      repo: "test-org/test-repo",
      timestamp: "2026-05-20T09:00:00.000Z",
      key: { action: "revoke", revokedKeyId: "rel-key", reason: "compromise", invalidAfter: C },
    };
  }

  // node.json with rel-key's window fields STRIPPED (re-grandfathered) but the survivor key present
  // so the ledger's KeyRevocation is signed by an authorized surviving key.
  function strippedRepoNode() {
    return nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey), // window fields STRIPPED — looks grandfathered
      maintainer("survivor", "survivor-key", SURVIVOR.publicKey),
    ]);
  }

  it("verify-release REJECTS a post-compromise release even when node.json window is STRIPPED", () => {
    // Release provably anchored AFTER C. node.json says "grandfathered", but the signed (authorized)
    // KeyRevocation in the ledger asserts compromise+invalidAfter=C → derive-stricter must reject.
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const revoke = sign(revokeEvent(), "survivor-key", SURVIVOR.privateKey);
    const leaf = rel.signature.canonicalHash;
    const anchor = sign(anchorEvent([leaf, leaf], "2026-05-19T00:00:00.000Z"), "anchor-key", ANCHOR.privateKey);
    const events = [revoke, anchor, rel];
    const r = runVerifyRelease({
      nodes: [strippedRepoNode(), ANCHOR_NODE()], events,
      repo: "test-org/test-repo", version: "1.0.0",
    });
    assert.equal(r.code, 1,
      "stripped-node post-compromise signature must STILL be REJECTED via derive-stricter\n" + r.out + r.err);
    assert.match(r.err + r.out, /compromise|invalidity|No usable key/i);
  });

  it("verify-release still ACCEPTS a provably-old release under the stripped+derived window", () => {
    // Compromise does not retroactively kill provably-old signatures: anchored BEFORE C → VALID,
    // even though the derived constraint marks rel-key compromise-revoked.
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const revoke = sign(revokeEvent(), "survivor-key", SURVIVOR.privateKey);
    const leaf = rel.signature.canonicalHash;
    const anchor = sign(anchorEvent([leaf, leaf], "2026-05-15T00:00:00.000Z"), "anchor-key", ANCHOR.privateKey);
    const events = [revoke, anchor, rel];
    const r = runVerifyRelease({
      nodes: [strippedRepoNode(), ANCHOR_NODE()], events,
      repo: "test-org/test-repo", version: "1.0.0",
    });
    assert.equal(r.code, 0,
      "provably-old signature under the derived compromise window must remain VALID\n" + r.out + r.err);
  });

  it("verify-release IGNORES an UNAUTHORIZED (self-signed) KeyRevocation when deriving the window", () => {
    // The KeyRevocation is signed by the REVOKED key itself (unauthorized §4.2). It must NOT
    // contribute a derived constraint — so with a (genuinely) grandfathered node.json the release
    // stays VALID. This proves derive-stricter gates on §4 authorization, not on event presence.
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey);
    const selfRevoke = sign(revokeEvent(), "rel-key", REL.privateKey); // self-signed → unauthorized
    const leaf = rel.signature.canonicalHash;
    const anchor = sign(anchorEvent([leaf, leaf], "2026-05-19T00:00:00.000Z"), "anchor-key", ANCHOR.privateKey);
    const events = [selfRevoke, anchor, rel];
    const r = runVerifyRelease({
      nodes: [strippedRepoNode(), ANCHOR_NODE()], events,
      repo: "test-org/test-repo", version: "1.0.0",
    });
    assert.equal(r.code, 0,
      "an unauthorized (self-signed) revocation must NOT derive a window — release stays VALID\n" + r.out + r.err);
  });
});

// ===========================================================================
// 4. §8 — KeyRevocation event validation + BINDING.
// ===========================================================================

describe("§8 KeyRevocation — authorization + binding", () => {
  const C = "2026-05-18T00:00:00.000Z";

  function revokeEvent(overrides = {}) {
    return {
      type: "KeyRevocation",
      repo: "test-org/test-repo",
      timestamp: "2026-05-20T09:00:00.000Z",
      key: { action: "revoke", revokedKeyId: "rel-key", reason: "compromise", invalidAfter: C },
      ...overrides,
    };
  }

  // node.json that correctly REFLECTS the revocation (binding satisfied) + a surviving signer key.
  function boundRepoNode() {
    return nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey, {
        revokedAt: "2026-05-20T09:00:00.000Z", revocationReason: "compromise", invalidAfter: C,
      }),
      maintainer("survivor", "survivor-key", SURVIVOR.publicKey),
    ]);
  }

  it("ACCEPTS a revocation signed by a SURVIVING same-node key with matching node.json binding", () => {
    const ev = sign(revokeEvent(), "survivor-key", SURVIVOR.privateKey);
    const sb = sandbox({ nodes: [boundRepoNode()], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 0, "authorized + bound revocation must pass\n" + r.out + r.err);
  });

  it("ACCEPTS a revocation signed by a trustedPolicy node (governance floor)", () => {
    const ev = sign(revokeEvent(), "policy-key", POLICY.privateKey);
    const sb = sandbox({ nodes: [boundRepoNode(), POLICY_NODE()], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 0, "trustedPolicy-signed revocation must pass\n" + r.out + r.err);
  });

  it("REJECTS a revocation with NO backing node.json change (binding violation)", () => {
    // node.json does NOT mark rel-key revoked → the signed revocation is not reflected.
    const unboundNode = nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey), // windowless: no revokedAt
      maintainer("survivor", "survivor-key", SURVIVOR.publicKey),
    ]);
    const ev = sign(revokeEvent(), "survivor-key", SURVIVOR.privateKey);
    const sb = sandbox({ nodes: [unboundNode], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "unbacked revocation must FAIL the binding check\n" + r.out + r.err);
    assert.match(r.err + r.out, /binding|revokedAt|not reflected|no backing/i);
  });

  it("REJECTS a revocation SIGNED BY THE REVOKED KEY ITSELF (unauthorized signer)", () => {
    const ev = sign(revokeEvent(), "rel-key", REL.privateKey);
    const sb = sandbox({ nodes: [boundRepoNode()], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "self-signed revocation must be REJECTED\n" + r.out + r.err);
    assert.match(r.err + r.out, /revoked key|surviving|trustedPolicy|authoriz/i);
  });

  it("REJECTS a revocation signed by an UNKNOWN/untrusted key (unauthorized signer)", () => {
    const rogue = genKeyPair();
    const ev = sign(revokeEvent(), "rogue-key", rogue.privateKey);
    const sb = sandbox({ nodes: [boundRepoNode()], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "unknown-key revocation must be REJECTED\n" + r.out + r.err);
    assert.match(r.err + r.out, /surviving|trustedPolicy|TRUSTED|authoriz|signer/i);
  });

  it("REJECTS a compromise revocation missing invalidAfter (semantic shape)", () => {
    const ev = sign(
      revokeEvent({ key: { action: "revoke", revokedKeyId: "rel-key", reason: "compromise" } }),
      "survivor-key", SURVIVOR.privateKey,
    );
    const sb = sandbox({ nodes: [boundRepoNode()], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "compromise revoke without invalidAfter must FAIL\n" + r.out + r.err);
    assert.match(r.err + r.out, /invalidAfter|compromise/i);
  });
});

// ===========================================================================
// 5. §8 — KeyRotation event validation + BINDING.
// ===========================================================================

describe("§8 KeyRotation — authorization + binding", () => {
  const E = "2026-05-14T12:00:00.000Z";
  const NEW_KEY = genKeyPair();

  function rotateEvent(overrides = {}) {
    return {
      type: "KeyRotation",
      repo: "test-org/test-repo",
      timestamp: E,
      key: {
        action: "rotate",
        retiringKeyId: "rel-key",
        newKeyId: "rel-key-2",
        newPublicKey: NEW_KEY.publicKey.trim(),
        effectiveAt: E,
      },
      ...overrides,
    };
  }

  // node.json correctly reflects the rotation: retiring key gets validUntil=E, new key has validFrom=E.
  function boundRotatedNode() {
    return nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey, {
        validUntil: E, revokedAt: E, revocationReason: "rotation",
      }),
      maintainer("dev2", "rel-key-2", NEW_KEY.publicKey, { validFrom: E }),
    ]);
  }

  it("ACCEPTS a rotation self-signed by the retiring key with matching binding", () => {
    const ev = sign(rotateEvent(), "rel-key", REL.privateKey);
    const sb = sandbox({ nodes: [boundRotatedNode()], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 0, "authorized + bound rotation must pass\n" + r.out + r.err);
  });

  it("REJECTS a rotation whose new key is NOT in node.json (binding violation)", () => {
    const nodeMissingNew = nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey, { validUntil: E, revokedAt: E, revocationReason: "rotation" }),
      // rel-key-2 absent
    ]);
    const ev = sign(rotateEvent(), "rel-key", REL.privateKey);
    const sb = sandbox({ nodes: [nodeMissingNew], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "rotation without the new key in node.json must FAIL\n" + r.out + r.err);
    assert.match(r.err + r.out, /new key|validFrom|binding|appended/i);
  });

  it("REJECTS a rotation where node.json validUntil != effectiveAt (binding violation)", () => {
    const skewed = nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey, {
        validUntil: "2099-01-01T00:00:00.000Z", revokedAt: E, revocationReason: "rotation",
      }),
      maintainer("dev2", "rel-key-2", NEW_KEY.publicKey, { validFrom: E }),
    ]);
    const ev = sign(rotateEvent(), "rel-key", REL.privateKey);
    const sb = sandbox({ nodes: [skewed], events: [ev] });
    const r = sb.runValidator();
    assert.equal(r.code, 1, "rotation with mismatched validUntil must FAIL\n" + r.out + r.err);
    assert.match(r.err + r.out, /validUntil|effectiveAt|binding/i);
  });
});

// ===========================================================================
// 6. WAVE-B3 §13.1 ③ — ORDER-AWARE authorization at verify-release (the ③ regression).
//
//   Residual ③ (HIGH on an untrusted source): the Wave-B2 derive-stricter protects the MAIN
//   resolution path, but the AUTHORIZATION sub-check (is a KeyRotation/KeyRevocation's *signer*
//   currently valid?) used to validate the signer against node.json ALONE. Exploit: an attacker
//   holds compromise-revoked K_a; serves a node.json that STRIPS K_a's window; the OLD (order-
//   INSENSITIVE) derive then sees K_a "valid" → K_a authorizes a LATER KeyRotation K_a→K_b → the
//   rotation's window is imposed → trust re-established via rotation.
//
//   THE FIX (§13.1): deriveKeyWindowConstraints is now an ORDER-AWARE single forward pass. It
//   replays the repo's key-lifecycle events in LEDGER ORDER, and a key-event's SIGNER is validated
//   against the window derived from STRICTLY-EARLIER events (merged with node.json). When K_a's
//   compromise-revocation PRECEDES the rotation it signs, K_a is INVALID at the rotation's trusted
//   time → "K_a could not authorize the rotation" → the rotation contributes NO derived window.
//   This site supplies only the I/O (verifySignature/getMaintainer/timeOf/trustedPolicy); the §4
//   authorization VALIDITY decision now lives in the one shared module.
//
//   THE OBSERVABLE FLIP at this verify-release (derive-stricter) site:
//     Ledger order [R (compromise-revoke K_a), then ROT (K_a→K_b, self-signed by K_a)]; node.json
//     STRIPS K_a's window (attacker re-grandfathers it) and carries K_b grandfathered. K_b signs a
//     release dated BEFORE the rotation's effectiveAt.
//       • PRE-FIX (legacy, order-insensitive): the rotation is wrongly authorized (K_a looks valid in
//         the stripped node.json) → K_a→K_b imposes validFrom=effectiveAt on K_b → the release
//         (before effectiveAt) is REJECTED "signature predates validFrom". A spurious window was
//         minted by a rotation an already-compromised key signed.
//       • POST-FIX (order-aware): K_a's compromise precedes the rotation → K_a is INVALID at the
//         rotation time → the rotation is UNAUTHORIZED → K_b gets NO derived window → grandfathered →
//         the release is ACCEPTED. "K_a could not authorize the rotation" is now load-bearing.
//     This case FAILS on the current (post-Wave-B2) code and PASSES after the order-aware adapt.
//
//   DIRECTION NOTE (contract §13.2 inherent boundary — documented, not patched): the contract's
//   end-to-end narrative ("K_b's release verifies VALID") is the COORDINATOR's cross-layer probe; at
//   a derive-stricter verify site the protection is one-sided — derive can only ADD restriction, so
//   the rotation's WITHHELD authority is the observable. A literal "K_b release REJECTED via the
//   derived window" cannot manifest here: an attacker who can STRIP K_a from a node.json can equally
//   ADD K_b grandfathered (no event restricts a brand-new key → always-valid), and this site reads
//   maintainers from node.json. That residual is closed by validate-ledger's signed-event BINDING and
//   by `--anchored` (event-ledger Merkle root) — NOT by the per-site derive-stricter wrapper. The
//   per-site ③ regression therefore asserts the authorization WIRING: an already-compromise-revoked
//   signer cannot mint a rotation window (the flip above), and the converse — a rotation that PRECEDES
//   the revocation still stands.
// ===========================================================================

describe("§13.1 ③ — order-aware authorization (verify-release)", () => {
  const C = "2026-05-18T00:00:00.000Z";   // K_a compromise invalidity date
  const EFF = "2026-05-25T12:00:00.000Z"; // the rotation's effectiveAt
  let KB; // the key K_a tries to rotate INTO

  before(() => {
    KB = genKeyPair();
  });

  // Earlier signed KeyRevocation(compromise) of rel-key (K_a), authorized by the SURVIVING key.
  function revokeKa() {
    return {
      type: "KeyRevocation",
      repo: "test-org/test-repo",
      timestamp: "2026-05-20T09:00:00.000Z",
      key: { action: "revoke", revokedKeyId: "rel-key", reason: "compromise", invalidAfter: C },
    };
  }

  // A LATER KeyRotation rel-key (K_a) → rel-key-2 (K_b), SELF-SIGNED by the (now-compromised) K_a.
  function rotateKaToKb() {
    return {
      type: "KeyRotation",
      repo: "test-org/test-repo",
      timestamp: EFF,
      key: {
        action: "rotate",
        retiringKeyId: "rel-key",
        newKeyId: "rel-key-2",
        newPublicKey: KB.publicKey.trim(),
        effectiveAt: EFF,
      },
    };
  }

  // node.json: K_a's window STRIPPED (attacker re-grandfathers it); the surviving key authorizes the
  // revocation; K_b grandfathered (the attacker's freely-added rotation target — §13.2 boundary).
  function strippedNodeWithKb() {
    return nodeManifest("test-org/test-repo", "registry", [
      maintainer("dev", "rel-key", REL.publicKey),                 // K_a — window STRIPPED
      maintainer("survivor", "survivor-key", SURVIVOR.publicKey),
      maintainer("dev2", "rel-key-2", KB.publicKey),               // K_b — grandfathered
    ]);
  }

  it("THE ③ FLIP: an already-compromise-revoked K_a CANNOT authorize a LATER rotation → its window is NOT imposed on K_b", () => {
    // Ledger order: R (revoke K_a) BEFORE ROT (K_a→K_b). K_b's release is dated BEFORE effectiveAt.
    // PRE-FIX the rotation is wrongly authorized and stamps validFrom=EFF on K_b → predates → REJECTED.
    // POST-FIX the rotation is unauthorized (K_a invalid at EFF) → K_b unwindowed → ACCEPTED.
    const revoke = sign(revokeKa(), "survivor-key", SURVIVOR.privateKey);
    const rotate = sign(rotateKaToKb(), "rel-key", REL.privateKey);
    const rel = sign(release({ timestamp: "2026-05-24T00:00:00.000Z" }), "rel-key-2", KB.privateKey);
    const leaf = rel.signature.canonicalHash;
    const anchor = sign(anchorEvent([leaf, leaf], "2026-05-24T00:00:00.000Z"), "anchor-key", ANCHOR.privateKey);

    const r = runVerifyRelease({
      nodes: [strippedNodeWithKb(), ANCHOR_NODE()],
      events: [revoke, rotate, anchor, rel],
      repo: "test-org/test-repo", version: "1.0.0",
    });
    assert.equal(r.code, 0,
      "a rotation signed by an already-compromise-revoked key must NOT impose its window on the new key " +
      "(K_a could not authorize the rotation) — the pre-fix order-insensitive derive wrongly rejected this\n" + r.out + r.err);
  });

  it("CONVERSE: a rotation that PRECEDES K_a's revocation still stands — K_b inherits validFrom=effectiveAt", () => {
    // Ledger order: ROT (K_a still valid, rotates to K_b) BEFORE R (later compromise-revokes K_a).
    // The rotation WAS authorized (K_a valid at rotation time) → it legitimately stamps K_b. A K_b
    // release dated BEFORE the rotation's effectiveAt is therefore correctly REJECTED (predates the
    // window the legit rotation minted). This proves the order-aware pass still APPLIES a valid
    // rotation's window — the fix narrows authorization, it does not disable it.
    const rotate = sign(rotateKaToKb(), "rel-key", REL.privateKey);          // effectiveAt = EFF
    const revoke = sign({
      ...revokeKa(),
      timestamp: "2026-06-01T09:00:00.000Z",
      key: { action: "revoke", revokedKeyId: "rel-key", reason: "compromise", invalidAfter: "2026-05-30T00:00:00.000Z" },
    }, "survivor-key", SURVIVOR.privateKey);                                 // revocation AFTER the rotation
    const rel = sign(release({ timestamp: "2026-05-24T00:00:00.000Z" }), "rel-key-2", KB.privateKey); // before EFF
    const leaf = rel.signature.canonicalHash;
    const anchor = sign(anchorEvent([leaf, leaf], "2026-05-24T00:00:00.000Z"), "anchor-key", ANCHOR.privateKey);

    const r = runVerifyRelease({
      nodes: [strippedNodeWithKb(), ANCHOR_NODE()],
      events: [rotate, revoke, anchor, rel],
      repo: "test-org/test-repo", version: "1.0.0",
    });
    assert.equal(r.code, 1,
      "a rotation that precedes the signer's revocation is authorized and its validFrom window applies — " +
      "a release before effectiveAt must be REJECTED\n" + r.out + r.err);
    assert.match(r.err + r.out, /validFrom|predates|usable key/i);
  });

  it("INVARIANT: K_a's own later release stays REJECTED post-compromise even with the rotation present (rotation does not rehabilitate K_a)", () => {
    // The rotation must never undo K_a's compromise: a release SIGNED BY K_a, provably anchored after
    // C, stays rejected regardless of any self-signed rotation in the ledger. Holds pre- and post-fix
    // (the revocation is authorized in both paths); guards against the fix accidentally weakening K_a.
    const revoke = sign(revokeKa(), "survivor-key", SURVIVOR.privateKey);
    const rotate = sign(rotateKaToKb(), "rel-key", REL.privateKey);
    const rel = sign(release({ timestamp: "2026-05-10T00:00:00.000Z" }), "rel-key", REL.privateKey); // backdated self-time
    const leaf = rel.signature.canonicalHash;
    const anchor = sign(anchorEvent([leaf, leaf], "2026-05-26T00:00:00.000Z"), "anchor-key", ANCHOR.privateKey); // provable after C

    const r = runVerifyRelease({
      nodes: [strippedNodeWithKb(), ANCHOR_NODE()],
      events: [revoke, rotate, anchor, rel],
      repo: "test-org/test-repo", version: "1.0.0",
    });
    assert.equal(r.code, 1,
      "K_a's post-compromise release must STILL be rejected — a self-signed rotation cannot rehabilitate it\n" + r.out + r.err);
    assert.match(r.err + r.out, /compromise|invalidity|No usable key/i);
  });
});
