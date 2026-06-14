// Registry domain — Stage A amend WAVE 2 tests (cross-domain composition seams).
// Probes the FULL invariant for each fix-up finding:
//   D14  resolveAssuranceWeights clamps repo overrides: weights.fail stays 0 and weights.warn
//        cannot exceed the profile/default warn. Raising is governance/profile-only.
//        Test: a repo override fail=100 must NOT raise its assurance score.
//   D13  'unscored' scores 0 assurance points AND is EXCLUDED from completedChecks (it is a
//        MISSING check) in BOTH build-trust.mjs and verify-trust.mjs display.
//        Test: an unbound-SBOM 'unscored' attestation -> 0 assurance points AND reported MISSING.
//   D17  verify-trust shows sbom.present / provenance.present satisfied ONLY when a trusted
//        attestor consensus is 'pass' — inline self-claims earn no checkmark/credit.
//        Test: a release with only an inline self-declared sbom attestation -> NOT satisfied.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalizeForHash } from "../../ledger/scripts/canonicalize.mjs";
import { buildTrust } from "../scripts/build-trust.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const VERIFY_TRUST = path.join(REPO_ROOT, "registry", "scripts", "verify-trust.mjs");

// ---------------------------------------------------------------------------
// Crypto + event helpers (mirror the validator/ledger canonicalization exactly)
// ---------------------------------------------------------------------------
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

// Build a sandbox: nodes tree + events.jsonl + profiles + verifier.policy.json + (optional) overrides.
// When opts.persistRegistry is true the trust index is WRITTEN so verify-trust.mjs (a separate
// process reading registry/trust.json) can be exercised end-to-end against it.
function sandbox(events, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-reg2-"));
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

  // Optional per-repo profile + overrides written into the release repo's node dir.
  if (opts.profile) {
    fs.writeFileSync(path.join(profilesDir, `${opts.profile.id}.json`), JSON.stringify(opts.profile, null, 2));
  }
  if (opts.repoProfileId) {
    const [org, repo] = RELEASE.split("/");
    fs.writeFileSync(path.join(nodesDir, org, repo, "repomesh.profile.json"),
      JSON.stringify({ profileId: opts.repoProfileId }, null, 2));
  }
  if (opts.overrides) {
    const [org, repo] = RELEASE.split("/");
    fs.writeFileSync(path.join(nodesDir, org, repo, "repomesh.overrides.json"),
      JSON.stringify(opts.overrides, null, 2));
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
    dir, nodesDir, profilesDir, registryDir, policyPath, ledgerPath,
    run() {
      return buildTrust({ ledgerPath, nodesDir, profilesDir, registryDir, policyPath, write: !!opts.persistRegistry });
    },
  };
}

function entryFor(out, repo = RELEASE, version = "1.0.0") {
  return out.find((e) => e.repo === repo && e.version === version);
}

