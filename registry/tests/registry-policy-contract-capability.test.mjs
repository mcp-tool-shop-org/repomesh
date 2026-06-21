// #7 verifier-plugin contract — build-trust NEW-CAPABILITY + v1-FALLBACK + REGISTERED≠TRUSTED tests.
//
// These prove the WHOLE POINT of #7: a new check kind is a verifier.policy.json edit, not a code edit.
//
//   NEW CAPABILITY — registering a brand-new assurance check kind (`sast.scan`) in the policy, with a
//     trusted node in its trusted-set, makes a trusted `pass` attestation of that kind earn its
//     configured weight (25). The scorer reads the kind + weight + trusted-set entirely from the policy
//     via the resolver — build-trust.mjs is NOT edited to know about sast.scan.
//
//   REGISTERED ≠ TRUSTED — the SAME ledger scored under a policy that does NOT register `sast.scan`
//     earns ZERO for that attestation AND records it LEGIBLY as unregistered (registered:false), rather
//     than silently mixing it in as a normal check. Registration is necessary for credit; absence of
//     registration is surfaced, not swallowed.
//
//   v1 FALLBACK — a v1-shaped policy (no nodeKinds / no per-check category+weights) scores IDENTICALLY
//     to the shipped v2 policy whose values mirror the historical constants. This is the backward-compat
//     guarantee the resolver's per-field fallback provides.
//
// All policies are INJECTED via buildTrust({ policyPath }) into a sandbox ledger. The real
// verifier.policy.json is NEVER mutated.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalizeForHash } from "../../ledger/scripts/canonicalize.mjs";
import { buildTrust } from "../scripts/build-trust.mjs";

// --- crypto + event helpers (mirror the validator/ledger canonicalization exactly) ---
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

let RK, AK;
before(() => { RK = genKeyPair(); AK = genKeyPair(); });

// A sandbox that takes an explicit policy object + an explicit repo profile. The attestor node is an
// `attestor` kind; the release repo node is a `registry` kind (so the release event is repo-bound).
function sandbox(events, { policy, profile } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-cap-"));
  const nodesDir = path.join(dir, "nodes");
  const profilesDir = path.join(dir, "profiles");
  const registryDir = path.join(dir, "registry");
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(registryDir, { recursive: true });

  const nodes = [
    nodeManifest(RELEASE, "registry", "rel-key", RK.publicKey),
    nodeManifest(ATTESTOR, "attestor", "att-key", AK.publicKey),
  ];
  for (const n of nodes) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }

  if (profile) {
    fs.writeFileSync(path.join(profilesDir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
    const [org, repo] = RELEASE.split("/");
    fs.writeFileSync(path.join(nodesDir, org, repo, "repomesh.profile.json"),
      JSON.stringify({ profileId: profile.id }, null, 2));
  }

  const policyPath = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));

  const ledgerPath = path.join(dir, "events.jsonl");
  fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  return { run: () => buildTrust({ ledgerPath, nodesDir, profilesDir, registryDir, policyPath, write: false }) };
}

function entryFor(out) { return out.find((e) => e.repo === RELEASE && e.version === "1.0.0"); }

// A profile that requires ONLY sast.scan as the assurance check (so the scored assurance set is exactly
// {sast.scan} and its raw points are unambiguous). Integrity required-checks are the intrinsic three.
const SAST_PROFILE = {
  id: "sast-strict", version: "1.0.0",
  requiredChecks: { integrity: ["signed", "hasArtifacts", "noPolicyViolations"], assurance: ["sast.scan"] },
};

// A v2 policy that REGISTERS the new check kind sast.scan as an assurance check, trusted-set {ATTESTOR}.
function v2PolicyWithSast() {
  return {
    v: 2,
    nodeKinds: {
      attestor: { canSign: ["AttestationPublished"] },
      registry: { canSign: ["AttestationPublished", "PolicyViolation"] },
      policy: { canSign: ["PolicyViolation"] },
    },
    scoreableResults: ["pass", "warn", "fail"],
    trustedAttestors: [ATTESTOR, RELEASE],
    trustedPolicy: [RELEASE],
    checks: {
      "sast.scan": {
        category: "assurance",
        weights: { pass: 25, warn: 10, fail: 0 },
        mode: "trusted-set",
        trustedNodes: [ATTESTOR],
        quorum: 1,
        conflictPolicy: "fail-wins",
      },
    },
  };
}

