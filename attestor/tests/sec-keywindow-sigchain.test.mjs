// Key-lifecycle regression at the attestor sig-chain (contract site 10, §5.3 + §9/§10).
//
// THE BUG: attest-release's checkSignatureChain did an UNTIMED maintainers.find() and verified the
// release against the matched key with ZERO time check. A compromise-revoked-but-still-listed key
// therefore PASSED signature.chain. This file pins the contract's required behavior:
//
//   1. Grandfather: a window-less maintainer verifies byte-identically to today (VALID when the
//      signature cryptographically verifies). Proves non-destructive.
//   2. Forged-window probe (§9/§10): a real, internally-consistent ReleasePublished, correctly
//      SIGNED by a now-compromise-revoked key with a backdated self-timestamp, anchored AFTER
//      invalidAfter => REJECTED. The crypto verifies; the TIME gate rejects.
//   3. Compromise + NO anchor (unprovable) => REJECTED (a compromised key needs a provable time).
//   4. Compromise + provably-old (anchored < invalidAfter) => VALID (compromise is not retroactive).
//   5. The signing path (signEvent) is unaffected — signing never applies the time gate.
//
// TEST-FIRST / RED before fix: on the pre-fix code path checkSignatureChain has no ctx and applies
// no predicate, so cases 2 and 3 would PASS (result === "pass"). These assertions turn that into
// failures. After the fix, the windowed key is rejected with a time-gate code carrying dec.reason.

import { describe, it, before } from "node:test";
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
const LEDGER_VERIFY_RELEASE = path.join(REPO_ROOT, "ledger", "scripts", "verify-release.mjs");

// Point the attestor at a crafted nodes dir BEFORE import (NODES_DIR is read at module load).
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-kw-sig-"));
const NODES = path.join(baseDir, "nodes");
process.env.REPOMESH_NODES_PATH = NODES;

const REPO = "test-org/widget";
// A bundled-trusted anchor node (must be in verifier.policy.json trustedAttestors so its
// self-asserted timestamp is a trusted offline clock — rung-2 gate, contract §5.2).
const ANCHOR_REPO = "mcp-tool-shop-org/repomesh-xrpl-anchor";

let checkSignatureChain;
let buildAttestorTimeCtx;
let signEvent;
let isBundledTrustedAnchorEvent;

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
  const stripped = JSON.parse(JSON.stringify(ev));
  delete stripped.signature;
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
}

const anchorKp = crypto.generateKeyPairSync("ed25519");
const anchorPubPem = anchorKp.publicKey.export({ type: "spki", format: "pem" }).toString();

// Write a node.json maintainer (optionally windowed) for REPO, plus the trusted anchor node.
function writeNode(maintainer) {
  const [org, repoName] = REPO.split("/");
  fs.mkdirSync(path.join(NODES, org, repoName), { recursive: true });
  fs.writeFileSync(
    path.join(NODES, org, repoName, "node.json"),
    JSON.stringify({ id: REPO, maintainers: [maintainer] }),
    "utf8"
  );
  const [aOrg, aRepo] = ANCHOR_REPO.split("/");
  fs.mkdirSync(path.join(NODES, aOrg, aRepo), { recursive: true });
  fs.writeFileSync(
    path.join(NODES, aOrg, aRepo, "node.json"),
    JSON.stringify({
      id: ANCHOR_REPO,
      kind: "attestor",
      maintainers: [{ name: "Anchor", keyId: "anchor-key", publicKey: anchorPubPem, contact: "a@example.com" }],
    }),
    "utf8"
  );
}

// A real ReleasePublished signed (correctly) by `privateKey`/`keyId`, with a chosen self-timestamp.
function makeSignedRelease({ privateKey, keyId, timestamp }) {
  const ev = {
    type: "ReleasePublished",
    repo: REPO,
    version: "1.0.0",
    commit: "a".repeat(40),
    timestamp,
    artifacts: [{ name: "x.tgz", sha256: "b".repeat(64), uri: "https://example.com/x.tgz" }],
    attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }],
    signature: { alg: "ed25519", keyId, value: "", canonicalHash: "" },
  };
  const hash = canonicalHashOf(ev);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  ev.signature.value = sig.toString("base64");
  ev.signature.canonicalHash = hash;
  return ev;
}

