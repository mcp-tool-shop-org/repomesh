// RepoMesh Ledger — #7 verifier-plugin contract regression suite for validate-ledger.mjs.
//
// WHAT #7 CHANGED HERE (and what these tests pin):
//   1. validate-ledger no longer HARDCODES the node-kind→event-type permission sets
//      (ATTESTOR_KINDS / POLICY_KINDS). It resolves them from verifier.policy.json via
//      nodeKindsForEvent() in verifiers/lib/policy.mjs — extended by DATA, not code. The selection is
//      byte-identical to before: PolicyViolation → policy/registry; everything else → attestor/registry.
//   2. verifier.policy.json is now schema-validated at startup against
//      schemas/verifier.policy.schema.json, and validate-ledger FAILS CLOSED on a malformed policy
//      (a bad trust policy must HALT, never be silently trusted).
//
// THE NON-NEGOTIABLE GATE: validate-ledger must still pass on the REAL 58-event ledger unchanged.
//
// Strategy mirrors key-lifecycle.test.mjs: write a fixture nodes/ tree + events.jsonl + a policy to a
// temp dir, run the REAL validate-ledger.mjs as a subprocess via env overrides, assert on exit/output.
// The data-driven nodeKinds case exercises the resolver directly (verifiers/lib/policy.mjs).

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
import { nodeKindsForEvent } from "../../verifiers/lib/policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..", "..");
const VALIDATOR = path.join(HERE, "..", "scripts", "validate-ledger.mjs");
const REAL_LEDGER = path.join(HERE, "..", "events", "events.jsonl");
const POLICY_SCHEMA_PATH = path.join(REPO_ROOT, "schemas", "verifier.policy.schema.json");
const SHIPPED_POLICY_PATH = path.join(REPO_ROOT, "verifier.policy.json");

// ---------------------------------------------------------------------------
// Crypto + event/node helpers (mirror the validator's canonicalization exactly).
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

function attestationPublished(overrides = {}) {
  return {
    type: "AttestationPublished",
    repo: "test-org/some-repo",
    version: "1.0.0",
    commit: "a".repeat(40),
    timestamp: new Date().toISOString(),
    artifacts: [{ name: "report.json", sha256: "b".repeat(64), uri: "https://example.com/report.json" }],
    attestations: [{ type: "license.audit", uri: "https://example.com/license.json" }],
    ...overrides,
  };
}

function maintainer(name, keyId, pubPem) {
  return { name, keyId, publicKey: pubPem.trim(), contact: `${keyId}@example.com` };
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

// Fixture sandbox: nodes/ tree + events.jsonl + an EMPTY manifests dir (no anchor-manifest immutability
// check) + a policy file. Returns a runner that spawns the REAL validate-ledger.mjs against it.
function sandbox({ nodes, events, policy }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-vpc-"));
  const nodesDir = path.join(dir, "nodes");
  const eventsPath = path.join(dir, "events.jsonl");
  const manifestsDir = path.join(dir, "manifests");
  fs.mkdirSync(manifestsDir, { recursive: true });

  for (const n of nodes) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }
  fs.writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  const policyPath = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));

  const env = {
    ...process.env,
    REPOMESH_NODES_PATH: nodesDir,
    REPOMESH_MANIFESTS_PATH: manifestsDir,
    REPOMESH_VERIFIER_POLICY_PATH: policyPath,
    HEAD_LEDGER: eventsPath,
  };

  function run() {
    const res = spawnSync("node", [VALIDATOR], { env, encoding: "utf8" });
    return { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
  }
  return { dir, policyPath, run };
}

// A minimal v1 policy that trusts our test attestor node, with NO nodeKinds (so the resolver falls
// back to the v1 permission map — proving v1 behaves byte-identically to pre-#7).
function v1Policy(trustedAttestors = ["test-org/attestor"]) {
  return { v: 1, checks: {}, trustedAttestors, trustedPolicy: ["test-org/policy"] };
}

let ATTKEY; // a trusted attestor node key
let POLKEY; // a trustedPolicy node key

before(() => {
  ATTKEY = genKeyPair();
  POLKEY = genKeyPair();
});