// The SAME policy shape but WITHOUT sast.scan registered (an empty checks map → sast.scan is unknown).
// nodeKinds still present so the attestation event still verifies (registered≠trusted is about the
// CHECK kind, not the node-kind permission).
function v2PolicyWithoutSast() {
  return {
    v: 2,
    nodeKinds: {
      attestor: { canSign: ["AttestationPublished"] },
      registry: { canSign: ["AttestationPublished", "PolicyViolation"] },
      policy: { canSign: ["PolicyViolation"] },
    },
    scoreableResults: ["pass", "warn", "fail"],
    trustedAttestors: [ATTESTOR, RELEASE],
    trustedPolicy: [RELEASE],
    checks: {},
  };
}

function sastPassAttestation() {
  return sign(attestation(
    [{ type: "sast.scan", uri: "repomesh:attestor:sast.scan:pass" }],
    { notes: "sast.scan: pass — no SAST findings" }
  ), "att-key", AK.privateKey);
}

// ---------------------------------------------------------------------------
// NEW CAPABILITY — a registered, trusted new check kind earns its configured weight
// ---------------------------------------------------------------------------
describe("#7 NEW CAPABILITY: a policy-registered new check kind (sast.scan) is scored (no code change)", () => {
  it("a trusted `pass` of the REGISTERED sast.scan earns its configured weight (25)", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const out = sandbox([rel, sastPassAttestation()], { policy: v2PolicyWithSast(), profile: SAST_PROFILE }).run();
    const e = entryFor(out);
    assert.ok(e, "release must be scored");

    // The RAW points for sast.scan must be exactly the configured pass weight, 25 — read straight from
    // the policy via the resolver, NOT from any hardcoded table in build-trust.
    const sast = e.assuranceBreakdown["sast.scan"];
    assert.ok(sast, "sast.scan must appear in the assurance breakdown");
    assert.equal(sast.result, "pass", "the trusted sast.scan consensus must be pass");
    assert.equal(sast.points, 25,
      "a registered, trusted sast.scan `pass` must earn its configured weight (25) — proving the weight " +
      "came from the policy, not a hardcoded table\n" + JSON.stringify(e.assuranceBreakdown, null, 2));
    assert.equal(sast.max, 25, "sast.scan max must be its configured pass weight (25)");

    // It is a COMPLETED check (a real, scoreable pass), and it is recorded as REGISTERED.
    assert.ok(e.completedChecks.includes("sast.scan"), "sast.scan pass must be a completed check");
    const src = e.assuranceConsensus?.["sast.scan"];
    assert.ok(src, "sast.scan must have an assuranceConsensus entry");
    assert.notEqual(src.registered, false,
      "a REGISTERED check must NOT be flagged registered:false\n" + JSON.stringify(src, null, 2));
    assert.equal(src.consensus, "pass", "registered+trusted sast.scan consensus must be pass");
  });
});

