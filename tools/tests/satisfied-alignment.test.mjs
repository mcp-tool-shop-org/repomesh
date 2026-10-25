// D19 (LOW #9): the two verify-release copies (tools/verify-release.mjs and
// packages/repomesh-cli/src/verify/verify-release.mjs) must report the SAME `satisfied` array
// for identical input. They previously diverged on `signature.chain`: the packages copy reported
// it satisfied (structural), while the tools copy dropped it (it was listed as INTRINSIC and the
// in-loop special-case never fired). This test builds ONE regulated ledger and drives BOTH copies
// against it, asserting the satisfied SETS are equal. RED before the alignment, GREEN after.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const pkgSrc = path.resolve(REPO_ROOT, "packages", "repomesh-cli", "src");
function toURL(p) { return pathToFileURL(p).href; }

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {});
  return v;
}
function canonicalize(v) { return JSON.stringify(sortKeys(v)); }
function signEvent(body, privateKeyPem, keyId) {
  const ev = JSON.parse(JSON.stringify(body)); delete ev.signature;
  const hash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  const value = crypto.sign(null, Buffer.from(hash, "hex"), crypto.createPrivateKey(privateKeyPem)).toString("base64");
  return { ...ev, signature: { alg: "ed25519", keyId, value, canonicalHash: hash } };
}

