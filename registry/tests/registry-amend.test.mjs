// Registry domain — Stage A amend tests (Anchor + Registry agent).
// Probes the FULL invariant for each finding:
//   REG-004  build-trust verifies event signatures (canonicalHash recompute + crypto.verify)
//            and REJECTS forged/invalid-signature events before scoring; keyId->single-node.
//   REG-002  sbom.present / provenance.present integrity points are awarded ONLY when a TRUSTED
//            attestor published an AttestationPublished with consensus pass; inline self-declared
//            attestations are display-only (no points). completedChecks fallback fixed too.
//   REG-003  build-badges XML-escapes interpolated values + asserts numeric scores.
//   REG-005  dead event-cache.mjs is deleted.
//   ANC-004  build-anchors matches anchor->manifest on manifestHash ONLY; txHash null otherwise.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeForHash } from "../../ledger/scripts/canonicalize.mjs";
import { buildTrust } from "../scripts/build-trust.mjs";
import { badge, escapeXml } from "../scripts/build-badges.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

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

let RK, AK, GK; // release / attestor / rogue keys
before(() => { RK = genKeyPair(); AK = genKeyPair(); GK = genKeyPair(); });

// Build a sandbox dir: nodes tree + events.jsonl + profiles + verifier.policy.json.
function sandbox(events, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-reg-"));
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
    trustedAttestors: [ATTESTOR, RELEASE],
    trustedPolicy: [RELEASE],
    checks: {
      "sbom.present": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
      "provenance.present": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
      "signature.chain": { mode: "trusted-set", trustedNodes: [ATTESTOR], quorum: 1, conflictPolicy: "fail-wins" },
    },
  }, null, 2));

  const ledgerPath = path.join(dir, "events.jsonl");
  fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  return {
    dir,
    run() {
      return buildTrust({
        ledgerPath, nodesDir, profilesDir, registryDir, policyPath,
        write: false,
      });
    },
  };
}

function entryFor(out, repo = RELEASE, version = "1.0.0") {
  return out.find((e) => e.repo === repo && e.version === version);
}

// ---------------------------------------------------------------------------
// REG-004 — signature verification + keyId->single-node
// ---------------------------------------------------------------------------
describe("REG-004 build-trust signature verification", () => {
  it("ACCEPTS a release with a valid signature (baseline)", () => {
    const ev = sign(release(), "rel-key", RK.privateKey);
    const out = sandbox([ev]).run();
    assert.ok(entryFor(out), "validly-signed release must appear in trust output");
  });

  it("REJECTS a release whose signature is forged (does not contribute to scores)", () => {
    const ev = sign(release(), "rel-key", RK.privateKey);
    // Tamper the signed payload AFTER signing -> canonicalHash recompute mismatches.
    ev.artifacts[0].sha256 = "c".repeat(64);
    const out = sandbox([ev]).run();
    assert.ok(!entryFor(out), "release with a broken signature must NOT be scored");
  });

  it("REJECTS a release signed by a key that is not the repo's maintainer key", () => {
    // Signed with the rogue key, but the release repo node only knows rel-key.
    const ev = sign(release(), "rogue-key", GK.privateKey);
    const out = sandbox([ev]).run();
    assert.ok(!entryFor(out), "release signed by a non-repo key must NOT be scored");
  });

  it("FAILS when a keyId collides across two trusted nodes (ambiguous attestor resolution)", () => {
    const other = genKeyPair();
    const nodes = [
      nodeManifest(RELEASE, "registry", "rel-key", RK.publicKey),
      nodeManifest(ATTESTOR, "attestor", "dup", AK.publicKey),
      nodeManifest("test-org/attestor2", "attestor", "dup", other.publicKey),
    ];
    const rel = sign(release(), "rel-key", RK.privateKey);
    // An attestation signed with the colliding keyId forces resolution across both trusted nodes.
    const att = sign(attestation([{ type: "signature.chain", uri: "repomesh:attestor:signature.chain:pass" }]),
      "dup", AK.privateKey);
    const policy = {
      v: 1,
      trustedAttestors: [ATTESTOR, "test-org/attestor2", RELEASE],
      trustedPolicy: [RELEASE],
      checks: {},
    };
    assert.throws(() => sandbox([rel, att], { nodes, policy }).run(), /collision|ambiguous|multiple/i,
      "a keyId resolving to >1 trusted node must throw");
  });
});

