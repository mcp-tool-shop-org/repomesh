// RepoMesh — Trio Phase 1 (GAPS §3 PR 3):
//   Part 1: Run event attestation types (run.preregistered, run.outcome, cognate.root.anchored)
//           and cross-event enforcement that run.outcome references a prior run.preregistered.
//   Part 2: The `governance` attestor kind in verifier.policy.json (scoped to run types, not releases),
//           the three ATTESTOR_KINDS lists kept in step (remote-defaults.mjs, validate-ledger.mjs,
//           build-trust.mjs), and mcp-tool-shop-org/cognate trusted only for run types (D12 narrow ceiling).
//   Part 3: Explicit Ed25519 signing contract (raw 32-byte Buffer.from(canonicalHash, "hex"),
//           never UTF-8 canonical JSON or 64-byte ASCII hex) + LDG-006 contact check.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalizeForHash } from "../scripts/canonicalize.mjs";
import * as remoteDefaults from "../../packages/repomesh-cli/src/remote-defaults.mjs";
import * as policyLib from "../../verifiers/lib/policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const VALIDATOR = path.join(HERE, "..", "scripts", "validate-ledger.mjs");
const BUILD_TRUST_PATH = path.join(REPO_ROOT, "registry", "scripts", "build-trust.mjs");
const TOOLS_VERIFY_PATH = path.join(REPO_ROOT, "tools", "verify-release.mjs");
const EVENT_SCHEMA_PATH = path.join(REPO_ROOT, "schemas", "event.schema.json");
const CLI_EVENT_SCHEMA_PATH = path.join(REPO_ROOT, "packages", "repomesh-cli", "schemas", "event.schema.json");
const SHIPPED_POLICY_PATH = path.join(REPO_ROOT, "verifier.policy.json");

function genKeyPair() {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function stripSig(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.signature;
  return copy;
}

function computeCanonicalHash(ev) {
  const canonical = canonicalizeForHash(stripSig(ev));
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function signRaw32Bytes(ev, keyId, privateKey) {
  const unsigned = stripSig(ev);
  const hash = computeCanonicalHash(unsigned);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  return {
    ...unsigned,
    signature: { alg: "ed25519", keyId, value: sig.toString("base64"), canonicalHash: hash },
  };
}

function signUtf8CanonicalJson(ev, keyId, privateKey) {
  const unsigned = stripSig(ev);
  const canonicalJson = canonicalizeForHash(unsigned);
  const hash = crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  // Footgun (New 1): signing UTF-8 canonical JSON bytes instead of the raw 32-byte digest.
  const sig = crypto.sign(null, Buffer.from(canonicalJson, "utf8"), privateKey);
  return {
    ...unsigned,
    signature: { alg: "ed25519", keyId, value: sig.toString("base64"), canonicalHash: hash },
  };
}

function signAsciiHexDigest(ev, keyId, privateKey) {
  const unsigned = stripSig(ev);
  const hash = computeCanonicalHash(unsigned);
  // Footgun: signing the 64-byte ASCII hex string instead of Buffer.from(hash, "hex").
  const sig = crypto.sign(null, Buffer.from(hash, "utf8"), privateKey);
  return {
    ...unsigned,
    signature: { alg: "ed25519", keyId, value: sig.toString("base64"), canonicalHash: hash },
  };
}

function nodeManifest(id, kind, keyId, pubPem, contact = "64996768+mcp-tool-shop@users.noreply.github.com") {
  return {
    id,
    kind,
    description: `${kind} node for run-event tests`,
    provides: [`${kind}.test.v1`],
    consumes: [],
    interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
    invariants: { deterministicBuild: true, signedReleases: true, semver: true, changelog: true },
    maintainers: [{ name: "tester", keyId, publicKey: pubPem.trim(), contact }],
    tags: ["test"],
  };
}

function sandbox(events, { nodes, policy } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-p1-run-"));
  const nodesDir = path.join(dir, "nodes");
  const manifestsDir = path.join(dir, "manifests");
  const eventsPath = path.join(dir, "events.jsonl");
  fs.mkdirSync(manifestsDir, { recursive: true });

  for (const n of nodes) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }

  fs.writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  const env = {
    ...process.env,
    REPOMESH_NODES_PATH: nodesDir,
    REPOMESH_MANIFESTS_PATH: manifestsDir,
    HEAD_LEDGER: eventsPath,
  };
  if (policy) {
    const policyPath = path.join(dir, "verifier.policy.json");
    fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));
    env.REPOMESH_VERIFIER_POLICY_PATH = policyPath;
  }

  function run(extraEnv = {}) {
    const res = spawnSync("node", [VALIDATOR], {
      env: { ...env, ...extraEnv },
      encoding: "utf8",
    });
    return { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
  }

  return { dir, nodesDir, eventsPath, run };
}

