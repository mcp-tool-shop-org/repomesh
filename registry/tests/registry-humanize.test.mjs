// Registry domain — Stage C/D humanization amend tests (legibility + degradation, NOT correctness).
// Probes the FULL invariant for each fix (additive only — no Stage A verdict is changed):
//   STGB-VER-003  build-trust KEEPS each verifier source's `reason` string in
//                 assuranceConsensus.sources, so trust.json explains a warn/unscored/fail.
//   ANC-B04       build-trust emits a legible `verdict` + `trustSummary` one-liner saying WHICH
//                 required checks are missing/failed/unscored.
//   ANC-B09       build-trust exposes `assuranceScaling` (rawAchieved / sumOfPassWeights / factor)
//                 so the /100 renormalization is transparent.
//   ANC-B10       build-trust note parsing tolerates em-dash, en-dash, AND ASCII hyphen separators.

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

function release(over = {}) {
  return {
    type: "ReleasePublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T00:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/b.js" }],
    attestations: [], ...over,
  };
}
function attestation(attestations, over = {}) {
  return {
    type: "AttestationPublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T01:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/b.js" }],
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

let RK, AK, GK;
before(() => { RK = genKeyPair(); AK = genKeyPair(); GK = genKeyPair(); });

function sandbox(events, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-hum-"));
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
  if (opts.profile) {
    fs.writeFileSync(path.join(profilesDir, `${opts.profile.id}.json`), JSON.stringify(opts.profile, null, 2));
  }
  if (opts.repoProfileId) {
    const [org, repo] = RELEASE.split("/");
    fs.writeFileSync(path.join(nodesDir, org, repo, "repomesh.profile.json"),
      JSON.stringify({ profileId: opts.repoProfileId }, null, 2));
  }

  const policyPath = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify(opts.policy || {
    v: 1,
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
    dir,
    run() {
      return buildTrust({ ledgerPath, nodesDir, profilesDir, registryDir, policyPath, write: false });
    },
  };
}
function entryFor(out, repo = RELEASE, version = "1.0.0") {
  return out.find((e) => e.repo === repo && e.version === version);
}

// ---------------------------------------------------------------------------
// STGB-VER-003 — verifier reason string survives into assuranceConsensus.sources
// ---------------------------------------------------------------------------
describe("STGB-VER-003 trust.json keeps the verifier's reason string", () => {
  it("a warn attestation's reason is preserved in assuranceConsensus.sources", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([], {
      notes: "security.scan: warn — moderate vuln in transitive dep foo@1.2.3",
    }), "att-key", AK.privateKey);
    const out = sandbox([rel, att]).run();
    const e = entryFor(out);
    const sec = e.assuranceConsensus["security.scan"];
    assert.ok(sec, "security.scan must appear in assuranceConsensus");
    assert.equal(sec.consensus, "warn");
    assert.equal(sec.sources.length, 1);
    assert.match(sec.sources[0].reason, /moderate vuln in transitive dep foo@1\.2\.3/,
      "the verifier's reason must be kept so trust.json explains the warn\n" + JSON.stringify(sec, null, 2));
  });
});

