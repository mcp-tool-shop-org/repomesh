// Registry domain — FC6 (#4 LSP-01): attestation.dispute events affect trust scores.
//
// Contract (featureB-build-contract.md FC6): a signed `attestation.dispute` event from a TRUSTED
// node (verifier.policy.json allowlist + correct kind — reuse resolveTrustedKey, do NOT trust
// arbitrary nodes) against a (repo,version,disputedHash) MUST:
//   - mark the release verdict DISPUTED and downgrade it (the disputed check is treated as failed;
//     overall verdict no better than UNVERIFIED while an unresolved trusted dispute stands)
//   - surface the dispute reason legibly in trust.json + the verdict summary
// Untrusted/self disputes are IGNORED (display-only), same doctrine as attestations.
//
// Tests:
//   - a TRUSTED dispute downgrades the verdict to DISPUTED / no better than UNVERIFIED
//   - an UNTRUSTED (non-allowlisted) dispute does NOT downgrade
//   - a SELF dispute (release repo disputing its own release) does NOT downgrade

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
const REPO_ROOT = path.resolve(HERE, "..", "..");

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
const ATTESTOR = "test-org/attestor";
const ROGUE = "test-org/rogue";
const RELEASE_HASH = "b".repeat(64); // the released artifact's sha256 — what a dispute targets.

function release(over = {}) {
  return {
    type: "ReleasePublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T00:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
    attestations: [], ...over,
  };
}
// A dispute is carried on an AttestationPublished whose attestations[] includes attestation.dispute.
function dispute(over = {}) {
  return {
    type: "AttestationPublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T03:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
    attestations: [{ type: "attestation.dispute", uri: "repomesh:dispute:integrity" }],
    notes: `attestation.dispute against released artifact disputed:${RELEASE_HASH} — artifact does not match the signed source tree`,
    ...over,
  };
}
function nodeManifest(id, kind, keyId, pubPem) {
  return {
    id, kind, description: `${kind} node`, provides: [`${kind}.v1`], consumes: [],
    interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
    invariants: { deterministicBuild: false, signedReleases: false, semver: true, changelog: true },
    maintainers: [{ name: "tester", keyId, publicKey: pubPem.trim(), contact: "t@example.com" }],
    tags: ["test"],
  };
}

let RK, AK, GK;
before(() => { RK = genKeyPair(); AK = genKeyPair(); GK = genKeyPair(); });

function sandbox(events, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-disp-"));
  const nodesDir = path.join(dir, "nodes");
  const profilesDir = path.join(dir, "profiles");
  const registryDir = path.join(dir, "registry");
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(registryDir, { recursive: true });

  const nodes = opts.nodes || [
    nodeManifest(RELEASE, "registry", "rel-key", RK.publicKey),
    nodeManifest(ATTESTOR, "attestor", "att-key", AK.publicKey),
    nodeManifest(ROGUE, "attestor", "rogue-key", GK.publicKey),
  ];
  for (const n of nodes) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }

  const policyPath = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify(opts.policy || {
    v: 1,
    // ATTESTOR is a trusted attestor; ROGUE is NOT allowlisted; RELEASE is a trusted attestor of
    // itself (so the self-dispute case is reachable and must still be ignored).
    trustedAttestors: [ATTESTOR, RELEASE],
    trustedPolicy: [RELEASE],
    checks: {
      "sbom.present": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
      "provenance.present": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
      "signature.chain": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
      "license.audit": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
      "security.scan": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
      "repro.build": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
    },
  }, null, 2));

  const ledgerPath = path.join(dir, "events.jsonl");
  fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  return {
    dir, nodesDir, profilesDir, registryDir, policyPath, ledgerPath,
    run() {
      return buildTrust({ ledgerPath, nodesDir, profilesDir, registryDir, policyPath, write: false });
    },
  };
}

function entryFor(out, repo = RELEASE, version = "1.0.0") {
  return out.find((e) => e.repo === repo && e.version === version);
}