// Build a regulated ledger where an ALLOWLISTED independent attestor (D12) provides every required
// attestation, so the gate reaches PASS and the satisfied array is fully populated.
function buildRegulatedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-d19-"));
  fs.mkdirSync(path.join(root, "ledger", "events"), { recursive: true });
  fs.mkdirSync(path.join(root, "registry"), { recursive: true });
  fs.mkdirSync(path.join(root, "schemas"), { recursive: true });
  // Copy the regulated profile into the temp root so BOTH copies resolve the same definition.
  fs.mkdirSync(path.join(root, "profiles"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "profiles", "regulated.json"), path.join(root, "profiles", "regulated.json"));
  fs.copyFileSync(path.join(REPO_ROOT, "profiles", "baseline.json"), path.join(root, "profiles", "baseline.json"));

  const ATTESTOR = "mcp-tool-shop-org/repomesh"; // bundled allowlisted registry attestor (trusted for all checks)
  const rel = makeKeypair();
  const att = makeKeypair();

  function writeNode(orgRepo, kind, keyId, pub, profileId) {
    const [org, repo] = orgRepo.split("/");
    const dir = path.join(root, "ledger", "nodes", org, repo);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "node.json"), JSON.stringify({
      id: orgRepo, kind, provides: [], consumes: [], interfaces: [], invariants: {},
      maintainers: [{ name: org, keyId, publicKey: pub, contact: "x@example.com" }],
    }, null, 2));
    if (profileId) fs.writeFileSync(path.join(dir, "repomesh.profile.json"), JSON.stringify({ profileId, profileVersion: "v1" }));
  }
  writeNode("org/app", "compute", "ci-app-2026", rel.publicKeyPem, "regulated");
  writeNode(ATTESTOR, "registry", "ci-att-2026", att.publicKeyPem);

  const release = signEvent({
    type: "ReleasePublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
    timestamp: "2026-01-01T00:00:00Z", artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
  }, rel.privateKeyPem, "ci-app-2026");
  const events = [release];
  for (const t of ["sbom.present", "provenance.present", "signature.chain", "license.audit", "security.scan", "repro.build"]) {
    events.push(signEvent({
      type: "AttestationPublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
      timestamp: "2026-01-02T00:00:00Z", artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type: t, uri: "x" }], notes: `${t}: pass`,
    }, att.privateKeyPem, "ci-att-2026"));
  }
  fs.writeFileSync(path.join(root, "ledger", "events", "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
  return root;
}

function runToolsCopy(root) {
  const { execSync } = require("node:child_process");
  const out = execSync(`node tools/verify-release.mjs --repo org/app --version 1.0.0 --json`, {
    cwd: REPO_ROOT, encoding: "utf8",
    env: {
      ...process.env,
      REPOMESH_LEDGER_PATH: path.join(root, "ledger", "events", "events.jsonl"),
      REPOMESH_NODES_PATH: path.join(root, "ledger", "nodes"),
      REPOMESH_PROFILES_PATH: path.join(root, "profiles"),
    },
  });
  const blobs = out.match(/\{[\s\S]*\}/g);
  return JSON.parse(blobs[blobs.length - 1]);
}

async function runPackagesCopy(root) {
  const { verifyRelease } = await import(toURL(path.resolve(pkgSrc, "verify", "verify-release.mjs")) + `?t=${Date.now()}`);
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let out = "";
  process.exit = () => { throw new Error("__EXIT__"); };
  process.cwd = () => root;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try { await verifyRelease({ repo: "org/app", version: "1.0.0", json: true }); }
  catch (e) { if (e.message !== "__EXIT__") throw e; }
  finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
  const blobs = out.match(/\{[\s\S]*\}/g);
  return JSON.parse(blobs[blobs.length - 1]);
}

describe("D19: the two verify-release copies report the same satisfied array", () => {
  it("regulated release: tools.gate.satisfied === packages.gate.satisfied (as sets)", async () => {
    const root = buildRegulatedRoot();
    try {
      const toolsResult = runToolsCopy(root);
      const pkgResult = await runPackagesCopy(root);
      const toolsSatisfied = [...(toolsResult.gate?.satisfied || [])].sort();
      const pkgSatisfied = [...(pkgResult.gate?.satisfied || [])].sort();
      assert.deepEqual(toolsSatisfied, pkgSatisfied,
        `satisfied arrays must align across copies; tools=${JSON.stringify(toolsSatisfied)} packages=${JSON.stringify(pkgSatisfied)}`);
      // Both must include signature.chain (the previously-divergent entry).
      assert.ok(toolsSatisfied.includes("signature.chain"), "tools must report signature.chain satisfied");
      assert.ok(pkgSatisfied.includes("signature.chain"), "packages must report signature.chain satisfied");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("per-type note matching: both tools and CLI match the note line for each attestation type rather than the first note line", async () => {
    const root = buildRegulatedRoot();
    try {
      const ledgerPath = path.join(root, "ledger", "events", "events.jsonl");
      const rawEvents = fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const kept = rawEvents.filter(
        (e) => e.type === "ReleasePublished" || !e.attestations?.some((a) => a.type === "security.scan" || a.type === "repro.build"),
      );
      const att = makeKeypair();
      const attNodePath = path.join(root, "ledger", "nodes", "mcp-tool-shop-org", "repomesh", "node.json");
      const attNode = JSON.parse(fs.readFileSync(attNodePath, "utf8"));
      attNode.maintainers[0].publicKey = att.publicKeyPem;
      fs.writeFileSync(attNodePath, JSON.stringify(attNode, null, 2));
      const resigned = kept.map((ev) =>
        ev.type === "AttestationPublished" ? signEvent(ev, att.privateKeyPem, "ci-att-2026") : ev,
      );
      resigned.push(signEvent({
        type: "AttestationPublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
        timestamp: "2026-01-02T00:00:00Z", artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
        attestations: [
          { type: "repro.build", uri: "x" },
          { type: "security.scan", uri: "x" },
        ],
        notes: "repro.build: pass — first line\nsecurity.scan: fail — second line",
      }, att.privateKeyPem, "ci-att-2026"));
      fs.writeFileSync(ledgerPath, resigned.map((e) => JSON.stringify(e)).join("\n") + "\n");

      let toolsResult;
      try {
        toolsResult = runToolsCopy(root);
      } catch (e) {
        const blobs = String(e.stdout || "").match(/\{[\s\S]*\}/g);
        toolsResult = JSON.parse(blobs[blobs.length - 1]);
      }
      const pkgResult = await runPackagesCopy(root);

      const toolsScan = (toolsResult.attestations || []).find((a) => a.type === "security.scan");
      const pkgScan = (pkgResult.attestations || []).find((a) => a.type === "security.scan");
      assert.equal(toolsScan?.result, "fail", "tools/verify-release.mjs must read security.scan's own note line (fail)");
      assert.equal(pkgScan?.result, "fail", "CLI verify-release.mjs must read security.scan's own note line (fail)");
      assert.equal(toolsResult.ok, false);
      assert.equal(pkgResult.ok, false);
      assert.ok((toolsResult.gate?.failed || []).includes("security.scan"));
      assert.ok(!(toolsResult.gate?.satisfied || []).includes("security.scan"));
      assert.ok(!(pkgResult.gate?.satisfied || []).includes("security.scan"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function buildPolicyScopedRoot(extraScanEventsFn) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-s6-"));
    fs.mkdirSync(path.join(root, "ledger", "events"), { recursive: true });
    fs.mkdirSync(path.join(root, "registry"), { recursive: true });
    fs.mkdirSync(path.join(root, "schemas"), { recursive: true });
    fs.mkdirSync(path.join(root, "profiles"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "profiles", "regulated.json"), path.join(root, "profiles", "regulated.json"));
    fs.copyFileSync(path.join(REPO_ROOT, "profiles", "baseline.json"), path.join(root, "profiles", "baseline.json"));
    fs.copyFileSync(path.join(REPO_ROOT, "verifier.policy.json"), path.join(root, "verifier.policy.json"));

    const rel = makeKeypair();
    const reg = makeKeypair();
    const lic = makeKeypair();
    const sec = makeKeypair();
    const repro = makeKeypair();

    function writeNode(orgRepo, kind, keyId, pub, profileId) {
      const [org, repo] = orgRepo.split("/");
      const dir = path.join(root, "ledger", "nodes", org, repo);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "node.json"), JSON.stringify({
        id: orgRepo, kind, provides: [], consumes: [], interfaces: [], invariants: {},
        maintainers: [{ name: org, keyId, publicKey: pub, contact: "x@example.com" }],
      }, null, 2));
      if (profileId) fs.writeFileSync(path.join(dir, "repomesh.profile.json"), JSON.stringify({ profileId, profileVersion: "v1" }));
    }

    writeNode("org/app", "compute", "ci-app-2026", rel.publicKeyPem, "regulated");
    writeNode("mcp-tool-shop-org/repomesh", "registry", "ci-repomesh-2026", reg.publicKeyPem);
    writeNode("mcp-tool-shop-org/repomesh-license-verifier", "attestor", "ci-license-2026", lic.publicKeyPem);
    writeNode("mcp-tool-shop-org/repomesh-security-verifier", "attestor", "ci-security-2026", sec.publicKeyPem);
    writeNode("mcp-tool-shop-org/repomesh-repro-verifier", "attestor", "ci-repro-2026", repro.publicKeyPem);

    const mkAtt = (type, result, keyPem, keyId, ts = "2026-01-02T00:00:00Z") => signEvent({
      type: "AttestationPublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
      timestamp: ts, artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type, uri: `repomesh:attestor:${type}:${result}` }],
      notes: `${type}: ${result} — ok`,
    }, keyPem, keyId);

    const events = [
      signEvent({
        type: "ReleasePublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
        timestamp: "2026-01-01T00:00:00Z", artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
      }, rel.privateKeyPem, "ci-app-2026"),
      mkAtt("sbom.present", "pass", reg.privateKeyPem, "ci-repomesh-2026"),
      mkAtt("provenance.present", "pass", reg.privateKeyPem, "ci-repomesh-2026"),
      mkAtt("signature.chain", "pass", reg.privateKeyPem, "ci-repomesh-2026"),
      mkAtt("license.audit", "pass", lic.privateKeyPem, "ci-license-2026"),
      mkAtt("repro.build", "pass", repro.privateKeyPem, "ci-repro-2026"),
      ...extraScanEventsFn({ mkAtt, lic, sec }),
    ];
    fs.writeFileSync(path.join(root, "ledger", "events", "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
    return root;
  }

  it("S6a: license verifier's security.scan: pass does NOT satisfy the gate in either tools or packages", async () => {
    const root = buildPolicyScopedRoot(({ mkAtt, lic }) => [
      mkAtt("security.scan", "pass", lic.privateKeyPem, "ci-license-2026", "2026-01-02T00:01:00Z"),
    ]);
    try {
      let toolsResult;
      try {
        toolsResult = runToolsCopy(root);
      } catch (e) {
        const blobs = String(e.stdout || "").match(/\{[\s\S]*\}/g);
        toolsResult = JSON.parse(blobs[blobs.length - 1]);
      }
      const pkgResult = await runPackagesCopy(root);

      assert.equal(toolsResult.ok, false, "tools must reject license verifier security.scan: pass");
      assert.equal(pkgResult.ok, false, "packages must reject license verifier security.scan: pass");
      assert.ok(!(toolsResult.gate?.satisfied || []).includes("security.scan"));
      assert.ok(!(pkgResult.gate?.satisfied || []).includes("security.scan"));
      assert.ok((toolsResult.gate?.missing || []).includes("security.scan"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("S6b: license verifier's security.scan: fail does NOT hard-fail a trusted security verifier's pass in either tools or packages", async () => {
    const root = buildPolicyScopedRoot(({ mkAtt, lic, sec }) => [
      mkAtt("security.scan", "pass", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
      mkAtt("security.scan", "fail", lic.privateKeyPem, "ci-license-2026", "2026-01-02T00:02:00Z"),
    ]);
    try {
      const toolsResult = runToolsCopy(root);
      const pkgResult = await runPackagesCopy(root);

      assert.equal(toolsResult.ok, true, "tools must pass when trusted security verifier passes despite untrusted-for-check fail");
      assert.equal(pkgResult.ok, true, "packages must pass when trusted security verifier passes despite untrusted-for-check fail");
      assert.ok((toolsResult.gate?.satisfied || []).includes("security.scan"));
      assert.ok((pkgResult.gate?.satisfied || []).includes("security.scan"));
      assert.deepEqual(toolsResult.gate?.failed || [], []);
      assert.deepEqual(pkgResult.gate?.failures || [], []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("tools no-policy: missing or unreadable verifier.policy.json fails closed for every trusted-set check with structured code + hint", () => {
    const { spawnSync } = require("node:child_process");
    function runToolsNoPolicy(root) {
      const r = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, "tools", "verify-release.mjs"), "--repo", "org/app", "--version", "1.0.0", "--json"],
        { cwd: REPO_ROOT, env: { ...process.env, REPOMESH_ROOT: root }, encoding: "utf8" },
      );
      const blobs = String(r.stdout || "").match(/\{[\s\S]*\}/g);
      return { status: r.status, out: blobs ? JSON.parse(blobs[blobs.length - 1]) : null };
    }

    const rootS6a = buildPolicyScopedRoot(({ mkAtt, lic }) => [
      mkAtt("security.scan", "pass", lic.privateKeyPem, "ci-license-2026", "2026-01-02T00:01:00Z"),
    ]);
    const rootS6b = buildPolicyScopedRoot(({ mkAtt, lic, sec }) => [
      mkAtt("security.scan", "pass", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
      mkAtt("security.scan", "fail", lic.privateKeyPem, "ci-license-2026", "2026-01-02T00:02:00Z"),
    ]);
    try {
      // Missing verifier.policy.json on S6a
      fs.rmSync(path.join(rootS6a, "verifier.policy.json"));
      const s6a = runToolsNoPolicy(rootS6a);
      assert.notEqual(s6a.status, 0, "missing policy must exit non-zero");
      assert.equal(s6a.out?.ok, false);
      assert.equal(s6a.out?.gate?.verdict, "FAIL");
      assert.deepEqual(s6a.out?.gate?.satisfied, ["signature.chain", "repro.build"],
        "missing policy must treat all trusted-set checks as closed (never satisfy security.scan or other trusted-set checks)");
      assert.deepEqual(s6a.out?.gate?.missing, ["sbom.present", "provenance.present", "license.audit", "security.scan"]);
      assert.deepEqual(s6a.out?.gate?.failed, []);
      assert.ok(s6a.out?.gate?.policyError?.code, "missing policy must report structured policyError.code");
      assert.ok(s6a.out?.gate?.policyError?.hint, "missing policy must report structured policyError.hint");

      // Missing verifier.policy.json on S6b
      fs.rmSync(path.join(rootS6b, "verifier.policy.json"));
      const s6b = runToolsNoPolicy(rootS6b);
      assert.notEqual(s6b.status, 0, "missing policy must exit non-zero");
      assert.equal(s6b.out?.ok, false);
      assert.equal(s6b.out?.gate?.verdict, "FAIL");
      assert.deepEqual(s6b.out?.gate?.satisfied, ["signature.chain", "repro.build"],
        "missing policy must treat all trusted-set checks as closed");
      assert.deepEqual(s6b.out?.gate?.missing, ["sbom.present", "provenance.present", "license.audit", "security.scan"]);
      assert.deepEqual(s6b.out?.gate?.failed, [],
        "missing policy must not accept an untrusted-for-check fail into gate.failed");
      assert.ok(s6b.out?.gate?.policyError?.code, "missing policy must report structured policyError.code");
      assert.ok(s6b.out?.gate?.policyError?.hint, "missing policy must report structured policyError.hint");

      // Unreadable/corrupt verifier.policy.json on S6b
      fs.writeFileSync(path.join(rootS6b, "verifier.policy.json"), "{ invalid json");
      const corrupt = runToolsNoPolicy(rootS6b);
      assert.notEqual(corrupt.status, 0, "corrupt policy must exit non-zero");
      assert.equal(corrupt.out?.ok, false);
      assert.equal(corrupt.out?.gate?.verdict, "FAIL");
      assert.deepEqual(corrupt.out?.gate?.satisfied, ["signature.chain", "repro.build"]);
      assert.deepEqual(corrupt.out?.gate?.missing, ["sbom.present", "provenance.present", "license.audit", "security.scan"]);
      assert.deepEqual(corrupt.out?.gate?.failed, []);
      assert.ok(corrupt.out?.gate?.policyError?.code, "corrupt policy must report structured policyError.code");
      assert.ok(corrupt.out?.gate?.policyError?.hint, "corrupt policy must report structured policyError.hint");
    } finally {
      fs.rmSync(rootS6a, { recursive: true, force: true });
      fs.rmSync(rootS6b, { recursive: true, force: true });
    }
  });

  async function runAllThree(extraEventsFn) {
    const { buildTrust } = await import(toURL(path.resolve(REPO_ROOT, "registry", "scripts", "build-trust.mjs")));
    const root = buildPolicyScopedRoot(extraEventsFn);
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = () => {};
    console.log = () => {};
    let btEntry;
    try {
      const trust = buildTrust({
        ledgerPath: path.join(root, "ledger", "events", "events.jsonl"),
        nodesDir: path.join(root, "ledger", "nodes"),
        profilesDir: path.join(root, "profiles"),
        registryDir: path.join(root, "registry"),
        policyPath: path.join(root, "verifier.policy.json"),
        write: false,
      });
      btEntry = trust.find((r) => r.repo === "org/app" && r.version === "1.0.0");
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }

    let toolsResult;
    try {
      toolsResult = runToolsCopy(root);
    } catch (e) {
      const blobs = String(e.stdout || "").match(/\{[\s\S]*\}/g);
      toolsResult = JSON.parse(blobs[blobs.length - 1]);
    }
    const pkgResult = await runPackagesCopy(root);
    fs.rmSync(root, { recursive: true, force: true });
    return { btEntry, toolsResult, pkgResult };
  }

  it("S7a parity across build-trust, CLI, and tools: pass then a later fail from the same trusted signer -> fail", async () => {
    const s7a = await runAllThree(({ mkAtt, sec }) => [
      mkAtt("security.scan", "pass", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
      mkAtt("security.scan", "fail", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:02:00Z"),
    ]);
    assert.equal(s7a.btEntry.assuranceBreakdown["security.scan"].result, "fail", "S7a: build-trust must say fail");
    assert.equal(s7a.btEntry.assuranceConsensus["security.scan"].consensus, "fail", "S7a: build-trust consensus must say fail");
    assert.equal(s7a.pkgResult.ok, false, "S7a: CLI must fail");
    assert.equal((s7a.pkgResult.attestations || []).find((a) => a.type === "security.scan")?.result, "fail", "S7a: CLI selected verdict must be fail");
    assert.equal(s7a.toolsResult.ok, false, "S7a: tools must fail");
    assert.equal((s7a.toolsResult.attestations || []).find((a) => a.type === "security.scan")?.result, "fail", "S7a: tools selected verdict must be fail");
  });

  it("S7a mirror parity across build-trust, CLI, and tools: fail then a later pass from the same trusted signer -> pass", async () => {
    const mirror = await runAllThree(({ mkAtt, sec }) => [
      mkAtt("security.scan", "fail", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
      mkAtt("security.scan", "pass", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:02:00Z"),
    ]);
    assert.equal(mirror.btEntry.assuranceBreakdown["security.scan"].result, "pass", "mirror: build-trust must say pass");
    assert.equal(mirror.btEntry.assuranceConsensus["security.scan"].consensus, "pass", "mirror: build-trust consensus must say pass");
    assert.equal(mirror.pkgResult.ok, true, "mirror: CLI must pass");
    assert.equal((mirror.pkgResult.attestations || []).find((a) => a.type === "security.scan")?.result, "pass", "mirror: CLI selected verdict must be pass");
    assert.equal(mirror.toolsResult.ok, true, "mirror: tools must pass");
    assert.equal((mirror.toolsResult.attestations || []).find((a) => a.type === "security.scan")?.result, "pass", "mirror: tools selected verdict must be pass");
  });

  it("timestamp tie parity across build-trust, CLI, and tools: ties go to the later ledger position", async () => {
    const tieFailSecond = await runAllThree(({ mkAtt, sec }) => [
      mkAtt("security.scan", "pass", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
      mkAtt("security.scan", "fail", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
    ]);
    assert.equal(tieFailSecond.btEntry.assuranceBreakdown["security.scan"].result, "fail", "tie: build-trust must pick later fail");
    assert.equal(tieFailSecond.pkgResult.ok, false, "tie: CLI must pick later fail");
    assert.equal(tieFailSecond.toolsResult.ok, false, "tie: tools must pick later fail");

    const tiePassSecond = await runAllThree(({ mkAtt, sec }) => [
      mkAtt("security.scan", "fail", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
      mkAtt("security.scan", "pass", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
    ]);
    assert.equal(tiePassSecond.btEntry.assuranceBreakdown["security.scan"].result, "pass", "tie: build-trust must pick later pass");
    assert.equal(tiePassSecond.pkgResult.ok, true, "tie: CLI must pick later pass");
    assert.equal(tiePassSecond.toolsResult.ok, true, "tie: tools must pick later pass");
  });

  it("invalid-signature later event parity across build-trust, CLI, and tools: never competes or wins", async () => {
    const forgedLater = await runAllThree(({ mkAtt, sec, lic }) => [
      mkAtt("security.scan", "pass", sec.privateKeyPem, "ci-security-2026", "2026-01-02T00:01:00Z"),
      mkAtt("security.scan", "fail", lic.privateKeyPem, "ci-security-2026", "2026-01-02T00:02:00Z"),
    ]);
    assert.equal(forgedLater.btEntry.assuranceBreakdown["security.scan"].result, "pass", "invalid-sig: build-trust must keep pass");
    assert.equal(forgedLater.pkgResult.ok, true, "invalid-sig: CLI must keep pass and not fail gate");
    assert.equal(
      (forgedLater.pkgResult.attestations || []).filter((a) => a.type === "security.scan").length,
      1,
      "invalid-sig: CLI must not include invalid-signature event in selected attestations",
    );
    assert.equal(forgedLater.toolsResult.ok, true, "invalid-sig: tools must keep pass");
    assert.equal(
      (forgedLater.toolsResult.attestations || []).filter((a) => a.type === "security.scan").length,
      1,
      "invalid-sig: tools must not include invalid-signature event in selected attestations",
    );
  });
});