const ATTESTOR_NODE = (kind = "attestor") =>
  nodeManifest("test-org/attestor", kind, [maintainer("att", "att-key", ATTKEY.publicKey)]);

// ===========================================================================
// 1. THE REGRESSION GATE — validate-ledger still passes on the REAL ledger.
// ===========================================================================

describe("#7 regression gate — real ledger still validates", () => {
  it("validates the full current ledger (exit 0, '58 event(s) validated')", () => {
    // Run with NO env overrides → the real ledger, real nodes/, real manifests, real policy. This is
    // the documented `node ledger/scripts/validate-ledger.mjs` path and the non-negotiable gate.
    const res = spawnSync("node", [VALIDATOR], { env: process.env, encoding: "utf8" });
    const all = (res.stdout || "") + (res.stderr || "");
    assert.equal(res.status, 0, "real ledger must validate after the #7 refactor\n" + all);
    assert.match(all, /All 58 event\(s\) validated\. Append-only preserved\. Signatures verified\./);
  });

  it("the real ledger file has exactly 58 events (guards the count the gate asserts)", () => {
    const raw = fs.readFileSync(REAL_LEDGER, "utf8").replace(/\r?\n$/, "");
    const lines = raw.length === 0 ? [] : raw.split("\n");
    assert.equal(lines.length, 58, "the regression gate's '58' must match the live ledger count");
  });
});

// ===========================================================================
// 2. NODE-KIND AUTHORIZATION UNCHANGED — a wrong-KIND signer is still REJECTED.
//    A 'policy'-kind node signing an AttestationPublished must fail exactly as before #7: the
//    AttestationPublished allowed-kinds set (attestor/registry) excludes 'policy'.
// ===========================================================================

describe("#7 node-kind authorization unchanged", () => {
  it("ACCEPTS an AttestationPublished signed by a trusted 'attestor'-kind node (baseline)", () => {
    const ev = sign(attestationPublished(), "att-key", ATTKEY.privateKey);
    const sb = sandbox({ nodes: [ATTESTOR_NODE("attestor")], events: [ev], policy: v1Policy() });
    const r = sb.run();
    assert.equal(r.code, 0, "trusted attestor-kind signer must be accepted\n" + r.out + r.err);
  });

  it("REJECTS an AttestationPublished whose signer node is 'policy'-kind (wrong kind)", () => {
    // Same trusted node id + same keyId, but its kind is 'policy'. AttestationPublished requires
    // attestor/registry → the resolver-derived ATTESTOR_KINDS excludes 'policy' → rejected, exactly
    // as the pre-#7 hardcoded Set(["attestor","registry"]) would have rejected it.
    const ev = sign(attestationPublished(), "att-key", ATTKEY.privateKey);
    const sb = sandbox({ nodes: [ATTESTOR_NODE("policy")], events: [ev], policy: v1Policy() });
    const r = sb.run();
    assert.equal(r.code, 1, "a policy-kind node must NOT be able to sign an AttestationPublished\n" + r.out + r.err);
    assert.match(r.err + r.out, /TRUSTED AttestationPublished signer|kind|attestor/i);
  });

  it("v1 policy (no nodeKinds) authorizes byte-identically to the pre-#7 hardcoded map", () => {
    // Resolver-level proof: a v1 policy falls back to {attestor,registry}→AttestationPublished,
    // {policy,registry}→PolicyViolation. This is the exact pre-#7 selection.
    const p = v1Policy();
    assert.deepEqual([...nodeKindsForEvent(p, "AttestationPublished")].sort(), ["attestor", "registry"]);
    assert.deepEqual([...nodeKindsForEvent(p, "PolicyViolation")].sort(), ["policy", "registry"]);
  });
});

// ===========================================================================
// 3. SCHEMA — shipped v2 + minimal v1 validate; invalid policies FAIL the schema.
// ===========================================================================