describe("FC6 disputes affect trust scores (#4 LSP-01)", () => {
  it("baseline: an undisputed release is VERIFIED with no DISPUTED marker", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const e = entryFor(sandbox([rel]).run());
    assert.ok(e, "release must be scored");
    assert.notEqual(e.verdict, "DISPUTED", "an undisputed release must not be DISPUTED");
    assert.equal(e.disputed, false, "disputed flag must be false when there is no dispute");
  });

  it("a TRUSTED dispute downgrades the verdict to DISPUTED and no better than UNVERIFIED", () => {
    // Undisputed, this release scores integrity 45 (signed+artifacts+noPolicy) → UNVERIFIED already,
    // so raise it with a trusted attestor so the downgrade is observable: give it the three
    // attestor-gated integrity checks → integrity 90 → VERIFIED, THEN dispute it.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const goodAtt = sign({
      type: "AttestationPublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
      timestamp: "2026-03-01T01:00:00.000Z",
      artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
      attestations: [
        { type: "sbom.present", uri: "repomesh:attestor:sbom.present:pass" },
        { type: "provenance.present", uri: "repomesh:attestor:provenance.present:pass" },
        { type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" },
      ],
      notes: "sbom.present: pass — ok\nprovenance.present: pass — ok\nsignature.chain: pass — ok",
    }, "att-key", AK.privateKey);

    // Confirm pre-dispute it would be VERIFIED.
    const pre = entryFor(sandbox([rel, goodAtt]).run());
    assert.equal(pre.verdict, "VERIFIED", "pre-dispute the release must be VERIFIED (sanity)");

    // Now add a TRUSTED dispute from ATTESTOR.
    const disp = sign(dispute(), "att-key", AK.privateKey);
    const e = entryFor(sandbox([rel, goodAtt, disp]).run());
    assert.ok(e, "release must still be scored");
    assert.equal(e.disputed, true, "a trusted dispute must set disputed=true");
    assert.equal(e.verdict, "DISPUTED", "a trusted dispute must mark the verdict DISPUTED");
    // The integrity score must be downgraded so the verdict is no better than UNVERIFIED (<40 band).
    assert.ok(e.integrityScore < 40,
      `a trusted dispute must downgrade integrity below the UNVERIFIED ceiling (<40), got ${e.integrityScore}`);
    // The dispute reason must be surfaced legibly in the summary.
    assert.ok(/dispute/i.test(e.trustSummary),
      "the verdict summary must mention the dispute\n" + e.trustSummary);
    assert.ok(e.disputes.length >= 1 && e.disputes[0].node === ATTESTOR,
      "the trusted dispute must be recorded with its signer node\n" + JSON.stringify(e.disputes));
  });

  it("an UNTRUSTED (non-allowlisted) dispute does NOT downgrade", () => {
    // ROGUE is a valid attestor-kind node but NOT in trustedAttestors → its dispute is dropped at
    // signature resolution (resolveTrustedKey finds no trusted signer) and must not affect scoring.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const goodAtt = sign({
      type: "AttestationPublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
      timestamp: "2026-03-01T01:00:00.000Z",
      artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
      attestations: [
        { type: "sbom.present", uri: "repomesh:attestor:sbom.present:pass" },
        { type: "provenance.present", uri: "repomesh:attestor:provenance.present:pass" },
        { type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" },
      ],
      notes: "sbom.present: pass — ok\nprovenance.present: pass — ok\nsignature.chain: pass — ok",
    }, "att-key", AK.privateKey);
    const rogueDisp = sign(dispute(), "rogue-key", GK.privateKey);

    const e = entryFor(sandbox([rel, goodAtt, rogueDisp]).run());
    assert.equal(e.disputed, false, "an untrusted dispute must NOT set disputed=true");
    assert.equal(e.verdict, "VERIFIED", "an untrusted dispute must NOT downgrade the verdict");
    assert.equal(e.disputes.length, 0, "an untrusted dispute must not be recorded as an active dispute");
  });

  it("a SELF dispute (release repo disputing its own release) does NOT downgrade", () => {
    // RELEASE is itself a trusted attestor (in trustedAttestors) and resolves to a valid signer, but a
    // node may not dispute its OWN release — self-disputes are display-only, IGNORED for scoring.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const goodAtt = sign({
      type: "AttestationPublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
      timestamp: "2026-03-01T01:00:00.000Z",
      artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
      attestations: [
        { type: "sbom.present", uri: "repomesh:attestor:sbom.present:pass" },
        { type: "provenance.present", uri: "repomesh:attestor:provenance.present:pass" },
        { type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" },
      ],
      notes: "sbom.present: pass — ok\nprovenance.present: pass — ok\nsignature.chain: pass — ok",
    }, "att-key", AK.privateKey);
    // Signed by the RELEASE repo's own key (rel-key resolves to RELEASE node).
    const selfDisp = sign(dispute(), "rel-key", RK.privateKey);

    const e = entryFor(sandbox([rel, goodAtt, selfDisp]).run());
    assert.equal(e.disputed, false, "a self dispute must NOT set disputed=true");
    assert.equal(e.verdict, "VERIFIED", "a self dispute must NOT downgrade the verdict");
  });
});
