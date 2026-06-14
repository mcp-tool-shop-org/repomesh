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

  const ATTESTOR = "mcp-tool-shop-org/repomesh-security-verifier"; // bundled allowlisted attestor
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
  writeNode(ATTESTOR, "attestor", "ci-att-2026", att.publicKeyPem);

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
});