let COGNATE_KEYS;
let RELEASE_KEYS;
let ATTESTOR_KEYS;

before(() => {
  COGNATE_KEYS = genKeyPair();
  RELEASE_KEYS = genKeyPair();
  ATTESTOR_KEYS = genKeyPair();
});

const PREREG_HASH = "1".repeat(64);
const OUTCOME_HASH = "2".repeat(64);
const ROOT_HASH = "3".repeat(64);
const COMMIT_SHA = "22c036bb7552cabdc8fe2f80fc909b1fd4ce8385";

function makePreregEvent(runId = "19s", preregHash = PREREG_HASH, overrides = {}) {
  return {
    type: "AttestationPublished",
    repo: "mcp-tool-shop-org/cognate",
    version: `0.0.0-run-${runId}-prereg`,
    commit: COMMIT_SHA,
    timestamp: new Date(Date.now() - 120_000).toISOString(),
    artifacts: [
      {
        name: "attestia-run-preregistered.json",
        sha256: preregHash,
        uri: `urn:attestia:event:cognate-prereg-${runId}`,
      },
    ],
    attestations: [
      {
        type: "run.preregistered",
        uri: `urn:cognate:run:prereg:${runId}`,
        sha256: preregHash,
      },
    ],
    notes: `Cognate run ${runId} pre-registered; attestia=${preregHash}`,
    ...overrides,
  };
}

function makeOutcomeEvent(runId = "19s", outcomeHash = OUTCOME_HASH, preregHash = PREREG_HASH, overrides = {}) {
  return {
    type: "AttestationPublished",
    repo: "mcp-tool-shop-org/cognate",
    version: `0.0.0-run-${runId}-outcome`,
    commit: COMMIT_SHA,
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    artifacts: [
      {
        name: "attestia-run-completed.json",
        sha256: outcomeHash,
        uri: `urn:attestia:event:cognate-outcome-${runId}`,
      },
    ],
    attestations: [
      {
        type: "run.outcome",
        uri: `urn:cognate:run:outcome:${runId}`,
        sha256: outcomeHash,
      },
    ],
    notes: `Cognate run ${runId} outcome=failure (val_loss_exceeded); prereg=${preregHash}; attestia=${outcomeHash}`,
    ...overrides,
  };
}

function makeRootAnchoredEvent(partitionId = "cognate-runs-2026-03-19", rootHash = ROOT_HASH, overrides = {}) {
  return {
    type: "AttestationPublished",
    repo: "mcp-tool-shop-org/cognate",
    version: `0.0.0-root-${partitionId}`,
    commit: COMMIT_SHA,
    timestamp: new Date(Date.now() - 30_000).toISOString(),
    artifacts: [
      {
        name: "cognate-merkle-root.json",
        sha256: rootHash,
        uri: `urn:attestia:merkle:root:${partitionId}`,
      },
    ],
    attestations: [
      {
        type: "cognate.root.anchored",
        uri: `urn:cognate:root:anchored:${partitionId}`,
        sha256: rootHash,
      },
    ],
    notes: `Cognate Merkle root anchored; partition=${partitionId}; root=${rootHash}`,
    ...overrides,
  };
}

// ===========================================================================
// Part 1 — Run event types (run.preregistered, run.outcome, cognate.root.anchored)
// ===========================================================================

