// Full-invariant tests for the published-CLI verify-release gate:
//   D1  — repo-bound signer resolution for ReleasePublished
//   D5  — attestation gate (CLI-001 headline + CLI-003 latest-per-(type,signer))
//
// These build a self-consistent local ledger (real Ed25519 keys, real canonical
// hashes) under a temp dir, then drive verifyRelease({ local }) against it.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }
const { canonicalize } = await import(toURL(resolve(srcDir, "verify", "canonicalize.mjs")));

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

// Build + sign an event envelope exactly like the producer does.
function signEvent(body, keyId, privateKey) {
  const ev = { ...body };
  delete ev.signature;
  const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  const value = crypto.sign(null, Buffer.from(canonHash, "hex"), privateKey).toString("base64");
  return { ...ev, signature: { alg: "ed25519", keyId, value, canonicalHash: canonHash } };
}

let tmpRoot;
const writers = [];

function setupRoot() {
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-gate-"));
  // mode.mjs requires ledger/events/events.jsonl + registry/ + schemas/ to consider it "local".
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
}

function writeNode(orgRepo, kind, keyId, publicPem, profileId) {
  const [org, repo] = orgRepo.split("/");
  const dir = join(tmpRoot, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "node.json"), JSON.stringify({
    id: orgRepo, kind, provides: [], consumes: [],
    interfaces: [], invariants: {},
    maintainers: [{ name: org, keyId, publicKey: publicPem, contact: "x@example.com" }],
  }, null, 2));
  if (profileId) {
    fs.writeFileSync(join(dir, "repomesh.profile.json"),
      JSON.stringify({ profileId, profileVersion: "v1" }, null, 2));
  }
}

function writeEvents(events) {
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"),
    events.map(e => JSON.stringify(e)).join("\n") + "\n");
}

