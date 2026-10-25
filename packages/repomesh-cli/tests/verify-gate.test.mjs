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
const importFromSrc = (...parts) => import(toURL(resolve(srcDir, ...parts)));
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
  const { verifyRelease } = await importFromSrc("verify", "verify-release.mjs");
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
  const TRUSTED_ATTESTOR = "mcp-tool-shop-org/repomesh";
  function setupRegulatedRelease() {
    const rel = makeKeypair();
    const attestor = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "regulated");
    writeNode(TRUSTED_ATTESTOR, "registry", "ci-attestor-2026", attestor.publicPem);
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
    const SOLO = "mcp-tool-shop-org/repomesh";
    const rel = makeKeypair();
    writeNode(SOLO, "registry", "ci-solo-2026", rel.publicPem, "regulated");
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

  it("per-type note matching: a first-line pass for another type does NOT satisfy a listed type whose note fails or is absent", async () => {
    const { attestor, release } = setupRegulatedRelease();
    const events = [release];
    for (const t of ["sbom.present", "provenance.present", "signature.chain", "license.audit"]) {
      events.push(attestation({ type: t, result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    }
    events.push(signEvent({
      type: "AttestationPublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
      artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [
        { type: "repro.build", uri: "https://example/repro.build" },
        { type: "security.scan", uri: "https://example/security.scan" },
      ],
      notes: "repro.build: pass — reproducible build verified\nsecurity.scan: fail — vulnerability detected",
    }, "ci-attestor-2026", attestor.privateKey));
    writeEvents(events);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    const scanAtt = (result?.attestations || []).find((a) => a.type === "security.scan");
    assert.equal(scanAtt?.result, "fail", "security.scan must match its own note line (fail), not the first line (repro.build: pass)");
    assert.equal(result?.ok, false, "gate must fail when security.scan note is fail behind a first-line pass for another type");
    assert.ok(!(result?.gate?.satisfied || []).includes("security.scan"), "security.scan must not be reported satisfied");
    assert.equal(exitCode, 1);
  });

  function setupPolicyScopedRelease() {
    fs.copyFileSync(resolve(__dirname, "..", "..", "..", "verifier.policy.json"), join(tmpRoot, "verifier.policy.json"));
    const rel = makeKeypair();
    const reg = makeKeypair();
    const lic = makeKeypair();
    const sec = makeKeypair();
    const repro = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "regulated");
    writeNode("mcp-tool-shop-org/repomesh", "registry", "ci-repomesh-2026", reg.publicPem);
    writeNode("mcp-tool-shop-org/repomesh-license-verifier", "attestor", "ci-license-2026", lic.publicPem);
    writeNode("mcp-tool-shop-org/repomesh-security-verifier", "attestor", "ci-security-2026", sec.publicPem);
    writeNode("mcp-tool-shop-org/repomesh-repro-verifier", "attestor", "ci-repro-2026", repro.publicPem);
    const release = signEvent({
      type: "ReleasePublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-app-2026", rel.privateKey);
    const baseAtts = [
      attestation({ type: "sbom.present", result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-repomesh-2026", key: reg.privateKey }),
      attestation({ type: "provenance.present", result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-repomesh-2026", key: reg.privateKey }),
      attestation({ type: "signature.chain", result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-repomesh-2026", key: reg.privateKey }),
      attestation({ type: "license.audit", result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-license-2026", key: lic.privateKey }),
      attestation({ type: "repro.build", result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-repro-2026", key: repro.privateKey }),
    ];
    return { release, baseAtts, lic, sec };
  }

  it("S6a: a license verifier's security.scan: pass does NOT satisfy the gate under trusted-set policy", async () => {
    const { release, baseAtts, lic } = setupPolicyScopedRelease();
    writeEvents([
      release,
      ...baseAtts,
      attestation({ type: "security.scan", result: "pass", repo: "org/app", ts: "2026-01-02T00:01:00Z", keyId: "ci-license-2026", key: lic.privateKey }),
    ]);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "license verifier is not in checks['security.scan'].trustedNodes and must not satisfy security.scan");
    assert.ok(!(result?.gate?.satisfied || []).includes("security.scan"), "security.scan must not be satisfied");
    assert.ok((result?.gate?.failures || []).some((f) => f.check === "security.scan"), "security.scan must be reported as a gate failure");
    assert.equal(exitCode, 1);
  });

  it("S6b: a license verifier's security.scan: fail does NOT hard-fail a trusted security verifier's pass", async () => {
    const { release, baseAtts, lic, sec } = setupPolicyScopedRelease();
    writeEvents([
      release,
      ...baseAtts,
      attestation({ type: "security.scan", result: "pass", repo: "org/app", ts: "2026-01-02T00:01:00Z", keyId: "ci-security-2026", key: sec.privateKey }),
      attestation({ type: "security.scan", result: "fail", repo: "org/app", ts: "2026-01-02T00:02:00Z", keyId: "ci-license-2026", key: lic.privateKey }),
    ]);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, true, "untrusted-for-check fail must not override trusted security verifier pass");
    assert.ok((result?.gate?.satisfied || []).includes("security.scan"), "security.scan must be satisfied by the trusted security verifier");
    assert.deepEqual(result?.gate?.failures || [], []);
    assert.equal(exitCode, 0);
  });

  async function runVerifyRemote(args) {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      const p = join(tmpRoot, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(tmpRoot) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.statusCode = 404;
        return res.end("nf");
      }
      res.end(fs.readFileSync(p));
    });
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${server.address().port}`;
    const nonCheckoutDir = fs.mkdtempSync(join(os.tmpdir(), "repomesh-remote-cwd-"));
    const { verifyRelease } = await importFromSrc("verify", "verify-release.mjs");
    const origExit = process.exit;
    const origCwd = process.cwd;
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;
    let exitCode = null;
    let out = "";
    process.exit = (code) => { exitCode = code; throw new Error("__EXIT__"); };
    process.cwd = () => nonCheckoutDir;
    console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
    console.error = () => {};
    console.warn = () => {};
    try {
      await verifyRelease({
        json: true,
        ledgerUrl: `${base}/ledger/events/events.jsonl`,
        nodesUrl: `${base}/ledger/nodes`,
        manifestsUrl: `${base}/anchor/xrpl/manifests`,
        ...args,
      });
    } catch (e) {
      if (e.message !== "__EXIT__") throw e;
    } finally {
      process.exit = origExit;
      process.cwd = origCwd;
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
      await new Promise((ok) => server.close(ok));
      try { fs.rmSync(nonCheckoutDir, { recursive: true, force: true }); } catch {}
    }
    let result = null;
    const blobs = out.match(/\{[\s\S]*\}/g);
    if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch { /* ignore */ } }
    return { exitCode, out, result };
  }

  it("remote-mode S6a: a license verifier's security.scan: pass does NOT count as an independent witness or satisfy security.scan", async () => {
    const { release, lic } = setupPolicyScopedRelease();
    fs.rmSync(join(tmpRoot, "verifier.policy.json"), { force: true });
    writeEvents([
      release,
      attestation({ type: "security.scan", result: "pass", repo: "org/app", ts: "2026-01-02T00:01:00Z", keyId: "ci-license-2026", key: lic.privateKey }),
    ]);
    const { exitCode, result } = await runVerifyRemote({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "remote mode: license verifier's security.scan: pass must not make the release PASS");
    assert.equal(result?.gate?.status, "UNVERIFIED", "remote mode: unauthorized security.scan signer must not count as an independent witness");
    assert.deepEqual(result?.gate?.independentAttestors || [], []);
    assert.ok(!(result?.gate?.satisfied || []).includes("security.scan"));
    assert.equal(exitCode, 3);
  });

  it("remote-mode S6b: a license verifier's security.scan: fail does NOT hard-fail a trusted security verifier's pass", async () => {
    const { release, baseAtts, lic, sec } = setupPolicyScopedRelease();
    fs.rmSync(join(tmpRoot, "verifier.policy.json"), { force: true });
    writeEvents([
      release,
      ...baseAtts,
      attestation({ type: "security.scan", result: "pass", repo: "org/app", ts: "2026-01-02T00:01:00Z", keyId: "ci-security-2026", key: sec.privateKey }),
      attestation({ type: "security.scan", result: "fail", repo: "org/app", ts: "2026-01-02T00:02:00Z", keyId: "ci-license-2026", key: lic.privateKey }),
    ]);
    const { exitCode, result } = await runVerifyRemote({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, true, "remote mode: license verifier's security.scan: fail must not hard-fail a trusted security verifier's pass");
    assert.equal(result?.gate?.status, "PASS");
    assert.deepEqual(result?.gate?.failures || [], []);
    assert.equal(exitCode, 0);
  });

  it("shipped BUNDLED_CHECK_POLICIES stays in step with verifier.policy.json and only narrows (never widens)", async () => {
    const remoteDefaults = await importFromSrc("remote-defaults.mjs");
    const { isSignerTrustedForCheck } = await importFromSrc("verify", "key-window.mjs");
    const repoPolicy = JSON.parse(fs.readFileSync(resolve(__dirname, "..", "..", "..", "verifier.policy.json"), "utf8"));
    assert.ok(remoteDefaults.BUNDLED_CHECK_POLICIES && typeof remoteDefaults.BUNDLED_CHECK_POLICIES === "object",
      "remote-defaults.mjs must export BUNDLED_CHECK_POLICIES");
    assert.equal(typeof remoteDefaults.resolveCheckPolicy, "function",
      "remote-defaults.mjs must export resolveCheckPolicy");

    const policyCheckKeys = Object.keys(repoPolicy.checks).sort();
    const bundledCheckKeys = Object.keys(remoteDefaults.BUNDLED_CHECK_POLICIES).sort();
    assert.deepEqual(bundledCheckKeys, policyCheckKeys,
      "BUNDLED_CHECK_POLICIES keys must match verifier.policy.json checks");
    for (const k of policyCheckKeys) {
      assert.equal(remoteDefaults.BUNDLED_CHECK_POLICIES[k].mode, repoPolicy.checks[k].mode, `mode mismatch on ${k}`);
      assert.deepEqual(
        [...remoteDefaults.BUNDLED_CHECK_POLICIES[k].trustedNodes].sort(),
        [...(repoPolicy.checks[k].trustedNodes || [])].sort(),
        `trustedNodes mismatch on ${k}`,
      );
    }

    // Narrowing: a policy may intersect trustedNodes, never union/widen or flip trusted-set -> open.
    const widened = remoteDefaults.resolveCheckPolicy("security.scan", {
      checks: {
        "security.scan": {
          mode: "trusted-set",
          trustedNodes: [
            "mcp-tool-shop-org/repomesh-security-verifier",
            "mcp-tool-shop-org/repomesh-license-verifier",
            "rogue-org/rogue",
          ],
        },
      },
    });
    assert.equal(widened.mode, "trusted-set");
    assert.deepEqual(widened.trustedNodes, ["mcp-tool-shop-org/repomesh-security-verifier"]);

    const modeFlipAttempt = remoteDefaults.resolveCheckPolicy("security.scan", {
      checks: { "security.scan": { mode: "open", trustedNodes: [] } },
    });
    assert.equal(modeFlipAttempt.mode, "trusted-set");
    assert.deepEqual(
      [...modeFlipAttempt.trustedNodes].sort(),
      [...repoPolicy.checks["security.scan"].trustedNodes].sort(),
    );

    const narrowedEmpty = remoteDefaults.resolveCheckPolicy("security.scan", {
      checks: { "security.scan": { mode: "trusted-set", trustedNodes: [] } },
    });
    assert.equal(narrowedEmpty.mode, "trusted-set");
    assert.deepEqual(narrowedEmpty.trustedNodes, []);
    assert.equal(isSignerTrustedForCheck("mcp-tool-shop-org/repomesh-security-verifier", narrowedEmpty), false,
      "an empty trusted-set must be closed (trust nobody), not open");

    const openNarrowed = remoteDefaults.resolveCheckPolicy("repro.build", {
      checks: {
        "repro.build": {
          mode: "trusted-set",
          trustedNodes: ["mcp-tool-shop-org/repomesh-repro-verifier", "rogue-org/rogue"],
        },
      },
    });
    assert.equal(openNarrowed.mode, "trusted-set");
    assert.deepEqual(openNarrowed.trustedNodes, ["mcp-tool-shop-org/repomesh-repro-verifier"]);

    const customTrusted = remoteDefaults.resolveCheckPolicy("custom.check", {
      checks: {
        "custom.check": {
          mode: "trusted-set",
          trustedNodes: ["mcp-tool-shop-org/repomesh", "rogue-org/rogue"],
        },
      },
    });
    assert.equal(customTrusted.mode, "trusted-set");
    assert.deepEqual(customTrusted.trustedNodes, ["mcp-tool-shop-org/repomesh"]);

    const customOpen = remoteDefaults.resolveCheckPolicy("custom.open", {
      checks: { "custom.open": { mode: "open" } },
    });
    assert.equal(customOpen.mode, "open");
    assert.deepEqual(customOpen.trustedNodes, []);

    assert.equal(remoteDefaults.resolveCheckPolicy("", null), null);
    assert.equal(remoteDefaults.resolveCheckPolicy("unknown.check", null), null);
  });

  it("CLI-003 mirror: fail then a later pass from the same trusted signer resolves to PASS", async () => {
    const { attestor, release } = setupRegulatedRelease();
    const events = [release];
    for (const t of ["sbom.present", "provenance.present", "signature.chain", "license.audit", "repro.build"]) {
      events.push(attestation({ type: t, result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    }
    events.push(attestation({ type: "security.scan", result: "fail", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    events.push(attestation({ type: "security.scan", result: "pass", repo: "org/app", ts: "2026-01-09T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    writeEvents(events);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, true, "the later PASS must win over the earlier FAIL");
    assert.equal(result?.gate?.status, "PASS");
    assert.equal(exitCode, 0);
  });

  it("timestamp tie: ties go to the later ledger position in the CLI", async () => {
    const { attestor, release } = setupRegulatedRelease();
    const base = [release];
    for (const t of ["sbom.present", "provenance.present", "signature.chain", "license.audit", "repro.build"]) {
      base.push(attestation({ type: t, result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    }
    const tiedTs = "2026-01-02T00:05:00Z";
    const passEv = attestation({ type: "security.scan", result: "pass", repo: "org/app", ts: tiedTs, keyId: "ci-attestor-2026", key: attestor.privateKey });
    const failEv = attestation({ type: "security.scan", result: "fail", repo: "org/app", ts: tiedTs, keyId: "ci-attestor-2026", key: attestor.privateKey });

    writeEvents([...base, passEv, failEv]);
    const r1 = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(r1.result?.ok, false, "tie: later fail in ledger order must win over earlier pass");
    assert.equal((r1.result?.attestations || []).find((a) => a.type === "security.scan")?.result, "fail");

    writeEvents([...base, failEv, passEv]);
    const r2 = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(r2.result?.ok, true, "tie: later pass in ledger order must win over earlier fail");
    assert.equal((r2.result?.attestations || []).find((a) => a.type === "security.scan")?.result, "pass");
  });

  it("invalid-signature later event never competes or overrides an earlier valid pass in the CLI", async () => {
    const { rel, attestor, release } = setupRegulatedRelease();
    const events = [release];
    for (const t of ["sbom.present", "provenance.present", "signature.chain", "license.audit", "repro.build"]) {
      events.push(attestation({ type: t, result: "pass", repo: "org/app", ts: "2026-01-02T00:00:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    }
    events.push(attestation({ type: "security.scan", result: "pass", repo: "org/app", ts: "2026-01-02T00:01:00Z", keyId: "ci-attestor-2026", key: attestor.privateKey }));
    // Later event claiming the same keyId ("ci-attestor-2026") but signed with the wrong key (invalid signature)
    events.push(attestation({ type: "security.scan", result: "fail", repo: "org/app", ts: "2026-01-09T00:00:00Z", keyId: "ci-attestor-2026", key: rel.privateKey }));
    writeEvents(events);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, true, "invalid-signature later fail must never compete or fail the gate");
    assert.equal(result?.gate?.status, "PASS");
    const scanAtts = (result?.attestations || []).filter((a) => a.type === "security.scan");
    assert.equal(scanAtts.length, 1);
    assert.equal(scanAtts[0].result, "pass");
    assert.equal(exitCode, 0);
  });
});
