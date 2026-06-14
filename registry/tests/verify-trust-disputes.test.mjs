// Registry domain — FC6 (#4 LSP-01) CONSUMER DISPLAY: verify-trust.mjs surfaces the DISPUTED state.
//
// build-trust.mjs (the producer) marks a release DISPUTED and writes `disputed`/`disputes`/`verdict`
// into registry/trust.json (see registry-disputes.test.mjs). This test exercises the CONSUMER:
// verify-trust.mjs must print a prominent "⛔ DISPUTED by <node>: <reason>" line near the top of its
// output — one line per active dispute — with the machine "disputed:<hash>" token stripped for
// legibility (same as build-trust's trustSummary), while keeping the existing exit-1 behavior.
//
// Pattern mirrors the D17 child-process exercise in registry-amend-wave2.test.mjs: build + persist a
// trust index in a sandbox, assemble a fake repo root whose registry/ledger/nodes/profiles point at
// it, copy the real verify-trust.mjs next to that fake registry, and run it as a child process.

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
const RELEASE_HASH = "b".repeat(64); // the released artifact's sha256 — what a dispute targets.
const DISPUTE_REASON = "artifact does not match the signed source tree";

function release(over = {}) {
  return {
    type: "ReleasePublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T00:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
    attestations: [], ...over,
  };
}
// A dispute is carried on an AttestationPublished whose attestations[] includes attestation.dispute.
// The notes line carries the machine "disputed:<hash>" token followed by the human reason.
function dispute(over = {}) {
  return {
    type: "AttestationPublished", repo: RELEASE, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-03-01T03:00:00.000Z",
    artifacts: [{ name: "bundle.js", sha256: RELEASE_HASH, uri: "https://example.com/b.js" }],
    attestations: [{ type: "attestation.dispute", uri: "repomesh:dispute:integrity" }],
    notes: `attestation.dispute against released artifact disputed:${RELEASE_HASH} — ${DISPUTE_REASON}`,
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

let RK, AK;
before(() => { RK = genKeyPair(); AK = genKeyPair(); });

// Build a sandbox (nodes tree + events.jsonl + profiles + verifier.policy.json) and PERSIST the
// trust index so a separate verify-trust.mjs process can read registry/trust.json end-to-end.
function sandbox(events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-vtd-"));
  const nodesDir = path.join(dir, "nodes");
  const profilesDir = path.join(dir, "profiles");
  const registryDir = path.join(dir, "registry");
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(registryDir, { recursive: true });

  for (const n of [
    nodeManifest(RELEASE, "registry", "rel-key", RK.publicKey),
    nodeManifest(ATTESTOR, "attestor", "att-key", AK.publicKey),
  ]) {
    const [org, repo] = n.id.split("/");
    const p = path.join(nodesDir, org, repo);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "node.json"), JSON.stringify(n, null, 2));
  }

  const policyPath = path.join(dir, "verifier.policy.json");
  fs.writeFileSync(policyPath, JSON.stringify({
    v: 1,
    // ATTESTOR is a trusted attestor → its dispute survives signature resolution and affects scoring.
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

  // Persist registry/trust.json so verify-trust.mjs can be exercised against it.
  buildTrust({ ledgerPath, nodesDir, profilesDir, registryDir, policyPath, write: true });

  return { dir, nodesDir, registryDir, ledgerPath };
}

// Run the REAL verify-trust.mjs against the sandbox. verify-trust computes ROOT as
// path.resolve(import.meta.dirname, "..", ".."), so we assemble a fake repo root whose
// registry/ledger/nodes point at the sandbox artifacts and copy the script next to it.
function runVerifyTrust(sb, { repo = RELEASE, version = "1.0.0" } = {}) {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rm-vtd-root-"));
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

  const fakeScriptDir = path.join(reg, "scripts");
  fs.mkdirSync(fakeScriptDir, { recursive: true });
  fs.copyFileSync(VERIFY_TRUST, path.join(fakeScriptDir, "verify-trust.mjs"));

  let stdout = "", status = 0;
  try {
    stdout = execFileSync("node", [
      path.join(fakeScriptDir, "verify-trust.mjs"), "--repo", repo, "--version", version,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    stdout = err.stdout || "";
    status = typeof err.status === "number" ? err.status : 1;
  }
  return { stdout, status };
}

describe("FC6 verify-trust surfaces the DISPUTED state (#4 LSP-01, consumer display)", () => {
  it("prints a prominent ⛔ DISPUTED line naming the disputing node and the (stripped) reason", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const disp = sign(dispute(), "att-key", AK.privateKey); // trusted, non-self → affects scoring
    const { stdout, status } = runVerifyTrust(sandbox([rel, disp]));

    const line = stdout.split("\n").find((l) => l.includes("DISPUTED by"));
    assert.ok(line, "verify-trust output must include a 'DISPUTED by' line\n" + stdout);
    assert.ok(line.includes("⛔"), "the DISPUTED line must carry the ⛔ marker\n" + line);
    assert.ok(line.includes(ATTESTOR), `the DISPUTED line must name the disputing node (${ATTESTOR})\n` + line);
    assert.ok(line.includes(DISPUTE_REASON), "the DISPUTED line must carry the human reason\n" + line);
    // The machine "disputed:<hash>" token must be stripped for legibility.
    assert.ok(!line.includes(`disputed:${RELEASE_HASH}`),
      "the machine disputed:<hash> token must be stripped from the displayed reason\n" + line);
    assert.ok(!line.includes(RELEASE_HASH),
      "the 64-hex artifact hash must not leak into the DISPUTED line\n" + line);

    // Exit-1 behavior is preserved (a disputed release is capped below the integrity floor).
    assert.equal(status, 1, "a disputed release must still exit 1\n" + stdout);
  });

  it("prints no DISPUTED line for an undisputed release", () => {
    const rel = sign(release(), "rel-key", RK.privateKey);
    const { stdout } = runVerifyTrust(sandbox([rel]));
    assert.ok(!/DISPUTED/.test(stdout),
      "an undisputed release must not surface any DISPUTED state\n" + stdout);
  });
});