describe("Part 1: run event attestation types and outcome-to-preregistration link", () => {
  it("schemas/event.schema.json (and CLI mirror) allow run.preregistered, run.outcome, cognate.root.anchored and require sha256 + structured URIs on them", () => {
    const rootRaw = fs.readFileSync(EVENT_SCHEMA_PATH, "utf8");
    const cliRaw = fs.readFileSync(CLI_EVENT_SCHEMA_PATH, "utf8");
    assert.equal(rootRaw, cliRaw, "root and CLI event.schema.json must be byte-identical");

    const schema = JSON.parse(rootRaw);
    const enumTypes = schema.$defs.attestation.properties.type.enum;
    for (const t of ["run.preregistered", "run.outcome", "cognate.root.anchored"]) {
      assert.ok(enumTypes.includes(t), `event.schema.json must include attestation type "${t}"`);
    }

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const validPrereg = signRaw32Bytes(makePreregEvent(), "ci-cognate-2026", COGNATE_KEYS.privateKey);
    const validOutcome = signRaw32Bytes(makeOutcomeEvent(), "ci-cognate-2026", COGNATE_KEYS.privateKey);
    const validRoot = signRaw32Bytes(makeRootAnchoredEvent(), "ci-cognate-2026", COGNATE_KEYS.privateKey);
    assert.ok(validate(validPrereg), "valid run.preregistered must pass schema");
    assert.ok(validate(validOutcome), "valid run.outcome must pass schema");
    assert.ok(validate(validRoot), "valid cognate.root.anchored must pass schema");

    // Missing sha256 on any of the three run attestation types must be rejected by the schema.
    for (const t of ["run.preregistered", "run.outcome", "cognate.root.anchored"]) {
      const missingHash = signRaw32Bytes(
        makePreregEvent("19s", PREREG_HASH, {
          attestations: [{ type: t, uri: t === "run.preregistered" ? "urn:cognate:run:prereg:19s" : t === "run.outcome" ? "urn:cognate:run:outcome:19s" : "urn:cognate:root:anchored:p1" }],
        }),
        "ci-cognate-2026",
        COGNATE_KEYS.privateKey,
      );
      assert.ok(!validate(missingHash), `${t} without sha256 must fail schema validation`);
    }
  });

  it("Phase 0 replay flow: accepts run.preregistered followed by run.outcome and cognate.root.anchored signed by mcp-tool-shop-org/cognate under the shipped policy", () => {
    const prereg = signRaw32Bytes(makePreregEvent("19s"), "ci-cognate-2026", COGNATE_KEYS.privateKey);
    const outcome = signRaw32Bytes(makeOutcomeEvent("19s"), "ci-cognate-2026", COGNATE_KEYS.privateKey);
    const rootAnchored = signRaw32Bytes(makeRootAnchoredEvent("cognate-runs-2026-03-19"), "ci-cognate-2026", COGNATE_KEYS.privateKey);

    const nodes = [
      nodeManifest("mcp-tool-shop-org/cognate", "governance", "ci-cognate-2026", COGNATE_KEYS.publicKey),
    ];
    const sb = sandbox([prereg, outcome, rootAnchored], { nodes });
    const r = sb.run();
    assert.equal(r.code, 0, "Phase 0 prereg + outcome + root.anchored must pass validate-ledger\n" + r.out + r.err);
    assert.match(r.out, /All 3 event\(s\) validated/);
  });

  it("REFUSES a malformed run.outcome that has no prior run.preregistered for the same runId", () => {
    const orphanOutcome = signRaw32Bytes(makeOutcomeEvent("orphan-99"), "ci-cognate-2026", COGNATE_KEYS.privateKey);
    const nodes = [
      nodeManifest("mcp-tool-shop-org/cognate", "governance", "ci-cognate-2026", COGNATE_KEYS.publicKey),
    ];
    const sb = sandbox([orphanOutcome], { nodes });
    const r = sb.run();
    assert.equal(r.code, 1, "orphan run.outcome without prior run.preregistered must be refused\n" + r.out + r.err);
    assert.match(
      r.err + r.out,
      /run\.outcome.*orphan-99.*no prior run\.preregistered|pre-registration/i,
      "error message must explain missing prior run.preregistered",
    );
  });

  it("REFUSES a run.outcome whose pre-registration hash link does not match the prior run.preregistered sha256", () => {
    const prereg = signRaw32Bytes(makePreregEvent("19s", PREREG_HASH), "ci-cognate-2026", COGNATE_KEYS.privateKey);
    const wrongPreregHash = "f".repeat(64);
    const mismatchedOutcome = signRaw32Bytes(
      makeOutcomeEvent("19s", OUTCOME_HASH, wrongPreregHash),
      "ci-cognate-2026",
      COGNATE_KEYS.privateKey,
    );
    const nodes = [
      nodeManifest("mcp-tool-shop-org/cognate", "governance", "ci-cognate-2026", COGNATE_KEYS.publicKey),
    ];
    const sb = sandbox([prereg, mismatchedOutcome], { nodes });
    const r = sb.run();
    assert.equal(r.code, 1, "run.outcome with mismatched prereg hash must be refused\n" + r.out + r.err);
    assert.match(
      r.err + r.out,
      /pre-registration hash|prereg.*mismatch|does not match/i,
      "error message must identify pre-registration hash mismatch",
    );
  });
});

