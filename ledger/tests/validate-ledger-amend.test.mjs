// RepoMesh Ledger — Stage A amend wave tests (Schema + Ledger + Policy domain)
// Probes the FULL invariant for each finding: LDG-001..008, D2 (attestor authz), D6 (sha256).
//
// Strategy: write each fixture ledger + node tree to a temp dir, run validate-ledger.mjs as a
// subprocess with REPOMESH_NODES_PATH + HEAD_LEDGER (and optionally BASE_LEDGER) pointing at it,
// then assert on exit code / stderr. The validator is a top-level script, so subprocess is the
// honest way to exercise its real control flow end to end.

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
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SCHEMAS_DIR = path.join(REPO_ROOT, "schemas");

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

function attestation(attestations, overrides = {}) {
  return {
    type: "AttestationPublished",
    repo: "test-org/test-repo",
    version: "1.0.0",
    commit: "a".repeat(40),
    timestamp: new Date().toISOString(),
    artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/bundle.js" }],
    attestations,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixture sandbox
// ---------------------------------------------------------------------------

let RELEASE_KEYS;   // signs ReleasePublished for test-org/test-repo
let ATTESTOR_KEYS;  // signs AttestationPublished as a trusted attestor
let ROGUE_KEYS;     // a registered-but-not-trusted node

before(() => {
  RELEASE_KEYS = genKeyPair();
  ATTESTOR_KEYS = genKeyPair();
  ROGUE_KEYS = genKeyPair();
});

function nodeManifest(id, kind, keyId, pubPem) {
  return {
    id,
    kind,
    description: `${kind} node for tests`,
    provides: [`${kind}.test.v1`],
    consumes: [],
    interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
    invariants: { deterministicBuild: false, signedReleases: false, semver: true, changelog: true },
    maintainers: [{ name: "tester", keyId, publicKey: pubPem.trim(), contact: "t@example.com" }],
    tags: ["test"],
  };
}

/** Builds a sandbox: nodes/ tree + events.jsonl, returns paths + a runner. */
function sandbox(events, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-ledger-"));
  const nodesDir = path.join(dir, "nodes");
  const eventsPath = path.join(dir, "events.jsonl");
  // Isolate anchor manifests: a fresh fixture ledger has no committed anchors, so point the
  // validator at an empty manifests dir (otherwise it would try to verify the REAL genesis
  // manifest against the fixture and fail spuriously). Tests that exercise the real manifests
  // run the validator directly against the repo, not through this sandbox.
  const manifestsDir = path.join(dir, "manifests");
  fs.mkdirSync(manifestsDir, { recursive: true });

  // Default node tree: the release repo + a trusted attestor + a rogue node.
  const nodes = opts.nodes || [
    nodeManifest("test-org/test-repo", "registry", "rel-key", RELEASE_KEYS.publicKey),
    nodeManifest("test-org/attestor", "attestor", "att-key", ATTESTOR_KEYS.publicKey),
    nodeManifest("test-org/rogue", "attestor", "rogue-key", ROGUE_KEYS.publicKey),
  ];
  for (const n of nodes) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }

  // events param may be array of signed objects OR a raw string (for blank-line tests).
  if (typeof events === "string") {
    fs.writeFileSync(eventsPath, events);
  } else {
    fs.writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }

  // Optional trustedAttestors policy override.
  let env = {
    ...process.env,
    REPOMESH_NODES_PATH: nodesDir,
    REPOMESH_MANIFESTS_PATH: manifestsDir,
    HEAD_LEDGER: eventsPath,
  };
  if (opts.basePath) env.BASE_LEDGER = opts.basePath;
  if (opts.trustedAttestorsPath) env.REPOMESH_VERIFIER_POLICY_PATH = opts.trustedAttestorsPath;

  function run(extraEnv = {}) {
    // spawnSync captures BOTH stdout and stderr regardless of exit code (warnings on success go
    // to stderr — execFileSync would drop them on the success path).
    const res = spawnSync("node", [VALIDATOR], {
      env: { ...env, ...extraEnv },
      encoding: "utf8",
    });
    return { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
  }

  return { dir, nodesDir, eventsPath, run };
}

// A default trusted-attestors policy file pointing at test-org/attestor + the release repo.
function writePolicy(dir, trustedAttestors, trustedPolicy) {
  const p = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(p, JSON.stringify({
    v: 1,
    checks: {},
    trustedAttestors: trustedAttestors ?? ["test-org/attestor", "test-org/test-repo"],
    trustedPolicy: trustedPolicy ?? ["test-org/policy", "test-org/test-repo"],
  }, null, 2));
  return p;
}

// ---------------------------------------------------------------------------
// D2 / LDG-003 — attestor authorization allowlist
// ---------------------------------------------------------------------------

describe("D2/LDG-003 attestor authorization", () => {
  it("REJECTS AttestationPublished signed by a registered-but-not-trusted node", () => {
    const ev = sign(
      attestation([{ type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" }]),
      "rogue-key", ROGUE_KEYS.privateKey,
    );
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir); // rogue NOT in trustedAttestors
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "non-trusted attestor must be rejected\n" + r.err);
    assert.match(r.err + r.out, /trust|attestor|allowlist|authoriz/i);
  });

  it("ACCEPTS AttestationPublished signed by a trusted attestor node", () => {
    const ev = sign(
      attestation([{ type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" }]),
      "att-key", ATTESTOR_KEYS.privateKey,
    );
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 0, "trusted attestor must pass\n" + r.err);
  });

  it("REJECTS PolicyViolation signed by a node not in trustedPolicy", () => {
    const ev = sign(
      attestation([{ type: "policy.check", uri: "repomesh:policy:semver.monotonicity:error" }],
        { type: "PolicyViolation" }),
      "rogue-key", ROGUE_KEYS.privateKey,
    );
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "non-trusted policy node must be rejected\n" + r.err);
  });

  it("keeps ReleasePublished repo-bound (signer must be a maintainer of its own repo)", () => {
    // Signed by the attestor key, but the release repo's node only knows rel-key.
    const ev = sign(release(), "att-key", ATTESTOR_KEYS.privateKey);
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "release signed by a non-repo key must fail\n" + r.err);
  });

  it("ACCEPTS ReleasePublished signed by its own repo maintainer", () => {
    const ev = sign(release(), "rel-key", RELEASE_KEYS.privateKey);
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 0, "valid release must pass\n" + r.err);
  });
});

// ---------------------------------------------------------------------------
// LDG-007 — resolve attestor key from explicit node id; fail on keyId collisions
// ---------------------------------------------------------------------------

describe("LDG-007 keyId collision", () => {
  it("FAILS when two trusted nodes share the same keyId (ambiguous resolution)", () => {
    // Two attestor nodes both advertising keyId "dup-key" with different pubkeys.
    const other = genKeyPair();
    const nodes = [
      nodeManifest("test-org/test-repo", "registry", "rel-key", RELEASE_KEYS.publicKey),
      nodeManifest("test-org/attestor", "attestor", "dup-key", ATTESTOR_KEYS.publicKey),
      nodeManifest("test-org/attestor2", "attestor", "dup-key", other.publicKey),
    ];
    const ev = sign(
      attestation([{ type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" }]),
      "dup-key", ATTESTOR_KEYS.privateKey,
    );
    const sb = sandbox([ev], { nodes });
    const policy = writePolicy(sb.dir, ["test-org/attestor", "test-org/attestor2"]);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "keyId collision among trusted nodes must fail\n" + r.err);
    assert.match(r.err + r.out, /collision|ambiguous|multiple|more than one/i);
  });
});

// ---------------------------------------------------------------------------
// LDG-002 — one shared key-builder; distinct anchors do not collide, true dups do
// ---------------------------------------------------------------------------

describe("LDG-002 shared key-builder", () => {
  it("ACCEPTS two ledger.anchor attestations that differ only by URI/txHash", () => {
    const a1 = sign(attestation(
      [{ type: "ledger.anchor", uri: "xrpl:tx:AAAA" }],
      { version: "0.0.0-genesis", timestamp: "2026-03-05T02:29:49.448Z" }),
      "att-key", ATTESTOR_KEYS.privateKey);
    const a2 = sign(attestation(
      [{ type: "ledger.anchor", uri: "xrpl:tx:BBBB" }],
      { version: "0.0.0-genesis", timestamp: "2026-03-06T02:29:49.448Z" }),
      "att-key", ATTESTOR_KEYS.privateKey);
    const sb = sandbox([a1, a2]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 0, "distinct anchors (different tx) must not collide\n" + r.err);
  });

  it("REJECTS a byte-identical duplicate attestation (same types + uris)", () => {
    const a1 = sign(attestation(
      [{ type: "ledger.anchor", uri: "xrpl:tx:SAME" }],
      { version: "0.0.0-genesis", timestamp: "2026-03-05T02:29:49.448Z" }),
      "att-key", ATTESTOR_KEYS.privateKey);
    const a2 = sign(attestation(
      [{ type: "ledger.anchor", uri: "xrpl:tx:SAME" }],
      { version: "0.0.0-genesis", timestamp: "2026-03-06T02:29:49.448Z" }),
      "att-key", ATTESTOR_KEYS.privateKey);
    const sb = sandbox([a1, a2]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "true duplicate attestation must be rejected\n" + r.err);
    assert.match(r.err + r.out, /duplicate/i);
  });

  it("collides identical base + new attestations across the BASE/HEAD boundary", () => {
    // base contains the attestation; head re-adds an identical one -> must be caught.
    const a1 = sign(attestation(
      [{ type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" }],
      { version: "1.0.0", timestamp: "2026-03-05T02:29:49.448Z" }),
      "att-key", ATTESTOR_KEYS.privateKey);
    const sb = sandbox([a1, a1]); // head = base line + identical new line
    const basePath = path.join(sb.dir, "base.jsonl");
    fs.writeFileSync(basePath, JSON.stringify(a1) + "\n");
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy, BASE_LEDGER: basePath });
    assert.equal(r.code, 1, "identical new attestation must collide with base\n" + r.err);
  });
});

// ---------------------------------------------------------------------------
// LDG-001 — append-only immutability INDEPENDENT of BASE_LEDGER
// ---------------------------------------------------------------------------

describe("LDG-001 immutability without BASE_LEDGER (anchor-manifest path)", () => {
  // We exercise this against the REAL committed ledger + manifests by tampering a copy.
  it("the local `validate:ledger` (no BASE) verifies committed anchor manifests", () => {
    // Tamper a genesis-partition event in a copy of the real ledger; manifest root must mismatch.
    const realLedger = fs.readFileSync(path.join(REPO_ROOT, "ledger", "events", "events.jsonl"), "utf8");
    const lines = realLedger.split("\n").filter((l) => l.trim().length > 0);
    // Mutate the notes of line 1 (a genesis-partition event) without re-signing: but signature
    // check would catch that. Instead, swap the ORDER of the first two genesis events — both have
    // valid signatures individually, but the Merkle root over the partition changes.
    const swapped = [lines[1], lines[0], ...lines.slice(2)].join("\n") + "\n";
    const tamperedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rm-imm-")), "events.jsonl");
    fs.writeFileSync(tamperedPath, swapped);
    const res = spawnSync("node", [VALIDATOR], {
      env: { ...process.env, HEAD_LEDGER: tamperedPath },
      encoding: "utf8",
    });
    const r = { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
    assert.equal(r.code, 1, "reordered genesis partition must break the anchor manifest root\n" + r.out + r.err);
    assert.match(r.err + r.out, /manifest|merkle|root|immutab|anchor/i);
  });

  it("the real committed ledger passes the local validator unchanged", () => {
    const res = spawnSync("node", [VALIDATOR], {
      env: { ...process.env },
      cwd: path.join(REPO_ROOT, "ledger"),
      encoding: "utf8",
    });
    const r = { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
    assert.equal(r.code, 0, "the committed ledger must validate locally\n" + r.out + r.err);
  });
});

// ---------------------------------------------------------------------------
// LDG-004 — reject interior blank lines
// ---------------------------------------------------------------------------

describe("LDG-004 interior blank lines", () => {
  it("REJECTS a ledger with an interior blank line", () => {
    const ev1 = sign(release({ version: "1.0.0" }), "rel-key", RELEASE_KEYS.privateKey);
    const ev2 = sign(release({ version: "1.0.1" }), "rel-key", RELEASE_KEYS.privateKey);
    const raw = JSON.stringify(ev1) + "\n\n" + JSON.stringify(ev2) + "\n"; // interior blank
    const sb = sandbox(raw);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "interior blank line must be rejected\n" + r.err);
    assert.match(r.err + r.out, /blank|empty|whitespace/i);
  });

  it("ACCEPTS a ledger with a single trailing newline", () => {
    const ev1 = sign(release({ version: "1.0.0" }), "rel-key", RELEASE_KEYS.privateKey);
    const raw = JSON.stringify(ev1) + "\n";
    const sb = sandbox(raw);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 0, "single trailing newline must be accepted\n" + r.err);
  });

  it("the committed events.jsonl has no interior blank lines", () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, "ledger", "events", "events.jsonl"), "utf8");
    const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    assert.ok(!body.split("\n").some((l) => l.trim().length === 0),
      "committed ledger must not contain interior blank lines");
  });
});

// ---------------------------------------------------------------------------
// LDG-006 — a/b fixture deleted; non-empty contact required; fixtures excluded
// ---------------------------------------------------------------------------

describe("LDG-006 data hygiene", () => {
  it("the ledger/nodes/a/b fixture directory is gone", () => {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, "ledger", "nodes", "a")),
      "ledger/nodes/a must be deleted");
  });

  it("REJECTS a repo-bound node whose maintainer has an empty contact", () => {
    const bad = nodeManifest("test-org/test-repo", "registry", "rel-key", RELEASE_KEYS.publicKey);
    bad.maintainers[0].contact = "";
    const ev = sign(release(), "rel-key", RELEASE_KEYS.privateKey);
    const nodes = [bad, nodeManifest("test-org/attestor", "attestor", "att-key", ATTESTOR_KEYS.publicKey)];
    const sb = sandbox([ev], { nodes });
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "empty contact must be rejected\n" + r.err);
    assert.match(r.err + r.out, /contact/i);
  });

  it("REJECTS a trusted attestor node whose maintainer has an empty contact", () => {
    const badAttestor = nodeManifest("test-org/attestor", "attestor", "att-key", ATTESTOR_KEYS.publicKey);
    badAttestor.maintainers[0].contact = "";
    const nodes = [
      nodeManifest("test-org/test-repo", "registry", "rel-key", RELEASE_KEYS.publicKey),
      badAttestor,
    ];
    const ev = sign(
      attestation([{ type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" }]),
      "att-key", ATTESTOR_KEYS.privateKey);
    const sb = sandbox([ev], { nodes });
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "empty contact on a trusted attestor must be rejected\n" + r.err);
    assert.match(r.err + r.out, /contact/i);
  });
});