// ---------------------------------------------------------------------------
// REGISTERED ≠ TRUSTED — the SAME attestation, but the kind is NOT registered, earns 0 and is flagged
// ---------------------------------------------------------------------------
describe("#7 REGISTERED ≠ TRUSTED: an UNregistered check earns 0 AND is recorded legibly", () => {
  it("a sast.scan attestation under a policy that does NOT register sast.scan earns 0", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    // Profile still REQUIRES sast.scan, so we can see whether it was credited. Policy does NOT register it.
    const out = sandbox([rel, sastPassAttestation()], { policy: v2PolicyWithoutSast(), profile: SAST_PROFILE }).run();
    const e = entryFor(out);
    assert.ok(e, "release must be scored");

    // An UNregistered kind earns ZERO BY CONSTRUCTION: no weight is resolved for it, so it does NOT
    // appear in assuranceBreakdown (which holds only SCORED checks) and contributes nothing.
    assert.equal(e.assuranceBreakdown["sast.scan"], undefined,
      "an UNregistered sast.scan must NOT be scored (absent from the scored breakdown), earning 0\n" +
      JSON.stringify(e.assuranceBreakdown, null, 2));
    // Assurance axis earns nothing from the unregistered check.
    assert.equal(e.assuranceScore, 0,
      "an unregistered check must not contribute to the assurance score");
    // It is NOT a completed check and IS reported missing — never silently credited as completed.
    assert.ok(!e.completedChecks.includes("sast.scan"),
      "an unregistered `pass` attestation must NOT be counted as a completed check");
    assert.ok(e.missingChecks.includes("sast.scan"),
      "a required-but-unregistered check must be reported MISSING\n" + JSON.stringify(e.missingChecks));
  });

  it("the unregistered attestation is recorded LEGIBLY as registered:false (not silently mixed in)", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const out = sandbox([rel, sastPassAttestation()], { policy: v2PolicyWithoutSast(), profile: SAST_PROFILE }).run();
    const e = entryFor(out);

    const src = e.assuranceConsensus?.["sast.scan"];
    assert.ok(src, "the unregistered attestation must STILL be recorded as a source (legibility), not dropped");
    assert.equal(src.registered, false,
      "an UNregistered check's recorded source must be flagged registered:false so a consumer can see " +
      "the attestation exists but earned nothing because the kind is not registered\n" +
      JSON.stringify(src, null, 2));
    // The attestation's own sources are preserved (the node + result are visible), not erased.
    assert.ok((src.sources || []).some((s) => s.node === ATTESTOR),
      "the attesting node must remain visible on the unregistered source\n" + JSON.stringify(src, null, 2));
  });

  it("REGISTERED gives credit, UNREGISTERED does not — same ledger, only the policy differs", () => {
    // The decisive A/B: identical events, two policies. Registration is the ONLY difference, and it is
    // the difference between 25 points and 0 points. This is the contract's core invariant in one test.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const events = [rel, sastPassAttestation()];

    const registered = entryFor(sandbox(events, { policy: v2PolicyWithSast(), profile: SAST_PROFILE }).run());
    const unregistered = entryFor(sandbox(events, { policy: v2PolicyWithoutSast(), profile: SAST_PROFILE }).run());

    // Registered ⇒ scored at 25 and a completed check. Unregistered ⇒ unscored (absent from breakdown),
    // 0 assurance, missing — same events, the ONLY difference is policy registration.
    assert.equal(registered.assuranceBreakdown["sast.scan"].points, 25, "registered ⇒ 25");
    assert.equal(registered.assuranceScore, 100, "registered, sole assurance check at pass ⇒ 25 scaled to 100");
    assert.equal(unregistered.assuranceBreakdown["sast.scan"], undefined, "unregistered ⇒ not scored");
    assert.equal(unregistered.assuranceScore, 0, "unregistered ⇒ 0 assurance");
    assert.ok(registered.completedChecks.includes("sast.scan"), "registered ⇒ completed");
    assert.ok(unregistered.missingChecks.includes("sast.scan"), "unregistered ⇒ missing");
    // Legibility: the registered kind carries no registered:false flag; the unregistered one does.
    assert.notEqual(registered.assuranceConsensus["sast.scan"].registered, false, "registered ⇒ not flagged");
    assert.equal(unregistered.assuranceConsensus["sast.scan"].registered, false, "unregistered ⇒ flagged false");
  });

  it("credit for a REGISTERED kind (sast.scan) is unchanged by the registered-flag plumbing", () => {
    // Guard: introducing registered:false on unregistered sources must not perturb a registered kind's
    // normal scoring or its consensus/source rendering.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const e = entryFor(sandbox([rel, sastPassAttestation()], { policy: v2PolicyWithSast(), profile: SAST_PROFILE }).run());
    const src = e.assuranceConsensus["sast.scan"];
    assert.equal(src.consensus, "pass");
    assert.equal(src.sourceCount, 1);
    assert.equal(src.sources[0].node, ATTESTOR);
    assert.equal(src.sources[0].result, "pass");
  });
});

