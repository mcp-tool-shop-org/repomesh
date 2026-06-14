// FC1/FC3/FC4/FC5 — CLI feature tests (build wave 1, Phase 7).
//
//   FC3 (#2)  --local [dir] verifies a local ledger and WINS over the auto-detect.
//   FC1 (#3)  exit code is tri-state from gate.status: PASS=0, FAIL=1, UNVERIFIED=3, error=2;
//             --fail-on <fail|unverified> moves only whether UNVERIFIED is success.
//   FC4 (#14) --format <text|json|sarif|markdown> (--json = alias for json); valid SARIF 2.1.0.
//   FC5 (#15) verify-all aggregates >=2 releases in one ledger load; exit = worst row per --fail-on.
//
// ADDITIVE: these tests must not change any Stage A trust verdict — a legit release stays PASS,
// a forged/self-signed-only one stays UNVERIFIED/FAIL. Only the exit-code mapping is new.
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
  return { privateKey, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
function signEvent(body, keyId, privateKey) {
  const ev = { ...body }; delete ev.signature;
  const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  const value = crypto.sign(null, Buffer.from(canonHash, "hex"), privateKey).toString("base64");
  return { ...ev, signature: { alg: "ed25519", keyId, value, canonicalHash: canonHash } };
}

let tmpRoot;
function setupRoot() {
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-feat-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
}
function writeNode(orgRepo, kind, keyId, publicPem, profileId) {
  const [org, repo] = orgRepo.split("/");
  const dir = join(tmpRoot, "ledger", "nodes", org, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "node.json"), JSON.stringify({
    id: orgRepo, kind, provides: [], consumes: [], interfaces: [], invariants: {},
    maintainers: [{ name: org, keyId, publicKey: publicPem, contact: "x@example.com" }],
  }, null, 2));
  if (profileId) fs.writeFileSync(join(dir, "repomesh.profile.json"), JSON.stringify({ profileId, profileVersion: "v1" }, null, 2));
}
function writeEvents(events) {
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"),
    events.map(e => JSON.stringify(e)).join("\n") + "\n");
}
function baselineRelease(key, keyId, repo = "org/app", version = "1.0.0") {
  return signEvent({
    type: "ReleasePublished", repo, version,
    commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
    artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
  }, keyId, key.privateKey);
}

// Run verifyRelease with cwd NOT a checkout (so only an explicit --local can reach the ledger),
// capturing exit code + stdout. `cwdOverride` lets a test point cwd elsewhere.
async function runVerify(args, { json = true, cwdOverride } = {}) {
  const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let exitCode = null, out = "", err = "";
  process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
  process.cwd = () => cwdOverride || os.tmpdir(); // a NON-checkout dir, so auto-detect is false
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = (m) => { err += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  try { await verifyRelease({ json, ...args }); }
  catch (e) { if (e.message !== "__EXIT__") throw e; }
  finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch {} }
  return { exitCode, out, err, result };
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("FC3: --local [dir] verifies a local ledger and WINS over auto-detect", () => {
  it("explicit local dir verifies a release even when cwd is NOT a checkout", async () => {
    // A clean baseline release with an independent attestor so it PASSES.
    const rel = makeKeypair(); const attestor = makeKeypair();
    const ATT = "mcp-tool-shop-org/repomesh-security-verifier";
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "baseline");
    writeNode(ATT, "attestor", "ci-att-2026", attestor.publicPem);
    const release = baselineRelease(rel, "ci-app-2026");
    const att = signEvent({
      type: "AttestationPublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
      artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type: "security.scan", uri: "x" }], notes: "security.scan: pass",
    }, "ci-att-2026", attestor.privateKey);
    writeEvents([release, att]);
    // cwd is os.tmpdir() (NOT a checkout). Only --local <tmpRoot> can find the ledger.
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0", localDir: tmpRoot });
    assert.equal(result?.release?.signatureValid, true, "explicit --local dir must locate the local ledger");
    assert.equal(result?.gate?.status, "PASS", "an independently-attested baseline release passes");
    assert.equal(exitCode, 0);
  });

  it("missing release in the local ledger is a usage error (exit 2), not a crash", async () => {
    const rel = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "baseline");
    writeEvents([baselineRelease(rel, "ci-app-2026")]);
    const { exitCode } = await runVerify({ repo: "org/nope", version: "9.9.9", localDir: tmpRoot });
    assert.equal(exitCode, 2, "release-not-found is a usage error -> exit 2");
  });
});