// ---------------------------------------------------------------------------
// ANC-B04 — legible verdict + trustSummary explaining WHY
// ---------------------------------------------------------------------------
describe("ANC-B04 legible UNVERIFIED/low-score summary", () => {
  it("a release with no attestations carries an UNVERIFIED-grade summary naming the missing checks", () => {
    // signed(15)+artifacts(15)+noPolicy(15) = 45 integrity -> PARTIAL; requires sbom/provenance/sigchain.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const out = sandbox([rel], {
      repoProfileId: "strict",
      profile: {
        id: "strict", version: "1.0.0",
        requiredChecks: {
          integrity: ["signed", "hasArtifacts", "noPolicyViolations", "sbom.present", "provenance.present", "signature.chain"],
          assurance: ["security.scan"],
        },
      },
    }).run();
    const e = entryFor(out);
    assert.ok(typeof e.trustSummary === "string" && e.trustSummary.length > 0, "trustSummary must be present");
    assert.ok(["VERIFIED", "PARTIAL", "UNVERIFIED"].includes(e.verdict), "verdict must be a known label");
    assert.match(e.trustSummary, /missing:.*sbom\.present/, "summary must name the missing sbom.present check\n" + e.trustSummary);
    assert.match(e.trustSummary, /security\.scan/, "summary must name the missing security.scan check\n" + e.trustSummary);
  });

  it("distinguishes a FAILED check from a MISSING one in the summary", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([{ type: "security.scan", uri: "repomesh:attestor:security.scan:fail" }], {
      notes: "security.scan: fail — critical CVE",
    }), "att-key", AK.privateKey);
    const out = sandbox([rel, att], {
      repoProfileId: "strict",
      profile: {
        id: "strict", version: "1.0.0",
        requiredChecks: { integrity: ["signed", "hasArtifacts", "noPolicyViolations"], assurance: ["security.scan", "license.audit"] },
      },
    }).run();
    const e = entryFor(out);
    assert.match(e.trustSummary, /failed:.*security\.scan/, "a failing check must be reported as failed\n" + e.trustSummary);
    assert.match(e.trustSummary, /missing:.*license\.audit/, "an absent check must be reported as missing\n" + e.trustSummary);
  });

  it("an unscored check is summarized as unscored (verifier could not run), not failed/missing-only", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([{ type: "repro.build", uri: "repomesh:attestor:repro.build:unscored" }], {
      notes: "repro.build: unscored — build command not in allowlist",
    }), "att-key", AK.privateKey);
    const out = sandbox([rel, att], {
      repoProfileId: "strict",
      profile: {
        id: "strict", version: "1.0.0",
        requiredChecks: { integrity: ["signed", "hasArtifacts", "noPolicyViolations"], assurance: ["repro.build"] },
      },
    }).run();
    const e = entryFor(out);
    assert.match(e.trustSummary, /unscored.*repro\.build/, "an unscored check must be labeled unscored\n" + e.trustSummary);
  });
});

// ---------------------------------------------------------------------------
// ANC-B09 — assurance /100 renormalization is transparent
// ---------------------------------------------------------------------------
describe("ANC-B09 assurance renormalization transparency", () => {
  it("exposes rawAchieved / sumOfPassWeights / scalingFactor when the axis is rescaled", () => {
    // A profile requiring only security.scan: sum-of-pass-weights = 40, not 100, so renormalized.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([{ type: "security.scan", uri: "repomesh:attestor:security.scan:pass" }], {
      notes: "security.scan: pass — no vulns",
    }), "att-key", AK.privateKey);
    const out = sandbox([rel, att], {
      repoProfileId: "strict",
      profile: {
        id: "strict", version: "1.0.0",
        requiredChecks: { integrity: ["signed", "hasArtifacts", "noPolicyViolations"], assurance: ["security.scan"] },
      },
    }).run();
    const e = entryFor(out);
    assert.ok(e.assuranceScaling, "assuranceScaling must be present");
    assert.equal(e.assuranceScaling.renormalized, true, "single 40-weight check axis must be renormalized");
    assert.equal(e.assuranceScaling.rawAchieved, 40, "raw achieved is the pass weight (40)");
    assert.equal(e.assuranceScaling.sumOfPassWeights, 40, "denominator is the sum of pass weights");
    assert.equal(e.assuranceScore, 100, "40 raw / 40 possible -> 100/100");
    assert.ok(Math.abs(e.assuranceScaling.scalingFactor - 2.5) < 0.001, "scaling factor 100/40 = 2.5");
  });

  it("marks renormalized:false when the default 3-check axis already sums to 100", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const out = sandbox([rel]).run(); // default checks: 30+40+30 = 100
    const e = entryFor(out);
    assert.equal(e.assuranceScaling.renormalized, false, "default 100-sum axis is not renormalized");
    assert.equal(e.assuranceScaling.scalingFactor, 1);
  });
});

// ---------------------------------------------------------------------------
// ANC-B10 — note parsing tolerates em-dash / en-dash / ASCII hyphen
// ---------------------------------------------------------------------------
describe("ANC-B10 note separator tolerance", () => {
  const SEPARATORS = [
    ["em-dash", "—"],
    ["en-dash", "–"],
    ["ASCII hyphen", "-"],
  ];
  for (const [label, dash] of SEPARATORS) {
    it(`parses an attestation note that uses an ${label} separator`, () => {
      const rel = sign(release(), "rel-key", RK.privateKey);
      const att = sign(attestation([], {
        notes: `security.scan: warn ${dash} drifted-separator reason text`,
      }), "att-key", AK.privateKey);
      const out = sandbox([rel, att]).run();
      const e = entryFor(out);
      const sec = e.assuranceConsensus["security.scan"];
      assert.ok(sec, `a ${label}-separated note must still be parsed into a result\n` + JSON.stringify(e.assuranceConsensus, null, 2));
      assert.equal(sec.consensus, "warn");
      assert.match(sec.sources[0].reason, /drifted-separator reason text/);
    });
  }
});