// ---------------------------------------------------------------------------
// v1 FALLBACK — a v1-shaped policy scores identically to the equivalent v2 policy
// ---------------------------------------------------------------------------
describe("#7 v1 FALLBACK: a v1 policy scores identically to v2 (per-field resolver fallback)", () => {
  // A v1 policy: NO nodeKinds, NO per-check category/weights, NO scoreableResults. Just the historical
  // checks map (mode/trustedNodes/quorum/conflictPolicy) the pre-#7 scorer already understood.
  function v1Policy() {
    const mk = () => ({ mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" });
    return {
      v: 1,
      trustedAttestors: [ATTESTOR, RELEASE],
      trustedPolicy: [RELEASE],
      checks: {
        "sbom.present": mk(), "provenance.present": mk(), "signature.chain": mk(),
        "license.audit": mk(), "security.scan": mk(), "repro.build": mk(),
      },
    };
  }
  // The v2 equivalent: nodeKinds + per-check category/weights matching the historical constants exactly.
  function v2Equivalent() {
    const assur = (pass, warn) => ({
      category: "assurance", weights: { pass, warn, fail: 0 },
      mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins",
    });
    const integ = (pass) => ({
      category: "integrity", weights: { pass }, attestorGated: true,
      mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins",
    });
    return {
      v: 2,
      nodeKinds: {
        attestor: { canSign: ["AttestationPublished"] },
        registry: { canSign: ["AttestationPublished", "PolicyViolation"] },
        policy: { canSign: ["PolicyViolation"] },
      },
      scoreableResults: ["pass", "warn", "fail"],
      trustedAttestors: [ATTESTOR, RELEASE],
      trustedPolicy: [RELEASE],
      checks: {
        "sbom.present": integ(20), "provenance.present": integ(20), "signature.chain": integ(15),
        "license.audit": assur(30, 15), "security.scan": assur(40, 20), "repro.build": assur(30, 15),
      },
    };
  }

  // A representative event set exercising integrity + assurance + a policy violation path.
  function richEvents() {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([
      { type: "sbom.present", uri: "repomesh:attestor:sbom.present:pass" },
      { type: "provenance.present", uri: "repomesh:attestor:provenance.present:pass" },
      { type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" },
      { type: "license.audit", uri: "repomesh:attestor:license.audit:pass" },
      { type: "security.scan", uri: "repomesh:attestor:security.scan:warn" },
      { type: "repro.build", uri: "repomesh:attestor:repro.build:pass" },
    ], {
      notes: [
        "sbom.present: pass — ok", "provenance.present: pass — ok", "signature.chain: pass — ok",
        "license.audit: pass — clean", "security.scan: warn — one moderate", "repro.build: pass — reproducible",
      ].join("\n"),
    }), "att-key", AK.privateKey);
    return [rel, att];
  }

  // Strip nondeterministic / not-relevant fields and compare the SCORING-bearing shape.
  function scoringShape(e) {
    return {
      integrityScore: e.integrityScore,
      assuranceScore: e.assuranceScore,
      trustScore: e.trustScore,
      verdict: e.verdict,
      completedChecks: [...e.completedChecks].sort(),
      missingChecks: [...e.missingChecks].sort(),
      assuranceBreakdown: e.assuranceBreakdown,
      attestations: [...e.attestations].sort((a, b) => a.kind.localeCompare(b.kind)),
    };
  }

  it("v1 policy and equivalent v2 policy produce IDENTICAL scoring", () => {
    const v1 = entryFor(sandbox(richEvents(), { policy: v1Policy() }).run());
    const v2 = entryFor(sandbox(richEvents(), { policy: v2Equivalent() }).run());
    assert.deepEqual(scoringShape(v1), scoringShape(v2),
      "a v1-shaped policy must score identically to the equivalent v2 policy (per-field resolver fallback)\n" +
      "v1: " + JSON.stringify(scoringShape(v1), null, 2) + "\nv2: " + JSON.stringify(scoringShape(v2), null, 2));
  });

  it("v1 and v2 integrity scores match the historical arithmetic exactly", () => {
    // base 45 (signed+artifacts+noPolicy) + sbom 20 + provenance 20 + signature.chain 15 = 100.
    const v1 = entryFor(sandbox(richEvents(), { policy: v1Policy() }).run());
    assert.equal(v1.integrityScore, 100, "all integrity check kinds pass ⇒ 100");
    const v2 = entryFor(sandbox(richEvents(), { policy: v2Equivalent() }).run());
    assert.equal(v2.integrityScore, 100, "v2 equivalent must match");
  });
});