// A bundled-trusted ledger.anchor AttestationPublished whose partition timestamp-range covers the
// release event, with a chosen anchor timestamp = the trusted offline clock.
function makeTrustedAnchorEvent({ anchorTs, partitionStart, partitionEnd, anchorPrivateKey = anchorKp.privateKey, anchorKeyId }) {
  const meta = {
    txHash: "TX-FORGE",
    network: "testnet",
    partitionId: "p-test",
    partitionStart,
    partitionEnd,
    merkleRoot: "d".repeat(64),
  };
  const ev = {
    type: "AttestationPublished",
    repo: ANCHOR_REPO,
    timestamp: anchorTs,
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:TX-FORGE" }],
    notes: `ledger.anchor: pass\n${JSON.stringify(meta)}`,
    signature: { alg: "ed25519", keyId: anchorKeyId, value: "", canonicalHash: "" },
  };
  const hash = canonicalHashOf(ev);
  if (anchorPrivateKey) {
    ev.signature.value = crypto.sign(null, Buffer.from(hash, "hex"), anchorPrivateKey).toString("base64");
  }
  ev.signature.canonicalHash = hash;
  return ev;
}

// A compromise-revoked maintainer with invalidity date C.
const C = "2026-06-18T00:00:00.000Z";

describe("contract site 10 — attestor sig-chain key-window gate", () => {
  let kp, pubPem;
  before(async () => {
    kp = crypto.generateKeyPairSync("ed25519");
    pubPem = kp.publicKey.export({ type: "spki", format: "pem" }).toString();
    ({ checkSignatureChain, buildAttestorTimeCtx, signEvent } = await import("../scripts/attest-release.mjs"));
    ({ isBundledTrustedAnchorEvent } = await import("../../verifiers/lib/key-window.mjs"));
  });

  // --- §9.1 grandfather: window-less key behaves byte-identically to today --------------------
  it("grandfather: a window-less maintainer with a valid signature still PASSES (no time gate)", () => {
    writeNode({ name: "Legacy Dev", keyId: "legacy-key", publicKey: pubPem });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "legacy-key", timestamp: "2026-01-01T00:00:00.000Z" });
    // No ctx at all => exactly today's call shape. Must still pass.
    const r = checkSignatureChain(rel);
    assert.equal(r.result, "pass");
    assert.equal(r.code, "verified");
  });

  it("grandfather: passes even WITH a ctx supplied (predicate returns valid for window-less keys)", () => {
    writeNode({ name: "Legacy Dev", keyId: "legacy-key", publicKey: pubPem });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "legacy-key", timestamp: "2026-01-01T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass");
    assert.equal(r.code, "verified");
  });

  // --- §9/§10 forged-window probe: compromise-revoked key, crypto-valid, anchored AFTER C -----
  it("FORGED-WINDOW PROBE: a compromise-revoked key, correctly signed, backdated self-time, anchored AFTER C => REJECTED", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    // The release self-claims 2026-06-01 (< C) — a backdated, untrustworthy timestamp.
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-01T00:00:00.000Z" });

    // A TRUSTED anchor whose partition range covers the release; its timestamp proves the leaf
    // existed by 2026-06-19 (> C). The anchor signer is in trustedAttestors => bundled-trusted.
    const anchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-19T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorKeyId: "anchor-key",
    });

    const ctx = buildAttestorTimeCtx([rel, anchor]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail", "a provably-post-compromise signature must be rejected even though the crypto verifies");
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /compromise invalidity date/);
  });

  it("compromise + NO anchor (unprovable self-time) => REJECTED", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    // Self-time claims 2026-06-01 (< C) but there is NO anchor covering the leaf => unprovable.
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-01T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel]); // no anchor in the ledger
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /provable \(anchored\) signature time/);
  });

  it("compromise + provably-OLD (anchored BEFORE C) => VALID (compromise is not retroactive)", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-15T00:00:00.000Z" });
    // Trusted anchor proves the leaf existed by 2026-06-17 (< C).
    const anchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-17T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorKeyId: "anchor-key",
    });
    const ctx = buildAttestorTimeCtx([rel, anchor]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass", "a provably-pre-compromise signature must remain valid");
    assert.equal(r.code, "verified");
  });

  it("untrusted (forged) anchor does NOT rescue a compromised key — its timestamp is not a trusted clock", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-01T00:00:00.000Z" });
    // Anchor signer NOT in trustedAttestors => rung-2 gate fails => falls to self (unprovable) => reject.
    const anchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-10T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorKeyId: "anchor-key",
    });
    anchor.repo = "evil-org/forged-anchor"; // not in trustedAttestors
    const ctx = buildAttestorTimeCtx([rel, anchor]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail", "a forged anchor cannot provide a trusted clock for a compromised key");
    assert.equal(r.code, "key-time-invalid");
  });

  it("governance-kind node's anchor does NOT rescue a compromised key in attestor/scripts/attest-release.mjs", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    const govDir = path.join(NODES, "mcp-tool-shop-org", "cognate");
    fs.mkdirSync(govDir, { recursive: true });
    fs.writeFileSync(
      path.join(govDir, "node.json"),
      JSON.stringify({
        id: "mcp-tool-shop-org/cognate",
        kind: "governance",
        description: "governance node",
        maintainers: [{ name: "Cognate", keyId: "ci-cognate-2026", publicKey: pubPem, contact: "c@example.com" }],
      }, null, 2),
      "utf8",
    );
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-15T00:00:00.000Z" });
    const govAnchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-17T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorKeyId: "ci-cognate-2026",
    });
    govAnchor.repo = "mcp-tool-shop-org/cognate";
    const ctx = buildAttestorTimeCtx([rel, govAnchor]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail", "a governance-kind node's anchor must not be trusted as a clock");
    assert.equal(r.code, "key-time-invalid");
  });

  it("forged-signature anchor on a trusted repo does NOT rescue a compromised key in attestor/scripts/attest-release.mjs", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-15T00:00:00.000Z" });
    const forgedSigAnchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-17T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorPrivateKey: null,
      anchorKeyId: "anchor-key",
    });
    forgedSigAnchor.signature.value = "AAAA";
    const ctx = buildAttestorTimeCtx([rel, forgedSigAnchor]);
    assert.equal(ctx.isBundledTrustedAnchor(forgedSigAnchor), false, "anchor with a forged signature must be refused");
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail", "an anchor with a forged signature must not rescue a compromised key");
    assert.equal(r.code, "key-time-invalid");
  });

  it("anchor carrying the keyId of a governance node outside trustedAttestors does NOT rescue a compromised key in attestor/scripts/attest-release.mjs", () => {
    writeNode({
      name: "Compromised Dev",
      keyId: "compromised-key",
      publicKey: pubPem,
      revokedAt: "2026-06-20T09:00:00.000Z",
      revocationReason: "compromise",
      invalidAfter: C,
    });
    const gov2Kp = crypto.generateKeyPairSync("ed25519");
    const gov2Pem = gov2Kp.publicKey.export({ type: "spki", format: "pem" }).toString();
    const gov2Dir = path.join(NODES, "test-org", "gov2");
    fs.mkdirSync(gov2Dir, { recursive: true });
    fs.writeFileSync(
      path.join(gov2Dir, "node.json"),
      JSON.stringify({
        id: "test-org/gov2",
        kind: "governance",
        description: "untrusted governance node",
        maintainers: [{ name: "Gov2", keyId: "gov2-key", publicKey: gov2Pem, contact: "g2@example.com" }],
      }, null, 2),
      "utf8",
    );
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-15T00:00:00.000Z" });
    const gov2KeyAnchor = makeTrustedAnchorEvent({
      anchorTs: "2026-06-17T00:00:00.000Z",
      partitionStart: "2026-05-01T00:00:00.000Z",
      partitionEnd: "2026-06-30T00:00:00.000Z",
      anchorPrivateKey: gov2Kp.privateKey,
      anchorKeyId: "gov2-key",
    });
    const ctx = buildAttestorTimeCtx([rel, gov2KeyAnchor]);
    assert.equal(ctx.isBundledTrustedAnchor(gov2KeyAnchor), false, "anchor with governance keyId outside trustedAttestors must be refused");
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail", "an anchor with a governance keyId outside trustedAttestors must not rescue a compromised key");
    assert.equal(r.code, "key-time-invalid");
  });

  // --- Anchor key lifecycle window checks across all three paths (VL, LVR, AR) ---
  describe("anchor key window checks across validate-ledger, ledger/scripts/verify-release.mjs, and attestor/scripts/attest-release.mjs", () => {
    const regKp = crypto.generateKeyPairSync("ed25519");
    const cogKp = crypto.generateKeyPairSync("ed25519");
    const gov2Kp = crypto.generateKeyPairSync("ed25519");
    const missingKp = crypto.generateKeyPairSync("ed25519");
    const revCompKp = crypto.generateKeyPairSync("ed25519");
    const rotKp = crypto.generateKeyPairSync("ed25519");
    const unparseableKp = crypto.generateKeyPairSync("ed25519");
    const regPem = regKp.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
    const cogPem = cogKp.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
    const gov2Pem = gov2Kp.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
    const revCompPem = revCompKp.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
    const rotPem = rotKp.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
    const unparseablePem = unparseableKp.publicKey.export({ type: "spki", format: "pem" }).toString().trim();

    function fullManifest(id, kind, maintainers) {
      return {
        id,
        kind,
        description: `${kind} node`,
        provides: [`${kind}.test.v1`],
        consumes: [],
        interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
        invariants: { deterministicBuild: false, signedReleases: false, semver: true, changelog: true },
        maintainers,
        tags: ["test"],
      };
    }

    function setupAnchorFixture() {
      const nodes = [
        fullManifest(REPO, "compute", [{
          name: "Compromised Dev",
          keyId: "compromised-key",
          publicKey: pubPem.trim(),
          contact: "dev@example.com",
          revokedAt: "2026-06-20T09:00:00.000Z",
          revocationReason: "compromise",
          invalidAfter: C,
        }]),
        fullManifest("mcp-tool-shop-org/repomesh", "registry", [{
          name: "Registry",
          keyId: "ci-repomesh-2026",
          publicKey: regPem,
          contact: "reg@example.com",
        }]),
        fullManifest(ANCHOR_REPO, "attestor", [
          {
            name: "Revoked Anchor",
            keyId: "anchor-revoked-comp",
            publicKey: revCompPem,
            contact: "rev@example.com",
            revokedAt: "2026-06-16T00:00:00.000Z",
            revocationReason: "compromise",
            invalidAfter: "2026-06-16T00:00:00.000Z",
          },
          {
            name: "Rotated Anchor",
            keyId: "anchor-rotated",
            publicKey: rotPem,
            contact: "rot@example.com",
            validUntil: "2026-06-18T00:00:00.000Z",
            revokedAt: "2026-06-18T00:00:00.000Z",
            revocationReason: "rotation",
          },
          {
            name: "Broken Boundary Anchor",
            keyId: "anchor-unparseable",
            publicKey: unparseablePem,
            contact: "brk@example.com",
            revocationReason: "compromise",
            revokedAt: "not-a-valid-date",
          },
        ]),
        fullManifest("mcp-tool-shop-org/cognate", "governance", [{
          name: "Cognate",
          keyId: "ci-cognate-2026",
          publicKey: cogPem,
          contact: "cog@example.com",
        }]),
        fullManifest("test-org/gov2", "governance", [{
          name: "Gov2",
          keyId: "gov2-key",
          publicKey: gov2Pem,
          contact: "gov2@example.com",
        }]),
      ];

      fs.rmSync(path.join(NODES, "mcp-tool-shop-org", "repomesh-license-verifier"), { recursive: true, force: true });
      for (const n of nodes) {
        const [o, rName] = n.id.split("/");
        fs.mkdirSync(path.join(NODES, o, rName), { recursive: true });
        fs.writeFileSync(path.join(NODES, o, rName, "node.json"), JSON.stringify(n, null, 2), "utf8");
      }

      const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "compromised-key", timestamp: "2026-06-15T00:00:00.000Z" });
      const leaf = rel.signature.canonicalHash;

      function buildAnchorCase(repoId, keyId, privKey, ts = "2026-06-17T00:00:00.000Z") {
        const meta = {
          txHash: "TX-SHARED",
          network: "testnet",
          partitionId: "p-shared",
          partitionStart: "2026-05-01T00:00:00.000Z",
          partitionEnd: "2026-06-30T00:00:00.000Z",
          range: [leaf, leaf],
          merkleRoot: "d".repeat(64),
        };
        const ev = {
          type: "AttestationPublished",
          repo: repoId,
          version: "0.0.0-anchor",
          commit: "c".repeat(40),
          timestamp: ts,
          artifacts: [{ name: "anchor.json", sha256: "d".repeat(64), uri: "https://example.com/anchor.json" }],
          attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:TX-SHARED" }],
          notes: `ledger.anchor: pass\n${JSON.stringify(meta)}`,
          signature: { alg: "ed25519", keyId, value: "AAAA", canonicalHash: "" },
        };
        const hash = canonicalHashOf(ev);
        ev.signature.canonicalHash = hash;
        if (privKey) {
          ev.signature.value = crypto.sign(null, Buffer.from(hash, "hex"), privKey).toString("base64");
        }
        return ev;
      }

      function withSandbox(fn) {
        const sbDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-shared-anchor-"));
        try {
          const manifestsDir = path.join(sbDir, "manifests");
          fs.mkdirSync(manifestsDir, { recursive: true });
          const vrRoot = path.join(sbDir, "vr");
          const vrScripts = path.join(vrRoot, "ledger", "scripts");
          const vrEvents = path.join(vrRoot, "ledger", "events");
          const vrNodes = path.join(vrRoot, "ledger", "nodes");
          const vrLib = path.join(vrRoot, "verifiers", "lib");
          fs.mkdirSync(vrScripts, { recursive: true });
          fs.mkdirSync(vrEvents, { recursive: true });
          fs.mkdirSync(vrLib, { recursive: true });
          fs.cpSync(NODES, vrNodes, { recursive: true });
          fs.copyFileSync(LEDGER_VERIFY_RELEASE, path.join(vrScripts, "verify-release.mjs"));
          fs.copyFileSync(path.join(REPO_ROOT, "ledger", "scripts", "canonicalize.mjs"), path.join(vrScripts, "canonicalize.mjs"));
          fs.copyFileSync(path.join(REPO_ROOT, "verifiers", "lib", "key-window.mjs"), path.join(vrLib, "key-window.mjs"));
          fs.copyFileSync(path.join(REPO_ROOT, "verifier.policy.json"), path.join(vrRoot, "verifier.policy.json"));

          function evalOnAllThreePaths(ev) {
            const basePath = path.join(sbDir, "base.jsonl");
            const headPath = path.join(sbDir, "head.jsonl");
            fs.writeFileSync(basePath, JSON.stringify(ev) + "\n", "utf8");
            fs.writeFileSync(headPath, [ev, rel].map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

            const vlRes = spawnSync(process.execPath, [VALIDATOR], {
              env: {
                ...process.env,
                BASE_LEDGER: basePath,
                HEAD_LEDGER: headPath,
                REPOMESH_NODES_PATH: NODES,
                REPOMESH_MANIFESTS_PATH: manifestsDir,
              },
              encoding: "utf8",
            });
            const vl = vlRes.status === 0;

            fs.writeFileSync(path.join(vrEvents, "events.jsonl"), [ev, rel].map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
            const vrRes = spawnSync(process.execPath, [path.join(vrScripts, "verify-release.mjs"), "--repo", REPO, "--version", "1.0.0"], {
              env: { ...process.env, REPOMESH_VERIFIER_POLICY_PATH: path.join(vrRoot, "verifier.policy.json") },
              encoding: "utf8",
            });
            const lvr = vrRes.status === 0;

            const ctx = buildAttestorTimeCtx([ev, rel]);
            const attRes = checkSignatureChain(rel, ctx);
            const ar = ctx.isBundledTrustedAnchor(ev) && attRes.result === "pass";

            return { vl, lvr, ar };
          }

          function evalAnchorTrustDirectly(ev) {
            const policy = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "verifier.policy.json"), "utf8"));
            const trusted = new Set(policy.trustedAttestors || []);
            const runAtt = new Set(policy.trustedRunAttestors || []);
            const loadNode = (id) => {
              const [o, rName] = String(id || "").split("/");
              if (!o || !rName) return null;
              const p = path.join(NODES, o, rName, "node.json");
              return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
            };
            const verifyRaw32 = (pem, e) => {
              const msgHex = e.signature?.canonicalHash;
              if (typeof msgHex !== "string" || !/^[0-9a-f]{64}$/i.test(msgHex)) return false;
              try {
                return crypto.verify(null, Buffer.from(msgHex, "hex"), pem, Buffer.from(e.signature?.value || "", "base64"));
              } catch {
                return false;
              }
            };
            const vl = isBundledTrustedAnchorEvent(ev, {
              trustedAttestors: trusted,
              trustedRunAttestors: runAtt,
              loadNode,
              verifySignature: verifyRaw32,
            });
            const lvr = isBundledTrustedAnchorEvent(ev, {
              trustedAttestors: trusted,
              trustedRunAttestors: runAtt,
              loadNode,
              verifySignature: (pem, e) => {
                try {
                  return crypto.verify(null, Buffer.from(e.signature.canonicalHash, "hex"), pem, Buffer.from(e.signature.value, "base64"));
                } catch {
                  return false;
                }
              },
            });
            const ar = buildAttestorTimeCtx([ev]).isBundledTrustedAnchor(ev);
            return { vl, lvr, ar };
          }

          return fn({ buildAnchorCase, evalOnAllThreePaths, evalAnchorTrustDirectly });
        } finally {
          fs.rmSync(sbDir, { recursive: true, force: true });
        }
      }

      return { buildAnchorCase, withSandbox };
    }

    it("a revoked anchor key is refused on all three paths", () => {
      const { withSandbox } = setupAnchorFixture();
      withSandbox(({ buildAnchorCase, evalOnAllThreePaths }) => {
        const ev = buildAnchorCase(ANCHOR_REPO, "anchor-revoked-comp", revCompKp.privateKey, "2026-06-17T00:00:00.000Z");
        assert.deepEqual(evalOnAllThreePaths(ev), { vl: false, lvr: false, ar: false }, "a revoked anchor key must be refused on VL, LVR, and AR");
      });
    });

    it("a backdated anchor from a revoked key is refused on all three paths", () => {
      const { withSandbox } = setupAnchorFixture();
      withSandbox(({ buildAnchorCase, evalOnAllThreePaths }) => {
        const ev = buildAnchorCase(ANCHOR_REPO, "anchor-revoked-comp", revCompKp.privateKey, "2026-06-10T00:00:00.000Z");
        assert.deepEqual(evalOnAllThreePaths(ev), { vl: false, lvr: false, ar: false }, "a backdated anchor from a revoked key must be refused on VL, LVR, and AR");
      });
    });

    it("a rotated key (validUntil) whose anchors predate the rotation still counts on all three paths, while anchors at/after validUntil are refused", () => {
      const { withSandbox } = setupAnchorFixture();
      withSandbox(({ buildAnchorCase, evalOnAllThreePaths, evalAnchorTrustDirectly }) => {
        const preEv = buildAnchorCase(ANCHOR_REPO, "anchor-rotated", rotKp.privateKey, "2026-06-17T00:00:00.000Z");
        assert.deepEqual(evalAnchorTrustDirectly(preEv), { vl: true, lvr: true, ar: true }, "a rotated key whose anchor predates validUntil must be trusted as an anchor on VL, LVR, and AR");
        assert.deepEqual(evalOnAllThreePaths(preEv), { vl: true, lvr: true, ar: true }, "a rotated key whose anchor predates validUntil must count on VL, LVR, and AR");
        const postEv = buildAnchorCase(ANCHOR_REPO, "anchor-rotated", rotKp.privateKey, "2026-06-18T00:00:00.000Z");
        assert.deepEqual(evalAnchorTrustDirectly(postEv), { vl: false, lvr: false, ar: false }, "a rotated key whose anchor is at/after validUntil must be refused as an anchor on VL, LVR, and AR");
        assert.deepEqual(evalOnAllThreePaths(postEv), { vl: false, lvr: false, ar: false }, "a rotated key whose anchor is at/after validUntil must be refused on VL, LVR, and AR");
      });
    });

    it("a key with a revocation reason but no parseable boundary is refused on all three paths", () => {
      const { withSandbox } = setupAnchorFixture();
      withSandbox(({ buildAnchorCase, evalOnAllThreePaths }) => {
        const ev = buildAnchorCase(ANCHOR_REPO, "anchor-unparseable", unparseableKp.privateKey, "2026-06-10T00:00:00.000Z");
        assert.deepEqual(evalOnAllThreePaths(ev), { vl: false, lvr: false, ar: false }, "a key with revocation reason and no parseable boundary must be refused on VL, LVR, and AR");
      });
    });

    it("shared anchor-trust parity: validate-ledger, ledger/scripts/verify-release.mjs, and attestor/scripts/attest-release.mjs return identical answers across all anchor cases", () => {
      const { withSandbox } = setupAnchorFixture();
      withSandbox(({ buildAnchorCase, evalOnAllThreePaths }) => {
        const cases = [
          { name: "A1_valid_registry", ev: buildAnchorCase("mcp-tool-shop-org/repomesh", "ci-repomesh-2026", regKp.privateKey), expected: true },
          { name: "A2_governance_repo", ev: buildAnchorCase("mcp-tool-shop-org/cognate", "ci-cognate-2026", cogKp.privateKey), expected: false },
          { name: "A3_governance_keyId_in_trusted", ev: buildAnchorCase("mcp-tool-shop-org/repomesh", "ci-cognate-2026", cogKp.privateKey), expected: false },
          { name: "A4_forged_signature", ev: buildAnchorCase("mcp-tool-shop-org/repomesh", "ci-repomesh-2026", null), expected: false },
          { name: "A5_governance_keyId_outside_trusted", ev: buildAnchorCase("mcp-tool-shop-org/repomesh", "gov2-key", gov2Kp.privateKey), expected: false },
          { name: "A6_missing_manifest", ev: buildAnchorCase("mcp-tool-shop-org/repomesh-license-verifier", "ci-repomesh-license-2026", missingKp.privateKey), expected: false },
          { name: "A7_revoked_anchor_key", ev: buildAnchorCase(ANCHOR_REPO, "anchor-revoked-comp", revCompKp.privateKey, "2026-06-17T00:00:00.000Z"), expected: false },
          { name: "A8_backdated_anchor_from_revoked_key", ev: buildAnchorCase(ANCHOR_REPO, "anchor-revoked-comp", revCompKp.privateKey, "2026-06-10T00:00:00.000Z"), expected: false },
          { name: "A9_rotated_key_predating_rotation", ev: buildAnchorCase(ANCHOR_REPO, "anchor-rotated", rotKp.privateKey, "2026-06-17T00:00:00.000Z"), expected: true },
          { name: "A10_rotated_key_at_or_after_rotation", ev: buildAnchorCase(ANCHOR_REPO, "anchor-rotated", rotKp.privateKey, "2026-06-18T00:00:00.000Z"), expected: false },
          { name: "A11_revocation_reason_no_parseable_boundary", ev: buildAnchorCase(ANCHOR_REPO, "anchor-unparseable", unparseableKp.privateKey, "2026-06-10T00:00:00.000Z"), expected: false },
        ];

        const validateLedgerAnswers = {};
        const ledgerVerifyAnswers = {};
        const attestorAnswers = {};

        for (const c of cases) {
          const r = evalOnAllThreePaths(c.ev);
          validateLedgerAnswers[c.name] = r.vl;
          ledgerVerifyAnswers[c.name] = r.lvr;
          attestorAnswers[c.name] = r.ar;
        }

        const expectedMap = Object.fromEntries(cases.map((c) => [c.name, c.expected]));
        assert.deepEqual(validateLedgerAnswers, expectedMap, "validate-ledger answers must match expected anchor trust decisions");
        assert.deepEqual(ledgerVerifyAnswers, validateLedgerAnswers, "ledger/scripts/verify-release.mjs must agree with validate-ledger on every anchor case");
        assert.deepEqual(attestorAnswers, validateLedgerAnswers, "attestor/scripts/attest-release.mjs must agree with validate-ledger on every anchor case");
      });
    });
  });

  // --- §9.5 routine rotation is prospective; pre-R signatures stay valid ----------------------
  it("routine rotation: a signature BEFORE validUntil(R) stays VALID (trusts the self time)", () => {
    const R = "2026-06-14T12:00:00.000Z";
    writeNode({
      name: "Rotating Dev",
      keyId: "rotating-key",
      publicKey: pubPem,
      validUntil: R,
      revokedAt: R,
      revocationReason: "rotation",
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "rotating-key", timestamp: "2026-06-10T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel]); // self-time is trusted for routine rotation
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "pass");
    assert.equal(r.code, "verified");
  });

  it("routine rotation: a signature AT/AFTER validUntil(R) is REJECTED", () => {
    const R = "2026-06-14T12:00:00.000Z";
    writeNode({
      name: "Rotating Dev",
      keyId: "rotating-key",
      publicKey: pubPem,
      validUntil: R,
      revokedAt: R,
      revocationReason: "rotation",
    });
    const rel = makeSignedRelease({ privateKey: kp.privateKey, keyId: "rotating-key", timestamp: "2026-07-01T00:00:00.000Z" });
    const ctx = buildAttestorTimeCtx([rel]);
    const r = checkSignatureChain(rel, ctx);
    assert.equal(r.result, "fail");
    assert.equal(r.code, "key-time-invalid");
    assert.match(r.reason, /validUntil|rotated out/);
  });
});