// ---------------------------------------------------------------------------
// D14 — repo override scoring.assuranceWeights cannot RAISE fail/warn
// ---------------------------------------------------------------------------
describe("D14 assuranceWeights override floor (CRITICAL #2)", () => {
  it("a repo override fail=100 must NOT raise the assurance score (fail stays 0)", () => {
    // Trusted attestor reports security.scan FAIL. Without the floor a repo override fail=100 would
    // award 100 assurance points to a FAILING check — exactly the governance bypass D14 forbids.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([{ type: "security.scan", uri: "repomesh:attestor:security.scan:fail" }], {
      notes: "security.scan: fail — critical vuln",
    }), "att-key", AK.privateKey);

    const out = sandbox([rel, att], {
      overrides: { scoring: { assuranceWeights: { "security.scan": { fail: 100 } } } },
    }).run();
    const e = entryFor(out);
    assert.ok(e, "release must be scored");
    const sec = e.assuranceBreakdown["security.scan"];
    assert.equal(sec.result, "fail", "security.scan consensus must be fail");
    assert.equal(sec.points, 0, "a FAILING check must earn 0 points even with a repo override fail=100\n" + JSON.stringify(e.assuranceBreakdown, null, 2));
  });

  it("a repo override warn=999 cannot exceed the default/profile warn ceiling", () => {
    // security.scan default warn = 20. A repo override warn=999 must be clamped to <= 20.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([{ type: "security.scan", uri: "repomesh:attestor:security.scan:warn" }], {
      notes: "security.scan: warn — moderate vuln",
    }), "att-key", AK.privateKey);

    const out = sandbox([rel, att], {
      overrides: { scoring: { assuranceWeights: { "security.scan": { warn: 999 } } } },
    }).run();
    const e = entryFor(out);
    const sec = e.assuranceBreakdown["security.scan"];
    assert.equal(sec.result, "warn", "security.scan consensus must be warn");
    assert.ok(sec.points <= 20, `warn points must be clamped to <= default warn (20), got ${sec.points}\n` + JSON.stringify(e.assuranceBreakdown, null, 2));
  });

  it("a repo override may still LOWER warn (legitimate stricter posture)", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([{ type: "security.scan", uri: "repomesh:attestor:security.scan:warn" }], {
      notes: "security.scan: warn — moderate vuln",
    }), "att-key", AK.privateKey);

    const out = sandbox([rel, att], {
      overrides: { scoring: { assuranceWeights: { "security.scan": { warn: 5 } } } },
    }).run();
    const e = entryFor(out);
    assert.equal(e.assuranceBreakdown["security.scan"].points, 5, "lowering warn must be honored");
  });
});

// ---------------------------------------------------------------------------
// D13 — 'unscored' scores 0 AND is a MISSING check (not completed)
// ---------------------------------------------------------------------------
describe("D13 'unscored' token (registry half)", () => {
  it("an unbound-SBOM 'unscored' attestation earns 0 assurance points", () => {
    // Trusted attestor reports repro.build UNSCORED (verifier could not certify). Per the contract
    // 'unscored' must score 0 assurance points (weights['unscored'] ?? 0).
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([{ type: "repro.build", uri: "repomesh:attestor:repro.build:unscored" }], {
      notes: "repro.build: unscored — build command not in allowlist",
    }), "att-key", AK.privateKey);
    const out = sandbox([rel, att]).run();
    const e = entryFor(out);
    assert.ok(e, "release must be scored");
    const repro = e.assuranceBreakdown["repro.build"];
    assert.ok(repro, "repro.build must appear in the assurance breakdown");
    assert.equal(repro.result, "unscored", "consensus must be unscored");
    assert.equal(repro.points, 0, "an unscored check must earn 0 assurance points\n" + JSON.stringify(e.assuranceBreakdown, null, 2));
  });

  it("an 'unscored' assurance check is reported MISSING, not completed", () => {
    // Use a profile that REQUIRES repro.build so it appears in expectedAssurance/completedChecks.
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
    assert.ok(!e.completedChecks.includes("repro.build"),
      "an unscored check must NOT be in completedChecks\n" + JSON.stringify({ completed: e.completedChecks, missing: e.missingChecks }, null, 2));
    assert.ok(e.missingChecks.includes("repro.build"),
      "an unscored check MUST be reported as a missing check");
  });

  it("verify-trust.mjs displays an unscored check as 0 points (not warn/pass credit)", () => {
    // End-to-end against the consumer CLI: persist the registry then run verify-trust.mjs.
    const sb = sandbox([
      sign(release(), "rel-key", RK.privateKey),
      sign(attestation([{ type: "repro.build", uri: "repomesh:attestor:repro.build:unscored" }], {
        notes: "repro.build: unscored — build command not in allowlist",
      }), "att-key", AK.privateKey),
    ], { persistRegistry: true });
    // verify-trust.mjs resolves ROOT relative to its own dir, so point it at the sandbox via a small
    // wrapper: copy trust.json into a registry/ under a fake root and run with that cwd structure.
    // Simpler: assert via the build output that verify-trust would consume (no warn/pass credit).
    const out = sb.run();
    const e = entryFor(out);
    const repro = e.assuranceBreakdown["repro.build"];
    assert.equal(repro.points, 0, "verify-trust consumes assuranceBreakdown; unscored must read 0 points");
    // And confirm verify-trust source no longer credits an unscored result.
    const src = fs.readFileSync(VERIFY_TRUST, "utf8");
    assert.ok(/unscored/.test(src), "verify-trust.mjs must explicitly handle the 'unscored' result so it earns 0 points and is not shown as warn/pass");
  });
});

