// STGB-TRUST-002 (registry observability) — a check that resolves to consensus:'untrusted' (attested,
// but by a node OUTSIDE the per-check trusted-set) correctly earns 0 credit, but was reported to the
// operator as plain "missing" — hiding the actionable cause. This test pins the LEGIBILITY fix: the
// trustSummary must surface a DISTINCT "attested by untrusted node <id>" cause, while the SCORING is
// unchanged (untrusted stays 0 credit; the registry is correctly the stricter authority).
//
// TEST-FIRST: this fails on the pre-fix build-trust (which folds 'untrusted' into the "missing" bucket).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalizeForHash } from "../../ledger/scripts/canonicalize.mjs";
import { buildTrust } from "../scripts/build-trust.mjs";

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
const TRUSTED_ATTESTOR = "test-org/attestor-trusted";   // in the per-check trusted-set
const OUTSIDER_ATTESTOR = "test-org/attestor-outsider";  // allowlisted to sign, but NOT in the check set
const RELEASE_HASH = "b".repeat(64);

function release(over = {}) {
  return {
    type: "ReleasePublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T00:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
    attestations: [], ...over,
  };
}
function attestation(attestations, over = {}) {
  return {
    type: "AttestationPublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T01:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
    attestations, ...over,
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

let RK, TK, OK;
before(() => { RK = genKeyPair(); TK = genKeyPair(); OK = genKeyPair(); });

function sandbox(events, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-untrusted-"));
  const nodesDir = path.join(dir, "nodes");
  const profilesDir = path.join(dir, "profiles");
  const registryDir = path.join(dir, "registry");
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(registryDir, { recursive: true });

  const nodes = [
    nodeManifest(RELEASE, "registry", "rel-key", RK.publicKey),
    nodeManifest(TRUSTED_ATTESTOR, "attestor", "trusted-key", TK.publicKey),
    nodeManifest(OUTSIDER_ATTESTOR, "attestor", "outsider-key", OK.publicKey),
  ];
  for (const n of nodes) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }

  if (opts.profile) {
    fs.writeFileSync(path.join(profilesDir, `${opts.profile.id}.json`), JSON.stringify(opts.profile, null, 2));
    const [org, repo] = RELEASE.split("/");
    fs.writeFileSync(path.join(nodesDir, org, repo, "repomesh.profile.json"),
      JSON.stringify({ profileId: opts.profile.id }, null, 2));
  }

  // Policy: BOTH attestors are allowlisted to SIGN (trustedAttestors) so the outsider's attestation
  // survives signature verification. But the per-check trusted-set lists ONLY the trusted attestor,
  // so an attestation from the outsider resolves to consensus:'untrusted'.
  const mkCheck = () => ({ mode: "trusted-set", trustedNodes: [TRUSTED_ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" });
  const policy = {
    v: 1,
    trustedAttestors: [TRUSTED_ATTESTOR, OUTSIDER_ATTESTOR, RELEASE],
    trustedPolicy: [RELEASE],
    checks: {
      "sbom.present": mkCheck(), "provenance.present": mkCheck(), "signature.chain": mkCheck(),
      "license.audit": mkCheck(), "security.scan": mkCheck(), "repro.build": mkCheck(),
    },
  };
  const policyPath = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));

  const ledgerPath = path.join(dir, "events.jsonl");
  fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  return { run: () => buildTrust({ ledgerPath, nodesDir, profilesDir, registryDir, policyPath, write: false }) };
}

function entryFor(out) { return out.find((e) => e.repo === RELEASE && e.version === "1.0.0"); }

describe("STGB-TRUST-002 legible 'untrusted attestor' cause", () => {
  const strictProfile = {
    id: "strict", version: "1.0.0",
    requiredChecks: { integrity: ["signed", "hasArtifacts", "noPolicyViolations"], assurance: ["security.scan"] },
  };

  it("an out-of-set attestor resolves to consensus 'untrusted' (sanity)", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation(
      [{ type: "security.scan", uri: "repomesh:attestor:security.scan:pass" }],
      { repo: RELEASE, notes: "security.scan: pass — no vulns" }
    ), "outsider-key", OK.privateKey);
    const e = entryFor(sandbox([rel, att], { profile: strictProfile }).run());
    assert.ok(e, "release must be scored");
    assert.equal(e.assuranceConsensus?.["security.scan"]?.consensus, "untrusted",
      "an attestation from a node outside the per-check trusted-set must resolve to 'untrusted'\n" +
      JSON.stringify(e.assuranceConsensus, null, 2));
  });

  it("SCORING UNCHANGED: an 'untrusted' check earns 0 credit", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation(
      [{ type: "security.scan", uri: "repomesh:attestor:security.scan:pass" }],
      { repo: RELEASE, notes: "security.scan: pass — no vulns" }
    ), "outsider-key", OK.privateKey);
    const e = entryFor(sandbox([rel, att], { profile: strictProfile }).run());
    // security.scan attested only by an out-of-set node → 0 assurance points.
    assert.equal(e.assuranceScore, 0,
      "untrusted attestation must NOT earn assurance credit (registry is the stricter authority)");
    assert.ok(!(e.completedChecks || []).includes("security.scan"),
      "an untrusted check must not be a completed check");
  });

  it("LEGIBILITY: the trustSummary names the untrusted node, NOT a bare 'missing'", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation(
      [{ type: "security.scan", uri: "repomesh:attestor:security.scan:pass" }],
      { repo: RELEASE, notes: "security.scan: pass — no vulns" }
    ), "outsider-key", OK.privateKey);
    const e = entryFor(sandbox([rel, att], { profile: strictProfile }).run());

    assert.match(e.trustSummary, /untrusted/i,
      "the trustSummary must surface an 'untrusted' cause for security.scan\n" + e.trustSummary);
    assert.match(e.trustSummary, new RegExp(OUTSIDER_ATTESTOR.replace(/[/\-]/g, "\\$&")),
      "the trustSummary must NAME the untrusted attestor node so the operator can act\n" + e.trustSummary);
    // It must NOT be reported as a bare absent/"missing" check (the pre-fix bug).
    assert.ok(!/missing:\s*[^;]*security\.scan/.test(e.trustSummary),
      "security.scan attested-by-untrusted must NOT be reported under the plain 'missing' cause\n" + e.trustSummary);
  });

  it("a genuinely absent check is STILL reported as plain 'missing' (no regression)", () => {
    // No attestation at all for security.scan → absent → 'missing' (unchanged behavior).
    const rel = sign(release(), "rel-key", RK.privateKey);
    const e = entryFor(sandbox([rel], { profile: strictProfile }).run());
    assert.match(e.trustSummary, /missing:\s*[^;]*security\.scan/,
      "a check with NO attestation must still be reported as plain 'missing'\n" + e.trustSummary);
    assert.ok(!/untrusted/i.test(e.trustSummary),
      "an absent check must not be mislabeled 'untrusted'\n" + e.trustSummary);
  });
});