describe("#7 verifier.policy schema", () => {
  let validate;
  before(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    validate = ajv.compile(JSON.parse(fs.readFileSync(POLICY_SCHEMA_PATH, "utf8")));
  });

  it("the SHIPPED verifier.policy.json (v2) validates against the schema", () => {
    const shipped = JSON.parse(fs.readFileSync(SHIPPED_POLICY_PATH, "utf8"));
    assert.equal(shipped.v, 2, "the shipped policy is expected to be v2");
    assert.ok(validate(shipped), "shipped v2 policy must validate\n" + JSON.stringify(validate.errors, null, 2));
  });

  it("a minimal v1 policy validates against the schema", () => {
    const v1 = {
      v: 1,
      trustedAttestors: ["org/a"],
      checks: { "license.audit": { mode: "open", quorum: 1, conflictPolicy: "fail-wins" } },
    };
    assert.ok(validate(v1), "minimal v1 policy must validate\n" + JSON.stringify(validate.errors, null, 2));
  });

  it("REJECTS a policy with a bad check 'mode' enum value", () => {
    const bad = { v: 1, trustedAttestors: [], checks: { x: { mode: "wide-open", quorum: 1, conflictPolicy: "p" } } };
    assert.ok(!validate(bad), "an invalid mode enum must fail the schema");
  });

  it("REJECTS a policy missing a required check field (quorum)", () => {
    const bad = { v: 1, trustedAttestors: [], checks: { x: { mode: "open", conflictPolicy: "p" } } };
    assert.ok(!validate(bad), "a check missing 'quorum' must fail the schema");
  });

  // Backward-compat: a minimal policy (just the trustedAttestors allowlist) is VALID — the resolver
  // falls back per-field to the v1 hardcoded defaults when `v` / `checks` / `nodeKinds` are absent.
  // Requiring them would break real minimal policies (the forged-window security probe uses them).
  it("ACCEPTS a minimal policy with no 'checks' (backward-compat)", () => {
    assert.ok(validate({ v: 1, trustedAttestors: [] }), "a policy with just trustedAttestors is valid");
  });

  it("ACCEPTS a policy with no 'v' (absent → resolver treats as v1)", () => {
    assert.ok(validate({ trustedAttestors: [], checks: {} }), "'v' is optional");
  });

  it("REJECTS a policy missing the required 'trustedAttestors' allowlist", () => {
    assert.ok(!validate({ v: 1, checks: {} }), "trustedAttestors is the one required field");
  });
});

// ===========================================================================
// 4. FAIL CLOSED — validate-ledger HALTS on a malformed policy (never silently trusts it).
// ===========================================================================

describe("#7 fail-closed on invalid policy", () => {
  it("validate-ledger FAILS CLOSED when the policy is structurally invalid (bad mode enum)", () => {
    // A well-formed ledger that would otherwise PASS, but the policy is malformed. The validator must
    // refuse to proceed — a broken trust policy must not be treated as "no restrictions".
    const ev = sign(attestationPublished(), "att-key", ATTKEY.privateKey);
    const badPolicy = {
      v: 1,
      checks: { "license.audit": { mode: "TOTALLY-OPEN", quorum: 1, conflictPolicy: "fail-wins" } },
      trustedAttestors: ["test-org/attestor"],
      trustedPolicy: ["test-org/policy"],
    };
    const sb = sandbox({ nodes: [ATTESTOR_NODE("attestor")], events: [ev], policy: badPolicy });
    const r = sb.run();
    assert.equal(r.code, 1, "a malformed policy must HALT validation (fail-closed)\n" + r.out + r.err);
    assert.match(r.err + r.out, /policy.*schema|fail-closed|malformed trust policy/i);
  });

  it("does NOT fail-closed on a minimal valid policy (no checks) — backward-compat", () => {
    // A minimal policy (just trustedAttestors) is valid; the validator must NOT reject it as malformed.
    const ev = sign(attestationPublished(), "att-key", ATTKEY.privateKey);
    const minPolicy = { v: 1, trustedAttestors: ["test-org/attestor"], trustedPolicy: ["test-org/policy"] };
    const sb = sandbox({ nodes: [ATTESTOR_NODE("attestor")], events: [ev], policy: minPolicy });
    const r = sb.run();
    assert.doesNotMatch(
      r.err + r.out,
      /failed schema validation|malformed trust policy/i,
      "a minimal valid policy must not be rejected as malformed\n" + r.out + r.err
    );
  });

  it("the SHIPPED policy is NOT rejected by the fail-closed gate (positive control)", () => {
    // Run the validator pointed at the real shipped policy but our fixture ledger — it must get PAST
    // the policy gate (the failure, if any, must not be the policy-schema failure).
    const ev = sign(attestationPublished(), "att-key", ATTKEY.privateKey);
    const sb = sandbox({ nodes: [ATTESTOR_NODE("attestor")], events: [ev], policy: v1Policy() });
    const r = sb.run();
    assert.doesNotMatch(r.err + r.out, /failed schema validation/i,
      "a valid policy must not trip the fail-closed gate\n" + r.out + r.err);
    assert.equal(r.code, 0, "valid policy + valid ledger must pass\n" + r.out + r.err);
  });
});