describe("FC1: tri-state exit codes from gate.status", () => {
  it("PASS -> exit 0", async () => {
    const rel = makeKeypair(); const attestor = makeKeypair();
    const ATT = "mcp-tool-shop-org/repomesh-security-verifier";
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "baseline");
    writeNode(ATT, "attestor", "ci-att-2026", attestor.publicPem);
    const att = signEvent({
      type: "AttestationPublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
      artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type: "security.scan", uri: "x" }], notes: "security.scan: pass",
    }, "ci-att-2026", attestor.privateKey);
    writeEvents([baselineRelease(rel, "ci-app-2026"), att]);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0", localDir: tmpRoot });
    assert.equal(result?.gate?.status, "PASS");
    assert.equal(exitCode, 0);
  });

  it("FAIL (forged cross-repo signature) -> exit 1", async () => {
    const victim = makeKeypair(); const attacker = makeKeypair();
    writeNode("org/victim", "compute", "ci-victim-2026", victim.publicPem, "baseline");
    writeNode("org/attacker", "compute", "ci-attacker-2026", attacker.publicPem, "baseline");
    const forged = signEvent({
      type: "ReleasePublished", repo: "org/victim", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-attacker-2026", attacker.privateKey);
    writeEvents([forged]);
    const { exitCode, result } = await runVerify({ repo: "org/victim", version: "1.0.0", localDir: tmpRoot });
    assert.equal(result?.gate?.status, "FAIL");
    assert.equal(exitCode, 1);
  });

  it("UNVERIFIED (self-signed, no witness) -> exit 3 by default", async () => {
    const k = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", k.publicPem, "baseline");
    writeEvents([baselineRelease(k, "ci-app-2026")]);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0", localDir: tmpRoot });
    assert.equal(result?.gate?.status, "UNVERIFIED", "self-signed-only stays UNVERIFIED (verdict unchanged)");
    assert.equal(exitCode, 3, "UNVERIFIED is exit 3 under default --fail-on=unverified");
  });

  it("--fail-on=fail relaxes UNVERIFIED to exit 0 (status stays UNVERIFIED)", async () => {
    const k = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", k.publicPem, "baseline");
    writeEvents([baselineRelease(k, "ci-app-2026")]);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0", localDir: tmpRoot, failOn: "fail" });
    assert.equal(result?.gate?.status, "UNVERIFIED", "the trust verdict must NOT change with --fail-on");
    assert.equal(exitCode, 0, "--fail-on=fail treats UNVERIFIED as success");
  });

  it("--fail-on=fail still fails a forged release with exit 1", async () => {
    const victim = makeKeypair(); const attacker = makeKeypair();
    writeNode("org/victim", "compute", "ci-victim-2026", victim.publicPem, "baseline");
    writeNode("org/attacker", "compute", "ci-attacker-2026", attacker.publicPem, "baseline");
    const forged = signEvent({
      type: "ReleasePublished", repo: "org/victim", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-attacker-2026", attacker.privateKey);
    writeEvents([forged]);
    const { exitCode } = await runVerify({ repo: "org/victim", version: "1.0.0", localDir: tmpRoot, failOn: "fail" });
    assert.equal(exitCode, 1, "FAIL is always 1 regardless of --fail-on");
  });
});

describe("FC4: --format sarif/markdown/json", () => {
  function unverifiedLedger() {
    const k = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", k.publicPem, "baseline");
    writeEvents([baselineRelease(k, "ci-app-2026")]);
  }

  it("--format sarif emits valid SARIF 2.1.0 with a warning-level result for UNVERIFIED", async () => {
    unverifiedLedger();
    const { out, exitCode } = await runVerify(
      { repo: "org/app", version: "1.0.0", format: "sarif", localDir: tmpRoot }, { json: false }
    );
    const sarif = JSON.parse(out.match(/\{[\s\S]*\}/)[0]);
    assert.equal(sarif.version, "2.1.0", "SARIF version");
    assert.ok(sarif.$schema.includes("sarif"), "SARIF $schema present");
    assert.ok(Array.isArray(sarif.runs) && sarif.runs.length === 1, "one run");
    assert.equal(sarif.runs[0].tool.driver.name, "repomesh");
    assert.ok(sarif.runs[0].results.length > 0, "UNVERIFIED produces >=1 result");
    assert.equal(sarif.runs[0].results[0].level, "warning", "UNVERIFIED -> warning level");
    assert.ok(sarif.runs[0].results[0].ruleId.length > 0, "result carries a ruleId (=check)");
    assert.equal(exitCode, 3, "exit code is independent of format");
  });

  it("--format markdown emits a job-summary table", async () => {
    unverifiedLedger();
    const { out } = await runVerify({ repo: "org/app", version: "1.0.0", format: "markdown", localDir: tmpRoot }, { json: false });
    assert.match(out, /\| Check \| Status \| Reason \| Hint \|/, "markdown table header");
    assert.match(out, /UNVERIFIED/, "status in the table");
  });

  it("--json is an alias for --format json", async () => {
    unverifiedLedger();
    const { result } = await runVerify({ repo: "org/app", version: "1.0.0", json: true, localDir: tmpRoot });
    assert.ok(result && typeof result === "object", "json output parses to the result object");
    assert.equal(result.gate.status, "UNVERIFIED");
  });
});

describe("FC5: verify-all aggregates >=2 releases in ONE ledger load", () => {
  function twoRelease() {
    const a = makeKeypair(); const b = makeKeypair(); const attestor = makeKeypair();
    const ATT = "mcp-tool-shop-org/repomesh-security-verifier";
    writeNode("org/good", "compute", "ci-good-2026", a.publicPem, "baseline");
    writeNode("org/bad", "compute", "ci-bad-2026", b.publicPem, "baseline");
    writeNode(ATT, "attestor", "ci-att-2026", attestor.publicPem);
    // org/good gets an independent attestation -> PASS. org/bad is self-signed -> UNVERIFIED.
    const goodAtt = signEvent({
      type: "AttestationPublished", repo: "org/good", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
      artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type: "security.scan", uri: "x" }], notes: "security.scan: pass",
    }, "ci-att-2026", attestor.privateKey);
    writeEvents([
      baselineRelease(a, "ci-good-2026", "org/good"),
      baselineRelease(b, "ci-bad-2026", "org/bad"),
      goodAtt,
    ]);
  }

  it("--manifest with two releases produces two rows; exit = worst row", async () => {
    twoRelease();
    const manifestPath = join(tmpRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify([
      { repo: "org/good", version: "1.0.0" },
      { repo: "org/bad", version: "1.0.0" },
    ]));
    const { verifyAll } = await import(toURL(resolve(srcDir, "verify", "verify-all.mjs")) + `?t=${Date.now()}${Math.random()}`);
    const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
    let exitCode = null, out = "";
    process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
    process.cwd = () => os.tmpdir();
    console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
    console.error = () => {};
    let loadCount = 0;
    try {
      await verifyAll({ manifest: manifestPath, localDir: tmpRoot, json: true, onLedgerLoad: () => loadCount++ });
    } catch (e) { if (e.message !== "__EXIT__") throw e; }
    finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
    const parsed = JSON.parse(out.match(/\{[\s\S]*\}/)[0]);
    assert.ok(Array.isArray(parsed.releases) && parsed.releases.length === 2, "two rows aggregated");
    const good = parsed.releases.find(r => r.repo === "org/good");
    const bad = parsed.releases.find(r => r.repo === "org/bad");
    assert.equal(good.gate.status, "PASS", "org/good verdict preserved");
    assert.equal(bad.gate.status, "UNVERIFIED", "org/bad verdict preserved");
    assert.equal(exitCode, 3, "worst row (UNVERIFIED) drives the aggregate exit under default --fail-on");
    assert.equal(loadCount, 1, "the ledger is loaded exactly ONCE for the whole batch");
  });

  it("--from-registry reads trust.json releases (one load) and respects --fail-on=fail", async () => {
    twoRelease();
    // Real trust.json shape: a TOP-LEVEL array of release records (as build-trust.mjs emits).
    fs.writeFileSync(join(tmpRoot, "registry", "trust.json"), JSON.stringify([
      { repo: "org/good", version: "1.0.0", commit: "abcdef0" },
      { repo: "org/bad", version: "1.0.0", commit: "abcdef0" },
    ], null, 2));
    const { verifyAll } = await import(toURL(resolve(srcDir, "verify", "verify-all.mjs")) + `?t=${Date.now()}${Math.random()}`);
    const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
    let exitCode = null, out = "";
    process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
    process.cwd = () => os.tmpdir();
    console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
    console.error = () => {};
    try {
      await verifyAll({ fromRegistry: true, localDir: tmpRoot, json: true, failOn: "fail" });
    } catch (e) { if (e.message !== "__EXIT__") throw e; }
    finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
    const parsed = JSON.parse(out.match(/\{[\s\S]*\}/)[0]);
    assert.equal(parsed.releases.length, 2, "both registry releases verified");
    // worst row is UNVERIFIED, but --fail-on=fail relaxes it -> exit 0
    assert.equal(exitCode, 0, "--fail-on=fail relaxes the UNVERIFIED worst row to success");
  });

  it("--format sarif merges all rows into ONE run", async () => {
    twoRelease();
    const manifestPath = join(tmpRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify([
      { repo: "org/good", version: "1.0.0" },
      { repo: "org/bad", version: "1.0.0" },
    ]));
    const { verifyAll } = await import(toURL(resolve(srcDir, "verify", "verify-all.mjs")) + `?t=${Date.now()}${Math.random()}`);
    const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
    let out = "";
    process.exit = () => { throw new Error("__EXIT__"); };
    process.cwd = () => os.tmpdir();
    console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
    console.error = () => {};
    try {
      await verifyAll({ manifest: manifestPath, localDir: tmpRoot, format: "sarif" });
    } catch (e) { if (e.message !== "__EXIT__") throw e; }
    finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
    const sarif = JSON.parse(out.match(/\{[\s\S]*\}/)[0]);
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs.length, 1, "verify-all merges into a single SARIF run");
  });
});