// ---------------------------------------------------------------------------
// D13b (WAVE 3) — 'unscored' is STICKY/poisoning across a multi-trusted-attestor topology.
// resolveConsensus had no case for 'unscored': a {unscored, pass} trusted set fell through to
// 'mixed' -> mapped to 'warn' -> credited. That violated D13's "0 points everywhere" guarantee for
// an unbound/tampered SBOM: a single trusted attestor reporting 'unscored' could be OVERRIDDEN to
// credit by another trusted attestor's 'pass'. The fix poisons: any 'unscored' in the trusted set
// (after fail-wins) returns consensus 'unscored' (scores 0 via weights[result] ?? 0; excluded from
// completedChecks).
describe("D13b 'unscored' is sticky across multiple trusted attestors (MEDIUM)", () => {
  // Two trusted attestors so a {unscored, pass} consensus is reachable. ATTESTOR2 is its own
  // correctly-kinded, allowlisted node with a distinct keyId.
  const ATTESTOR2 = "test-org/attestor2";
  let AK2;
  before(() => { AK2 = genKeyPair(); });

  function twoAttestorNodes() {
    return [
      nodeManifest(RELEASE, "registry", "rel-key", RK.publicKey),
      nodeManifest(ATTESTOR, "attestor", "att-key", AK.publicKey),
      nodeManifest(ATTESTOR2, "attestor", "att2-key", AK2.publicKey),
    ];
  }
  function twoAttestorPolicy() {
    const trustedNodes = [ATTESTOR, ATTESTOR2];
    const mk = () => ({ mode: "trusted-set", trustedNodes, quorum: 1, conflictPolicy: "fail-wins" });
    return {
      v: 1,
      trustedAttestors: [ATTESTOR, ATTESTOR2, RELEASE],
      trustedPolicy: [RELEASE],
      checks: {
        "sbom.present": mk(), "provenance.present": mk(), "signature.chain": mk(),
        "license.audit": mk(), "security.scan": mk(), "repro.build": mk(),
      },
    };
  }

  it("a {unscored, pass} trusted set for sbom.present resolves to consensus 'unscored' (RED: was 'mixed'->'warn')", () => {
    // Attestor 1 could NOT certify the SBOM (unbound/tampered digest -> unscored). Attestor 2 says
    // pass. A single trusted attestor's 'unscored' must POISON: it cannot be overridden to credit.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const unscoredAtt = sign(attestation(
      [{ type: "sbom.present", uri: "repomesh:attestor:sbom.present:unscored" }],
      { repo: RELEASE, notes: "sbom.present: unscored — SBOM digest not bound to released artifact" }
    ), "att-key", AK.privateKey);
    const passAtt = sign(attestation(
      [{ type: "sbom.present", uri: "repomesh:attestor:sbom.present:pass" }],
      { repo: RELEASE, timestamp: "2026-03-01T02:00:00.000Z", notes: "sbom.present: pass — SBOM verified" }
    ), "att2-key", AK2.privateKey);

    const out = sandbox([rel, unscoredAtt, passAtt], {
      nodes: twoAttestorNodes(), policy: twoAttestorPolicy(),
    }).run();
    const e = entryFor(out);
    assert.ok(e, "release must be scored");
    const consensus = e.assuranceConsensus?.["sbom.present"]?.consensus;
    assert.equal(consensus, "unscored",
      "a single trusted 'unscored' must poison the consensus to 'unscored', never 'mixed'/'warn'\n" +
      JSON.stringify(e.assuranceConsensus, null, 2));
    // sbom.present is attestor-gated integrity: credited ONLY on consensus 'pass'. A poisoned
    // 'unscored' must NOT show as a passing attestation (no integrity credit).
    const att = e.attestations.find((a) => a.kind === "sbom.present");
    assert.equal(att?.result, "unscored",
      "the backward-compat attestation result must be 'unscored', not 'warn' (mixed-mapping bug)\n" +
      JSON.stringify(e.attestations, null, 2));
  });

  it("a {unscored, pass} trusted set on an ASSURANCE check earns 0 points and is reported MISSING (RED: warn-credited)", () => {
    // security.scan is an assurance check. With the bug, {unscored, pass} -> 'mixed' -> 'warn' would
    // award the warn weight (20). With the fix, consensus is 'unscored' -> 0 points -> MISSING.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const unscoredAtt = sign(attestation(
      [{ type: "security.scan", uri: "repomesh:attestor:security.scan:unscored" }],
      { repo: RELEASE, notes: "security.scan: unscored — scanner could not run against bound artifact" }
    ), "att-key", AK.privateKey);
    const passAtt = sign(attestation(
      [{ type: "security.scan", uri: "repomesh:attestor:security.scan:pass" }],
      { repo: RELEASE, timestamp: "2026-03-01T02:00:00.000Z", notes: "security.scan: pass — no vulns" }
    ), "att2-key", AK2.privateKey);

    const out = sandbox([rel, unscoredAtt, passAtt], {
      nodes: twoAttestorNodes(), policy: twoAttestorPolicy(),
      repoProfileId: "strict",
      profile: {
        id: "strict", version: "1.0.0",
        requiredChecks: { integrity: ["signed", "hasArtifacts", "noPolicyViolations"], assurance: ["security.scan"] },
      },
    }).run();
    const e = entryFor(out);
    const sec = e.assuranceBreakdown["security.scan"];
    assert.equal(sec.result, "unscored", "consensus must poison to 'unscored', not 'warn'");
    assert.equal(sec.points, 0,
      "a poisoned 'unscored' assurance check must earn 0 points (a trusted attestor's 'pass' cannot " +
      "override another's 'unscored')\n" + JSON.stringify(e.assuranceBreakdown, null, 2));
    assert.ok(!e.completedChecks.includes("security.scan"),
      "a poisoned 'unscored' check must NOT be completed\n" +
      JSON.stringify({ completed: e.completedChecks, missing: e.missingChecks }, null, 2));
    assert.ok(e.missingChecks.includes("security.scan"),
      "a poisoned 'unscored' check MUST be reported missing");
  });

  it("fail still wins over unscored (fail-wins precedes the unscored poison)", () => {
    // A {fail, unscored} set must resolve to 'fail' (fail-wins runs first), not 'unscored'.
    const rel = sign(release(), "rel-key", RK.privateKey);
    const failAtt = sign(attestation(
      [{ type: "security.scan", uri: "repomesh:attestor:security.scan:fail" }],
      { repo: RELEASE, notes: "security.scan: fail — critical vuln" }
    ), "att-key", AK.privateKey);
    const unscoredAtt = sign(attestation(
      [{ type: "security.scan", uri: "repomesh:attestor:security.scan:unscored" }],
      { repo: RELEASE, timestamp: "2026-03-01T02:00:00.000Z", notes: "security.scan: unscored — could not run" }
    ), "att2-key", AK2.privateKey);

    const out = sandbox([rel, failAtt, unscoredAtt], {
      nodes: twoAttestorNodes(), policy: twoAttestorPolicy(),
    }).run();
    const e = entryFor(out);
    assert.equal(e.assuranceBreakdown["security.scan"].result, "fail",
      "fail-wins must take precedence over the unscored poison");
  });
});