// --- §9.5 / §11 signing path is unaffected ---------------------------------------------------
describe("contract site 10 — signing path (signEvent) is unaffected by the time gate", () => {
  before(async () => {
    if (!signEvent) ({ signEvent } = await import("../scripts/attest-release.mjs"));
  });

  it("signEvent produces a crypto-verifiable signature regardless of any window fields", () => {
    const kp = crypto.generateKeyPairSync("ed25519");
    const pem = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const ev = {
      type: "AttestationPublished",
      repo: REPO,
      version: "1.0.0",
      commit: "a".repeat(40),
      timestamp: "2026-06-14T00:00:00.000Z",
      artifacts: [],
      attestations: [{ type: "sbom", uri: "x" }],
    };
    const signed = signEvent(ev, pem, "any-key");
    assert.equal(signed.signature.keyId, "any-key");
    assert.ok(signed.signature.value && signed.signature.canonicalHash);
    // Independently verify the signature is well-formed.
    const stripped = JSON.parse(JSON.stringify(signed));
    delete stripped.signature;
    const hash = crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
    assert.equal(hash, signed.signature.canonicalHash, "signEvent must not be altered by the key-window work");
    const ok = crypto.verify(
      null,
      Buffer.from(hash, "hex"),
      kp.publicKey.export({ type: "spki", format: "pem" }).toString(),
      Buffer.from(signed.signature.value, "base64")
    );
    assert.equal(ok, true, "the signing path stays a pure crypto operation — no time gate");
  });
});