// ---------------------------------------------------------------------------
// REG-002 — integrity points gated on TRUSTED attestor consensus pass
// ---------------------------------------------------------------------------
describe("REG-002 integrity gating", () => {
  it("does NOT award sbom.present integrity for an INLINE self-declared attestation", () => {
    // Release carries an inline 'sbom' attestation but no trusted AttestationPublished.
    const ev = sign(release({ attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }] }),
      "rel-key", RK.privateKey);
    const out = sandbox([ev]).run();
    const e = entryFor(out);
    assert.ok(e, "release must be scored");
    assert.ok(!e.completedChecks.includes("sbom.present"),
      "inline self-declared sbom must NOT count as a completed integrity check");
    // signed(15) + hasArtifacts(15) + noPolicyViolations(15) = 45. NO +20 for inline sbom.
    assert.equal(e.integrityScore, 45, "inline sbom must not earn integrity points\n" + JSON.stringify(e, null, 2));
  });

  it("AWARDS sbom.present integrity when a TRUSTED attestor published a consensus-pass attestation", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const att = sign(attestation([{ type: "sbom.present", uri: "repomesh:attestor:sbom.present:pass" }], {
      notes: "sbom.present: pass — SBOM verified",
    }), "att-key", AK.privateKey);
    const out = sandbox([rel, att]).run();
    const e = entryFor(out);
    assert.ok(e.completedChecks.includes("sbom.present"), "trusted-attestor sbom pass must count");
    assert.equal(e.integrityScore, 65, "signed+artifacts+noPolicy(45) + sbom.present(20) = 65\n" + JSON.stringify(e, null, 2));
  });

  it("does NOT award integrity when the sbom attestation comes from a NON-trusted node", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    // Rogue is registered but NOT in trustedAttestors (per policy). Its attestation must be ignored.
    const att = sign(attestation([{ type: "sbom.present", uri: "repomesh:attestor:sbom.present:pass" }], {
      notes: "sbom.present: pass — forged",
    }), "rogue-key", GK.privateKey);
    const out = sandbox([rel, att]).run();
    const e = entryFor(out);
    assert.ok(!e.completedChecks.includes("sbom.present"),
      "untrusted attestor sbom must NOT count toward integrity");
    assert.equal(e.integrityScore, 45, "untrusted sbom earns no points\n" + JSON.stringify(e, null, 2));
  });
});

// ---------------------------------------------------------------------------
// REG-003 — badge XML escaping + numeric assertion
// ---------------------------------------------------------------------------
describe("REG-003 badge hardening", () => {
  it("XML-escapes special characters in interpolated label/value", () => {
    const svg = badge("inj&<>\"'", "9</text><script>x</script>", "#4c1");
    assert.ok(!svg.includes("<script>"), "raw <script> must not survive into the SVG");
    assert.ok(svg.includes("&lt;") && svg.includes("&amp;"), "specials must be entity-escaped");
  });

  it("escapeXml maps the 5 XML special characters", () => {
    assert.equal(escapeXml(`& < > " '`), "&amp; &lt; &gt; &quot; &#39;");
  });

  it("asserts a numeric score (rejects a non-numeric score)", () => {
    assert.throws(() => badge("integrity", "NaN/100", "#4c1", { assertNumericScore: true }),
      /numeric|score/i, "a non-numeric score must be rejected when assertNumericScore is set");
    // A numeric score passes.
    const ok = badge("integrity", "65/100", "#4c1", { assertNumericScore: true });
    assert.ok(ok.includes("65/100"));
  });
});

// ---------------------------------------------------------------------------
// REG-005 — dead code deleted
// ---------------------------------------------------------------------------
describe("REG-005 dead code", () => {
  it("registry/scripts/event-cache.mjs is deleted", () => {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, "registry", "scripts", "event-cache.mjs")),
      "event-cache.mjs (dead code) must be removed");
  });
});

// ---------------------------------------------------------------------------
// ANC-004 — build-anchors binds txHash on manifestHash ONLY
// ---------------------------------------------------------------------------
describe("ANC-004 committed anchors.json reflects manifestHash-only binding", () => {
  let anchors;
  before(() => {
    anchors = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "registry", "anchors.json"), "utf8"));
  });

  it("only the partition whose manifestHash matches the on-chain memo carries a txHash", () => {
    // The single genuine anchor memo binds manifestHash 19d31032... (the genesis manifest).
    // Partitions with a DIFFERENT manifestHash must have txHash === null.
    const withTx = anchors.partitions.filter((p) => p.txHash);
    for (const p of withTx) {
      assert.equal(p.manifestHash, "19d31032af4c49b83edb1a56733083c6243d04dd061f146c88ec0e49bd120790",
        `partition ${p.partitionId} carries a txHash but its manifestHash does not match the on-chain memo`);
    }
  });

  it("no txHash is bound to more than one DISTINCT manifestHash", () => {
    const byTx = {};
    for (const p of anchors.partitions) {
      if (!p.txHash) continue;
      (byTx[p.txHash] ||= new Set()).add(p.manifestHash);
    }
    for (const [tx, hashes] of Object.entries(byTx)) {
      assert.equal(hashes.size, 1, `txHash ${tx} is bound to ${hashes.size} distinct manifestHashes`);
    }
  });
});