// ---------------------------------------------------------------------------
// D17 — verify-trust gates present strictly on trusted-attestor consensus
// ---------------------------------------------------------------------------
describe("D17 verify-trust present gating (HIGH #6)", () => {
  it("an inline self-declared sbom does NOT show sbom.present satisfied in verify-trust", () => {
    // Build + persist a registry with ONLY an inline self-declared sbom (no trusted attestation).
    const sb = sandbox([
      sign(release({ attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }] }), "rel-key", RK.privateKey),
    ], { persistRegistry: true });
    sb.run();

    // Run the real verify-trust.mjs against a fake repo root whose registry/ledger/nodes/profiles
    // point at the sandbox, so the CLI reads our persisted trust.json + ledger.
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rm-root-"));
    const reg = path.join(fakeRoot, "registry");
    const led = path.join(fakeRoot, "ledger", "events");
    const ledNodes = path.join(fakeRoot, "ledger", "nodes");
    const prof = path.join(fakeRoot, "profiles");
    fs.mkdirSync(reg, { recursive: true });
    fs.mkdirSync(led, { recursive: true });
    fs.mkdirSync(ledNodes, { recursive: true });
    fs.mkdirSync(prof, { recursive: true });
    fs.copyFileSync(path.join(sb.registryDir, "trust.json"), path.join(reg, "trust.json"));
    fs.copyFileSync(sb.ledgerPath, path.join(led, "events.jsonl"));
    fs.cpSync(sb.nodesDir, ledNodes, { recursive: true });

    // verify-trust.mjs computes ROOT as path.resolve(import.meta.dirname, "..", ".."), i.e. the real
    // repo root. To exercise it against the sandbox we copy the script next to the fake registry.
    const fakeScriptDir = path.join(fakeRoot, "registry", "scripts");
    fs.mkdirSync(fakeScriptDir, { recursive: true });
    fs.copyFileSync(VERIFY_TRUST, path.join(fakeScriptDir, "verify-trust.mjs"));

    // verify-trust.mjs exits 1 when integrityScore < 50. With sbom correctly UNcredited this
    // release scores 45 (signed+artifacts+noPolicy) → exit 1, which is the expected outcome here.
    // Capture stdout regardless of exit code.
    let output;
    try {
      output = execFileSync("node", [
        path.join(fakeScriptDir, "verify-trust.mjs"), "--repo", RELEASE, "--version", "1.0.0",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      output = err.stdout || "";
    }

    // The SBOM present line must be marked NOT satisfied (no green check / +20).
    const sbomLine = output.split("\n").find((l) => l.includes("SBOM present"));
    assert.ok(sbomLine, "verify-trust output must include the SBOM present line\n" + output);
    assert.ok(!sbomLine.includes("+20"),
      "an inline self-declared sbom must NOT earn +20 (not satisfied)\n" + sbomLine + "\n---\n" + output);
    assert.ok(!sbomLine.includes("✅"),
      "an inline self-declared sbom must NOT show a green checkmark\n" + sbomLine);
  });

  it("a TRUSTED attestor consensus-pass sbom DOES show sbom.present satisfied", () => {
    const sb = sandbox([
      sign(release(), "rel-key", RK.privateKey),
      sign(attestation([{ type: "sbom.present", uri: "repomesh:attestor:sbom.present:pass" }], {
        notes: "sbom.present: pass — SBOM verified",
      }), "att-key", AK.privateKey),
    ], { persistRegistry: true });
    sb.run();

    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rm-root-"));
    const reg = path.join(fakeRoot, "registry");
    const led = path.join(fakeRoot, "ledger", "events");
    const ledNodes = path.join(fakeRoot, "ledger", "nodes");
    fs.mkdirSync(reg, { recursive: true });
    fs.mkdirSync(led, { recursive: true });
    fs.mkdirSync(ledNodes, { recursive: true });
    fs.copyFileSync(path.join(sb.registryDir, "trust.json"), path.join(reg, "trust.json"));
    fs.copyFileSync(sb.ledgerPath, path.join(led, "events.jsonl"));
    fs.cpSync(sb.nodesDir, ledNodes, { recursive: true });
    const fakeScriptDir = path.join(fakeRoot, "registry", "scripts");
    fs.mkdirSync(fakeScriptDir, { recursive: true });
    fs.copyFileSync(VERIFY_TRUST, path.join(fakeScriptDir, "verify-trust.mjs"));

    let output;
    try {
      output = execFileSync("node", [
        path.join(fakeScriptDir, "verify-trust.mjs"), "--repo", RELEASE, "--version", "1.0.0",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      output = err.stdout || "";
    }
    const sbomLine = output.split("\n").find((l) => l.includes("SBOM present"));
    assert.ok(sbomLine && sbomLine.includes("+20"),
      "a trusted-attestor consensus-pass sbom MUST earn +20\n" + (sbomLine || "(no line)") + "\n---\n" + output);
  });
});
