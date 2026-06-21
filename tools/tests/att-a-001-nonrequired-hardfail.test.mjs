// ATT-A-001 (HIGH) regression — tools/verify-release.mjs must HARD-FAIL on ANY validly-signed
// trusted-attestor attestation whose result is "fail", EVEN when the attestation type is NOT in
// the repo's profile-required set.
//
// THE BUG: the published CLI (packages/repomesh-cli/src/verify/verify-release.mjs) has, AFTER the
// required-types gate, a loop that surfaces any selected attestation that is a hard fail:
//     for (const a of result.attestations) {
//       if (a.signatureValid && a.result === "fail") gate.failures.push({...});  // -> FAIL
//     }
// tools/verify-release.mjs had NO equivalent — it only iterated requiredAttestationTypes. So a
// baseline-profile release (requires no types) carrying a trusted-attestor security.scan:fail plus
// an independent passing witness returned PASS from tools/ but FAIL from the published CLI.
//
// TEST-FIRST: on the PRE-FIX tools/ code this scenario verdict is PASS (verification exit 0) — these
// assertions are RED there. After the non-required-hard-fail loop is ported in, the verdict is FAIL.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

// One allowlisted (bundled trusted) attestor + a SECOND distinct allowlisted attestor, so the
// failing attestation is trusted AND there is an independent passing witness. Both differ from the
// release signer node, so independence is satisfied and the ONLY objection is the hard fail.
const FAIL_ATTESTOR = "mcp-tool-shop-org/repomesh-security-verifier"; // signs the security.scan:fail
const WITNESS_ATTESTOR = "mcp-tool-shop-org/repomesh-license-verifier"; // independent passing witness

function makeTempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-att-a-001-")); }

function generateTestKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function canonicalize(value) { return JSON.stringify(sortKeys(value)); }
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  }
  return v;
}

function signEvent(ev, privateKeyPem, keyId) {
  const copy = JSON.parse(JSON.stringify(ev));
  copy.signature = { alg: "ed25519", keyId, value: "", canonicalHash: "" };
  const stripped = JSON.parse(JSON.stringify(copy));
  delete stripped.signature;
  const hash = crypto.createHash("sha256").update(canonicalize(stripped), "utf8").digest("hex");
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), crypto.createPrivateKey(privateKeyPem));
  copy.signature.value = sig.toString("base64");
  copy.signature.canonicalHash = hash;
  return copy;
}

function buildLedger(tmpDir, events) {
  const dir = path.join(tmpDir, "ledger", "events");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

function registerNode(tmpDir, repoId, kind, keyId, publicKeyPem) {
  const [org, repo] = repoId.split("/");
  const dir = path.join(tmpDir, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "node.json"),
    JSON.stringify({ id: repoId, kind, maintainers: [{ keyId, publicKey: publicKeyPem, contact: "x@x" }] }, null, 2), "utf8");
}

function runVerify(tmpDir, args) {
  const { execSync } = require("node:child_process");
  try {
    const stdout = execSync(`node tools/verify-release.mjs ${args}`, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_ROOT: tmpDir,
        REPOMESH_OFFLINE: "1",
      },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || "" };
  }
}

function attestation(repo, type, result, ts, keyId, privateKeyPem) {
  return signEvent({
    type: "AttestationPublished", repo, version: "1.0.0", commit: "abc",
    timestamp: ts,
    attestations: [{ type, uri: "https://example/" + type }],
    notes: `${type}: ${result} — note`,
  }, privateKeyPem, keyId);
}

describe("ATT-A-001 tools — non-required trusted-attestor hard fail must FAIL the verdict", () => {
  it("baseline profile + trusted-attestor security.scan:fail + independent passing witness => FAIL", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "org/app";
      const relKeys = generateTestKeypair();
      const failKeys = generateTestKeypair();
      const witnessKeys = generateTestKeypair();

      // Release repo: baseline profile (no requiredAttestationTypes) — i.e. NO repomesh.profile.json.
      registerNode(tmpDir, repo, "tool", "ci-app-2026", relKeys.publicKeyPem);
      registerNode(tmpDir, FAIL_ATTESTOR, "attestor", "ci-fail-2026", failKeys.publicKeyPem);
      registerNode(tmpDir, WITNESS_ATTESTOR, "attestor", "ci-witness-2026", witnessKeys.publicKeyPem);

      const release = signEvent({
        type: "ReleasePublished", repo, version: "1.0.0", commit: "abc",
        timestamp: "2026-06-01T00:00:00Z", artifacts: [], notes: "",
      }, relKeys.privateKeyPem, "ci-app-2026");

      // NON-required (baseline requires nothing) security.scan:fail from a TRUSTED attestor.
      const failAtt = attestation(repo, "security.scan", "fail", "2026-06-02T00:00:00Z", "ci-fail-2026", failKeys.privateKeyPem);
      // An INDEPENDENT passing witness (different node) so independence alone is satisfied.
      const passAtt = attestation(repo, "license.audit", "pass", "2026-06-02T00:00:00Z", "ci-witness-2026", witnessKeys.privateKeyPem);

      buildLedger(tmpDir, [release, failAtt, passAtt]);

      const r = runVerify(tmpDir, `--repo ${repo} --version 1.0.0 --json`);
      const out = JSON.parse(r.stdout);

      // The attestation must be SELECTED with a valid signature + result fail (proves the scenario set up right).
      const sel = (out.attestations || []).find(a => a.type === "security.scan");
      assert.ok(sel, "security.scan attestation must be selected");
      assert.equal(sel.signatureValid, true, "the failing attestation must be from a trusted attestor (valid sig)");
      assert.equal(sel.result, "fail");

      // THE FIX: a validly-signed trusted-attestor result:fail — even NON-required — hard-fails the verdict.
      assert.equal(out.ok, false, "a non-required trusted-attestor hard fail must FAIL the verdict");
      assert.equal(out.gate.verdict, "FAIL", "gate verdict must be FAIL");
      assert.ok((out.gate.failed || []).includes("security.scan"),
        "security.scan must appear in gate.failed");
      assert.notEqual(r.status, 0, "a hard-fail verdict must exit non-zero");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