// ===========================================================================
// Part 2 — The `governance` attestor kind, drift guard, and scoped trust
// ===========================================================================

describe("Part 2: governance attestor kind and attestor-kind drift guard", () => {
  it("verifier.policy.json grants `governance` only the three run attestation types and scopes mcp-tool-shop-org/cognate to them", () => {
    const policy = JSON.parse(fs.readFileSync(SHIPPED_POLICY_PATH, "utf8"));
    assert.ok(policy.nodeKinds?.governance, "verifier.policy.json must define nodeKinds.governance");
    assert.deepEqual(
      [...policy.nodeKinds.governance.canSign].sort(),
      ["cognate.root.anchored", "run.outcome", "run.preregistered"],
      "governance may only sign the three run attestation types, not releases",
    );
    assert.ok(
      policy.trustedAttestors.includes("mcp-tool-shop-org/cognate"),
      "mcp-tool-shop-org/cognate must be in verifier.policy.json trustedAttestors",
    );
    assert.deepEqual(
      policy.trustedRunAttestors,
      ["mcp-tool-shop-org/cognate"],
      "trustedRunAttestors must scope mcp-tool-shop-org/cognate to run attestation types",
    );
  });

  it("keeps the three ATTESTOR_KINDS lists in step (remote-defaults.mjs, validate-ledger.mjs, build-trust.mjs, plus tools/verify-release.mjs)", async () => {
    const validateLedgerMod = await import("../scripts/validate-ledger.mjs");
    const buildTrustMod = await import("../../registry/scripts/build-trust.mjs");

    const fromRemoteDefaults = [...(remoteDefaults.BUNDLED_ATTESTOR_KINDS || [])].sort();
    const fromValidateLedger = [...(validateLedgerMod.ATTESTOR_KINDS || [])].sort();
    const fromBuildTrust = [...(buildTrustMod.ATTESTOR_KINDS || [])].sort();

    assert.deepEqual(fromRemoteDefaults, ["attestor", "governance", "registry"]);
    assert.deepEqual(fromValidateLedger, fromRemoteDefaults, "validate-ledger.mjs ATTESTOR_KINDS drifted from remote-defaults.mjs");
    assert.deepEqual(fromBuildTrust, fromRemoteDefaults, "build-trust.mjs ATTESTOR_KINDS drifted from remote-defaults.mjs");

    const toolsSrc = fs.readFileSync(TOOLS_VERIFY_PATH, "utf8");
    const m = toolsSrc.match(/BUNDLED_ATTESTOR_KINDS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(m, "tools/verify-release.mjs must declare BUNDLED_ATTESTOR_KINDS");
    const fromToolsVerify = JSON.parse(`[${m[1]}]`).sort();
    assert.deepEqual(fromToolsVerify, fromRemoteDefaults, "tools/verify-release.mjs BUNDLED_ATTESTOR_KINDS drifted");
  });

  it("REFUSES a `governance` node signing a ReleasePublished event", () => {
    const govRelease = signRaw32Bytes(
      {
        type: "ReleasePublished",
        repo: "mcp-tool-shop-org/cognate",
        version: "1.0.0",
        commit: COMMIT_SHA,
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        artifacts: [{ name: "cognate.tgz", sha256: "a".repeat(64), uri: "https://example.com/cognate.tgz" }],
        attestations: [],
      },
      "ci-cognate-2026",
      COGNATE_KEYS.privateKey,
    );
    const nodes = [
      nodeManifest("mcp-tool-shop-org/cognate", "governance", "ci-cognate-2026", COGNATE_KEYS.publicKey),
    ];
    const sb = sandbox([govRelease], { nodes });
    const r = sb.run();
    assert.equal(r.code, 1, "a governance node signing ReleasePublished must be refused\n" + r.out + r.err);
    assert.match(
      r.err + r.out,
      /governance.*only sign run|governance.*ReleasePublished/i,
      "error must state that governance nodes may only sign run types, not releases",
    );
  });

  it("REFUSES a `governance` node signing a release AttestationPublished event (e.g. security.scan)", () => {
    const govReleaseAtt = signRaw32Bytes(
      {
        type: "AttestationPublished",
        repo: "mcp-tool-shop-org/repomesh",
        version: "1.0.0",
        commit: COMMIT_SHA,
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/bundle.js" }],
        attestations: [{ type: "security.scan", uri: "repomesh:attestor:security.scan:pass" }],
        notes: "security.scan: pass — clean",
      },
      "ci-cognate-2026",
      COGNATE_KEYS.privateKey,
    );
    const nodes = [
      nodeManifest("mcp-tool-shop-org/cognate", "governance", "ci-cognate-2026", COGNATE_KEYS.publicKey),
      nodeManifest("mcp-tool-shop-org/repomesh", "registry", "ci-rm-2026", RELEASE_KEYS.publicKey),
    ];
    const sb = sandbox([govReleaseAtt], { nodes });
    const r = sb.run();
    assert.equal(r.code, 1, "a governance node signing security.scan must be refused\n" + r.out + r.err);
    assert.match(
      r.err + r.out,
      /governance.*run|only authorized for run/i,
      "error must state that governance nodes are restricted to run attestation types",
    );
  });

  it("preserves the D12 rule: bundled trusted lists stay narrow and a fetched policy may narrow, never widen", async () => {
    assert.deepEqual([...remoteDefaults.BUNDLED_TRUSTED_ATTESTORS].sort(), [
      "mcp-tool-shop-org/repomesh",
      "mcp-tool-shop-org/repomesh-license-verifier",
      "mcp-tool-shop-org/repomesh-repro-verifier",
      "mcp-tool-shop-org/repomesh-security-verifier",
      "mcp-tool-shop-org/repomesh-xrpl-anchor",
    ]);
    assert.deepEqual([...(remoteDefaults.BUNDLED_TRUSTED_RUN_ATTESTORS || [])], [
      "mcp-tool-shop-org/cognate",
    ]);
    assert.equal(typeof policyLib.intersectBundledTrust, "function");
    // Fetched policy attempting to widen with an unknown org node is clamped to the bundled ceiling.
    const widened = policyLib.intersectBundledTrust(
      remoteDefaults.BUNDLED_TRUSTED_RUN_ATTESTORS,
      ["mcp-tool-shop-org/cognate", "evil-org/rogue-governance"],
    );
    assert.deepEqual([...widened], ["mcp-tool-shop-org/cognate"]);
    // Empty/non-array fetched policy falls back to bundled set.
    const fallback = policyLib.intersectBundledTrust(remoteDefaults.BUNDLED_TRUSTED_RUN_ATTESTORS, null);
    assert.deepEqual([...fallback], ["mcp-tool-shop-org/cognate"]);
    assert.equal(policyLib.isRunAttestationType("run.preregistered"), true);
    assert.equal(policyLib.isRunAttestationType("security.scan"), false);

    const policy = JSON.parse(fs.readFileSync(SHIPPED_POLICY_PATH, "utf8"));
    assert.equal(
      policyLib.canNodeSignAttestations(policy, "mcp-tool-shop-org/cognate", "governance", ["run.preregistered"]).ok,
      true,
    );
    assert.equal(
      policyLib.canNodeSignAttestations(policy, "mcp-tool-shop-org/cognate", "governance", ["security.scan"]).ok,
      false,
    );
    assert.equal(
      policyLib.canNodeSignAttestations(policy, "mcp-tool-shop-org/cognate", "attestor", ["security.scan"]).ok,
      false,
    );

    const validateLedgerMod = await import("../scripts/validate-ledger.mjs");
    const map = new Map();
    validateLedgerMod.recordRunPreregistrations(makePreregEvent("19s"), map);
    assert.equal(map.get("19s")?.has(PREREG_HASH), true);
    validateLedgerMod.validateRunAttestations(makeOutcomeEvent("19s"), 2, map);
    validateLedgerMod.validateRunAttestations(makeRootAnchoredEvent("cognate-runs-2026-03-19"), 3, map);
  });
});

// ===========================================================================
// Part 3 — The Ed25519 signing contract (New 1: raw 32 bytes, not UTF-8 JSON)
// ===========================================================================

describe("Part 3: Ed25519 32-byte raw canonicalHash signing contract (New 1)", () => {
  it("ACCEPTS an event signed over the raw 32-byte Buffer.from(canonicalHash, 'hex') and REFUSES one signed over UTF-8 canonical JSON with an explicit message", async () => {
    const validateLedgerMod = await import("../scripts/validate-ledger.mjs");
    const nodes = [
      nodeManifest("mcp-tool-shop-org/repomesh", "registry", "ci-rm-2026", RELEASE_KEYS.publicKey),
    ];
    const baseRelease = {
      type: "ReleasePublished",
      repo: "mcp-tool-shop-org/repomesh",
      version: "1.0.0",
      commit: COMMIT_SHA,
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      artifacts: [{ name: "bundle.js", sha256: "a".repeat(64), uri: "https://example.com/bundle.js" }],
      attestations: [],
    };

    // 1. Raw 32-byte signature passes (both direct helper and subprocess).
    const validEv = signRaw32Bytes(baseRelease, "ci-rm-2026", RELEASE_KEYS.privateKey);
    assert.equal(
      validateLedgerMod.verifyEd25519(RELEASE_KEYS.publicKey, validEv.signature.canonicalHash, validEv.signature.value),
      true,
    );
    const sbPass = sandbox([validEv], { nodes });
    const rPass = sbPass.run();
    assert.equal(rPass.code, 0, "raw 32-byte canonicalHash signature must pass\n" + rPass.out + rPass.err);

    // 2. UTF-8 canonical JSON signature is refused with an explicit message naming UTF-8 canonical JSON vs raw 32-byte canonicalHash.
    const utf8JsonEv = signUtf8CanonicalJson(baseRelease, "ci-rm-2026", RELEASE_KEYS.privateKey);
    assert.equal(
      validateLedgerMod.verifyEd25519(RELEASE_KEYS.publicKey, utf8JsonEv.signature.canonicalHash, utf8JsonEv.signature.value),
      false,
    );
    assert.match(
      validateLedgerMod.diagnoseEd25519Failure(RELEASE_KEYS.publicKey, utf8JsonEv, utf8JsonEv.signature.value),
      /UTF-8 canonical JSON.*raw 32-byte/i,
    );
    const sbFailJson = sandbox([utf8JsonEv], { nodes });
    const rFailJson = sbFailJson.run();
    assert.equal(rFailJson.code, 1, "UTF-8 canonical JSON signature must be refused\n" + rFailJson.out + rFailJson.err);
    assert.match(
      rFailJson.err + rFailJson.out,
      /UTF-8 canonical JSON.*raw 32-byte|raw 32-byte.*canonicalHash/i,
      "refusal message must explicitly diagnose signing UTF-8 canonical JSON instead of raw 32-byte canonicalHash",
    );
  });

  it("REFUSES an event signed over the 64-byte ASCII hex string Buffer.from(canonicalHash, 'utf8') with an explicit 32-byte contract message", async () => {
    const validateLedgerMod = await import("../scripts/validate-ledger.mjs");
    const nodes = [
      nodeManifest("mcp-tool-shop-org/repomesh", "registry", "ci-rm-2026", RELEASE_KEYS.publicKey),
    ];
    const hexAsciiEv = signAsciiHexDigest(
      {
        type: "ReleasePublished",
        repo: "mcp-tool-shop-org/repomesh",
        version: "1.0.0",
        commit: COMMIT_SHA,
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        artifacts: [{ name: "bundle.js", sha256: "a".repeat(64), uri: "https://example.com/bundle.js" }],
        attestations: [],
      },
      "ci-rm-2026",
      RELEASE_KEYS.privateKey,
    );
    assert.match(
      validateLedgerMod.diagnoseEd25519Failure(RELEASE_KEYS.publicKey, hexAsciiEv, hexAsciiEv.signature.value),
      /64-byte UTF-8 hex.*raw 32-byte/i,
    );
    const sb = sandbox([hexAsciiEv], { nodes });
    const r = sb.run();
    assert.equal(r.code, 1, "64-byte ASCII hex signature must be refused\n" + r.out + r.err);
    assert.match(
      r.err + r.out,
      /64-byte UTF-8 hex.*raw 32-byte|raw 32-byte.*canonicalHash/i,
      "refusal message must explicitly diagnose signing 64-byte UTF-8 hex instead of raw 32-byte canonicalHash",
    );
  });
});