// Run verifyRelease capturing exit code + JSON result, with cwd pointed at tmpRoot.
async function runVerify(args) {
  const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit;
  const origCwd = process.cwd;
  const origLog = console.log;
  const origErr = console.error;
  let exitCode = null;
  let out = "";
  process.exit = (code) => { exitCode = code; throw new Error("__EXIT__"); };
  process.cwd = () => tmpRoot;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try {
    await verifyRelease({ json: true, ...args });
  } catch (e) {
    if (e.message !== "__EXIT__") throw e;
  } finally {
    process.exit = origExit;
    process.cwd = origCwd;
    console.log = origLog;
    console.error = origErr;
  }
  let result = null;
  // last JSON blob printed
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch { /* ignore */ } }
  return { exitCode, out, result };
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("D1: repo-bound signer resolution", () => {
  it("rejects a ReleasePublished signed by a key registered to a DIFFERENT repo", async () => {
    const victim = makeKeypair();        // org/victim's real key
    const attacker = makeKeypair();       // attacker controls org/attacker's key
    // Attacker registers their key under org/attacker, then signs a release CLAIMING to be org/victim.
    writeNode("org/victim", "compute", "ci-victim-2026", victim.publicPem, "baseline");
    writeNode("org/attacker", "compute", "ci-attacker-2026", attacker.publicPem, "baseline");

    const forged = signEvent({
      type: "ReleasePublished", repo: "org/victim", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-attacker-2026", attacker.privateKey);

    writeEvents([forged]);
    const { exitCode, result } = await runVerify({ repo: "org/victim", version: "1.0.0" });
    assert.equal(result?.ok, false, "forged cross-repo signature must NOT pass");
    assert.equal(exitCode, 1);
  });

  it("accepts a ReleasePublished signed by the repo's OWN registered key (with no required checks)", async () => {
    const victim = makeKeypair();
    writeNode("org/victim", "compute", "ci-victim-2026", victim.publicPem, "baseline");
    const ev = signEvent({
      type: "ReleasePublished", repo: "org/victim", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-victim-2026", victim.privateKey);
    writeEvents([ev]);
    const { result } = await runVerify({ repo: "org/victim", version: "1.0.0" });
    assert.equal(result?.release?.signatureValid, true, "own-key release signature must verify");
    assert.equal(result?.release?.signerNode, "org/victim");
  });
});

describe("D5: attestation gate (CLI-001 + CLI-003)", () => {
  // helper: a regulated repo requires sbom.present, provenance.present, license.audit, security.scan
  // D12: attestations must be signed by a node in the BUNDLED trusted-attestor allowlist — a random
  // "org/attestor" no longer earns trust. Use an allowlisted org node as the independent attestor.
  const TRUSTED_ATTESTOR = "mcp-tool-shop-org/repomesh-security-verifier";
  function setupRegulatedRelease() {
    const rel = makeKeypair();
    const attestor = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "regulated");
    writeNode(TRUSTED_ATTESTOR, "attestor", "ci-attestor-2026", attestor.publicPem);
    const release = signEvent({
      type: "ReleasePublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-app-2026", rel.privateKey);
    return { rel, attestor, release };
  }

  function attestation({ type, result, repo, ts, keyId, key }) {
    return signEvent({
      type: "AttestationPublished", repo, version: "1.0.0",
      commit: "abcdef0", timestamp: ts,
      artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type, uri: "https://example/" + type }],
      notes: `${type}: ${result} — note`,
    }, keyId, key);
  }

  it("CLI-001: a release whose required attestations are MISSING does NOT pass", async () => {
    const { release } = setupRegulatedRelease();
    writeEvents([release]); // no attestations at all
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "missing required attestations must fail the gate");
    assert.equal(exitCode, 1);
  });

  it("CLI-001: a release with a FAILING required attestation does NOT pass", async () => {
    const { attestor, release } = setupRegulatedRelease();
    const events = [release];
    for (const t of ["sbom.present", "provenance.present", "license.audit"]) {
      events.push(attestation({ type: t, result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    }
    // security.scan FAILS
    events.push(attestation({ type: "security.scan", result: "fail", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    writeEvents(events);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "a failing required attestation must fail the gate");
    assert.equal(exitCode, 1);
  });

  it("CLI-001 (clean path): all required attestations present+pass from an INDEPENDENT attestor PASSES", async () => {
    const { attestor, release } = setupRegulatedRelease();
    const events = [release];
    // regulated requires: sbom.present, provenance.present, signature.chain (integrity)
    // + license.audit, security.scan, repro.build (assurance)
    for (const t of ["sbom.present", "provenance.present", "signature.chain", "license.audit", "security.scan", "repro.build"]) {
      events.push(attestation({ type: t, result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    }
    writeEvents(events);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, true, `clean regulated release should pass; got ${JSON.stringify(result)}`);
    assert.notEqual(exitCode, 1);
  });

  it("CLI-003: LATEST attestation per (type,signer) wins — a later FAIL must override an earlier PASS", async () => {
    const { attestor, release } = setupRegulatedRelease();
    const events = [release];
    for (const t of ["sbom.present", "provenance.present", "license.audit", "repro.build"]) {
      events.push(attestation({ type: t, result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    }
    // security.scan: earlier pass, LATER fail (first-match masking would pick pass)
    events.push(attestation({ type: "security.scan", result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    events.push(attestation({ type: "security.scan", result: "fail", repo: "org/app", ts: "2026-01-09T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    writeEvents(events);
    const { result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "the later FAIL must win over the earlier PASS");
  });

  it("D5 independence: only a SELF-signed attestation (no independent attestor) => UNVERIFIED, not PASS", async () => {
    // Release signer also signs all attestations; no independent attestor.
    // D12: to isolate the independence path (not the allowlist path), the self-signing node is
    // itself an ALLOWLISTED attestor node — so its attestations RESOLVE + satisfy the gate, but
    // they are NOT independent (signer === release signer). The only objection is independence.
    const SOLO = "mcp-tool-shop-org/repomesh-security-verifier";
    const rel = makeKeypair();
    writeNode(SOLO, "attestor", "ci-solo-2026", rel.publicPem, "regulated");
    const release = signEvent({
      type: "ReleasePublished", repo: SOLO, version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-solo-2026", rel.privateKey);
    const events = [release];
    // Satisfy EVERY required type (so the gate's only objection is the lack of an
    // independent attestor — isolating the UNVERIFIED path).
    for (const t of ["sbom.present", "provenance.present", "signature.chain", "license.audit", "security.scan", "repro.build"]) {
      events.push(signEvent({
        type: "AttestationPublished", repo: SOLO, version: "1.0.0",
        commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
        artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
        attestations: [{ type: t, uri: "x" }], notes: `${t}: pass`,
      }, "ci-solo-2026", rel.privateKey));
    }
    writeEvents(events);
    const { exitCode, result } = await runVerify({ repo: SOLO, version: "1.0.0" });
    assert.equal(result?.ok, false, "self-signed-only must not PASS");
    // FC1: self-signed-only is UNVERIFIED (no independent witness) -> exit 3 (verdict unchanged).
    assert.equal(result?.gate?.status, "UNVERIFIED");
    assert.equal(exitCode, 3);
    // Should be reported as UNVERIFIED somewhere in the result
    const blob = JSON.stringify(result).toLowerCase();
    assert.match(blob, /unverified/, "self-signed-only should be reported UNVERIFIED");
  });
});