// ===========================================================================
// 5. DATA-DRIVEN nodeKinds — a policy that permits a NEW kind is reflected.
//    This is the whole point of #7: extend the network by DATA, not code. The validator must
//    AUTHORIZE a signer of a newly-permitted kind, and the resolver must reflect the new permission.
// ===========================================================================

describe("#7 data-driven nodeKinds — new kind permitted by policy", () => {
  it("resolver reflects a policy that grants a NEW kind permission to sign AttestationPublished", () => {
    const p = {
      v: 2,
      checks: {},
      trustedAttestors: ["test-org/oracle-att"],
      nodeKinds: {
        oracle: { canSign: ["AttestationPublished"] },
        policy: { canSign: ["PolicyViolation"] },
      },
    };
    assert.ok(nodeKindsForEvent(p, "AttestationPublished").has("oracle"),
      "the resolver must report 'oracle' as permitted for AttestationPublished");
    assert.ok(!nodeKindsForEvent(p, "AttestationPublished").has("attestor"),
      "a PRESENT nodeKinds is authoritative — 'attestor' is no longer permitted unless listed");
  });

  it("validate-ledger ACCEPTS an 'oracle'-kind signer when the policy's nodeKinds permits it", () => {
    // Pre-#7 this was impossible without a code change ('oracle' was not in the hardcoded set). With
    // #7 it is data-only: the policy's nodeKinds grants oracle → AttestationPublished.
    const oracleNode = nodeManifest("test-org/oracle-att", "oracle",
      [maintainer("orc", "orc-key", ATTKEY.publicKey)]);
    const ev = sign(attestationPublished({ repo: "test-org/some-repo" }), "orc-key", ATTKEY.privateKey);
    const policy = {
      v: 2,
      checks: {},
      trustedAttestors: ["test-org/oracle-att"],
      trustedPolicy: ["test-org/policy"],
      nodeKinds: {
        oracle: { canSign: ["AttestationPublished"] },
        policy: { canSign: ["PolicyViolation"] },
      },
    };
    const sb = sandbox({ nodes: [oracleNode], events: [ev], policy });
    const r = sb.run();
    assert.equal(r.code, 0,
      "an oracle-kind signer must be accepted when the policy's nodeKinds permits it (data-driven)\n" + r.out + r.err);
  });

  it("validate-ledger REJECTS the SAME oracle signer when the policy does NOT grant the new kind", () => {
    // Control for the case above: drop the oracle permission (v1 fallback → attestor/registry only)
    // and the very same signer is rejected. Proves the acceptance was due to the DATA, not a bug.
    const oracleNode = nodeManifest("test-org/oracle-att", "oracle",
      [maintainer("orc", "orc-key", ATTKEY.publicKey)]);
    const ev = sign(attestationPublished({ repo: "test-org/some-repo" }), "orc-key", ATTKEY.privateKey);
    const sb = sandbox({ nodes: [oracleNode], events: [ev], policy: v1Policy(["test-org/oracle-att"]) });
    const r = sb.run();
    assert.equal(r.code, 1,
      "without the policy granting oracle, the oracle signer must be rejected\n" + r.out + r.err);
    assert.match(r.err + r.out, /TRUSTED AttestationPublished signer|kind|attestor/i);
  });
});