// ---------------------------------------------------------------------------
// LDG-008 — base64 pattern on signature.value (schema)
// ---------------------------------------------------------------------------

describe("LDG-008 signature.value base64 pattern", () => {
  it("schema rejects a non-base64 signature.value", () => {
    const ev = sign(release(), "rel-key", RELEASE_KEYS.privateKey);
    ev.signature.value = "!!!!not base64 at all!!!! with spaces and length over thirty-two chars";
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "non-base64 signature.value must fail schema\n" + r.err);
    assert.match(r.err + r.out, /schema|pattern/i);
  });

  it("schema accepts a valid base64 signature.value", () => {
    const ev = sign(release(), "rel-key", RELEASE_KEYS.privateKey);
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 0, "valid base64 signature must pass\n" + r.err);
  });
});

// ---------------------------------------------------------------------------
// D6 (schema half) — optional sha256 on $defs.attestation; warn (not reject) when missing
// ---------------------------------------------------------------------------

describe("D6 sbom sha256 binding (schema half)", () => {
  it("schema ACCEPTS an attestation carrying an optional sha256", () => {
    const ev = sign(attestation(
      [{ type: "sbom", uri: "https://example.com/sbom.json", sha256: "c".repeat(64) }]),
      "att-key", ATTESTOR_KEYS.privateKey);
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 0, "attestation with sha256 must pass schema\n" + r.err);
  });

  it("schema rejects an unknown extra attestation field (additionalProperties:false kept)", () => {
    const ev = sign(attestation(
      [{ type: "sbom", uri: "https://example.com/sbom.json", bogus: "x" }]),
      "att-key", ATTESTOR_KEYS.privateKey);
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 1, "unknown attestation field must still be rejected\n" + r.err);
  });

  it("WARNS (does not reject) an sbom attestation missing sha256 (grandfather)", () => {
    const ev = sign(attestation(
      [{ type: "sbom", uri: "https://example.com/sbom.json" }]),
      "att-key", ATTESTOR_KEYS.privateKey);
    const sb = sandbox([ev]);
    const policy = writePolicy(sb.dir);
    const r = sb.run({ REPOMESH_VERIFIER_POLICY_PATH: policy });
    assert.equal(r.code, 0, "missing sha256 must be grandfathered (warn, not fail)\n" + r.err);
    assert.match(r.err + r.out, /sha256|digest/i);
  });
});

// ---------------------------------------------------------------------------
// schemas/event.schema.json — sha256 + base64 pattern presence (direct schema asserts)
// ---------------------------------------------------------------------------

describe("event.schema.json structure", () => {
  let schema;
  before(() => {
    schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, "event.schema.json"), "utf8"));
  });
  it("signature.value has a base64 pattern", () => {
    assert.equal(schema.properties.signature.properties.value.pattern, "^[A-Za-z0-9+/]+={0,2}$");
  });
  it("$defs.attestation permits an optional sha256 and stays additionalProperties:false", () => {
    assert.equal(schema.$defs.attestation.additionalProperties, false);
    assert.ok(schema.$defs.attestation.properties.sha256, "sha256 field must exist");
    assert.ok(!(schema.$defs.attestation.required || []).includes("sha256"), "sha256 must be optional");
  });
});
