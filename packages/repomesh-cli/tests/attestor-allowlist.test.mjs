// D12 (CRITICAL #1): the consumer CLI carries a BUNDLED trusted-attestor allowlist (the 5 org
// nodes; allowed kinds {attestor, registry}). A cryptographically VALID-signature attestation from
// a node that is NOT in the allowlist (or is of a disallowed kind) is NOT a trusted attestor:
//   - it must NOT satisfy a required-attestation gate slot, AND
//   - it must NOT count as an independent witness (so a self-signed release + a forged-attestor
//     "witness" stays UNVERIFIED, never PASS).
// A fetched verifier.policy.json may NARROW the bundled set, never WIDEN it.
//
// RED on the pre-D12 code (cross-node lookup accepted any registered node), GREEN after.
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
const { BUNDLED_TRUSTED_ATTESTORS, BUNDLED_ATTESTOR_KINDS } =
  await import(toURL(resolve(srcDir, "remote-defaults.mjs")));

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
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-allow-"));
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
  if (profileId) fs.writeFileSync(join(dir, "repomesh.profile.json"), JSON.stringify({ profileId, profileVersion: "v1" }));
}
function writeEvents(events) {
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
}
async function runVerify(args) {
  const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let exitCode = null, out = "";
  process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
  process.cwd = () => tmpRoot;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try { await verifyRelease({ json: true, ...args }); }
  catch (e) { if (e.message !== "__EXIT__") throw e; }
  finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch {} }
  return { exitCode, out, result };
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

const TRUSTED = "mcp-tool-shop-org/repomesh-security-verifier"; // in the bundled allowlist
const NOT_TRUSTED = "rogue-org/rogue-attestor";                  // valid kind, NOT allowlisted

describe("D12: bundled trusted-attestor allowlist is present + correct", () => {
  it("bundles exactly the 5 org nodes", () => {
    assert.deepEqual([...BUNDLED_TRUSTED_ATTESTORS].sort(), [
      "mcp-tool-shop-org/repomesh",
      "mcp-tool-shop-org/repomesh-license-verifier",
      "mcp-tool-shop-org/repomesh-repro-verifier",
      "mcp-tool-shop-org/repomesh-security-verifier",
      "mcp-tool-shop-org/repomesh-xrpl-anchor",
    ].sort());
  });
  it("allows only {attestor, registry} kinds", () => {
    assert.deepEqual([...BUNDLED_ATTESTOR_KINDS].sort(), ["attestor", "registry"]);
  });
});

describe("D12: a valid-signature attestation from a NON-allowlisted node earns no trust", () => {
  // A self-signed release whose ONLY 'witness' is a valid-signature attestation from a
  // node NOT in the bundled allowlist. Under the pre-D12 code this passed (the rogue node
  // counted as an independent witness). Under D12 it must stay UNVERIFIED.
  it("does NOT count as an independent witness (verdict UNVERIFIED, ok:false, exit 3)", async () => {
    const rel = makeKeypair();
    const rogue = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "baseline");
    writeNode(NOT_TRUSTED, "attestor", "ci-rogue-2026", rogue.publicPem); // valid KIND, NOT allowlisted

    const release = signEvent({
      type: "ReleasePublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-app-2026", rel.privateKey);
    // Rogue attestor signs a perfectly VALID passing attestation — but it is not trusted.
    const rogueAtt = signEvent({
      type: "AttestationPublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
      artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type: "security.scan", uri: "x" }], notes: "security.scan: pass",
    }, "ci-rogue-2026", rogue.privateKey);

    writeEvents([release, rogueAtt]);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "a non-allowlisted attestor must NOT make a release PASS");
    // FC1: UNVERIFIED (soft — no independent witness) is exit 3 under default --fail-on=unverified.
    assert.equal(result?.gate?.status, "UNVERIFIED", "verdict unchanged: still UNVERIFIED");
    assert.equal(exitCode, 3);
    assert.match(JSON.stringify(result).toLowerCase(), /unverified/, "verdict should be UNVERIFIED");
    // The rogue signer must NOT appear among independent attestors.
    assert.deepEqual(result?.gate?.independentAttestors || [], [],
      "non-allowlisted signer must be excluded from independentAttestors");
  });

  it("does NOT satisfy a required-attestation gate slot (treated as missing)", async () => {
    // A regulated repo requires security.scan. The ONLY security.scan attestation comes from a
    // non-allowlisted node. The slot must be reported missing/failed, not satisfied.
    const rel = makeKeypair();
    const rogue = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "regulated");
    writeNode(NOT_TRUSTED, "attestor", "ci-rogue-2026", rogue.publicPem);

    const release = signEvent({
      type: "ReleasePublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-app-2026", rel.privateKey);
    const events = [release];
    for (const t of ["sbom.present", "provenance.present", "signature.chain", "license.audit", "security.scan", "repro.build"]) {
      events.push(signEvent({
        type: "AttestationPublished", repo: "org/app", version: "1.0.0",
        commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
        artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
        attestations: [{ type: t, uri: "x" }], notes: `${t}: pass`,
      }, "ci-rogue-2026", rogue.privateKey));
    }
    writeEvents(events);
    const { exitCode, result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "non-allowlisted attestations must not satisfy required slots");
    assert.equal(exitCode, 1);
    assert.deepEqual(result?.gate?.satisfied || [], [],
      "no required slot may be satisfied by a non-allowlisted attestor");
  });

  it("a node of a DISALLOWED kind (e.g. 'compute') even if it were allowlisted earns no trust", async () => {
    // Defense in depth: the genesis registry node id is allowlisted, but if its node.json
    // declared a non-{attestor,registry} kind, its attestations must still be rejected.
    const rel = makeKeypair();
    const wrongKind = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "baseline");
    // Allowlisted ID but wrong kind -> must be rejected on kind.
    writeNode("mcp-tool-shop-org/repomesh-security-verifier", "compute", "ci-sv-2026", wrongKind.publicPem);

    const release = signEvent({
      type: "ReleasePublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-app-2026", rel.privateKey);
    const att = signEvent({
      type: "AttestationPublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
      artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type: "security.scan", uri: "x" }], notes: "security.scan: pass",
    }, "ci-sv-2026", wrongKind.privateKey);
    writeEvents([release, att]);
    const { result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, false, "allowlisted-id-but-wrong-kind attestor must earn no trust");
    assert.deepEqual(result?.gate?.independentAttestors || [], []);
  });
});

describe("D12: a valid-signature attestation from an ALLOWLISTED node IS trusted (no false negative)", () => {
  it("counts as an independent witness and makes a baseline release PASS", async () => {
    const rel = makeKeypair();
    const sv = makeKeypair();
    writeNode("org/app", "compute", "ci-app-2026", rel.publicPem, "baseline");
    writeNode(TRUSTED, "attestor", "ci-sv-2026", sv.publicPem);

    const release = signEvent({
      type: "ReleasePublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-01T00:00:00Z",
      artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }], attestations: [],
    }, "ci-app-2026", rel.privateKey);
    const att = signEvent({
      type: "AttestationPublished", repo: "org/app", version: "1.0.0",
      commit: "abcdef0", timestamp: "2026-01-02T00:00:00Z",
      artifacts: [{ name: "att", sha256: "b".repeat(64), uri: "x" }],
      attestations: [{ type: "security.scan", uri: "x" }], notes: "security.scan: pass",
    }, "ci-sv-2026", sv.privateKey);
    writeEvents([release, att]);
    const { result } = await runVerify({ repo: "org/app", version: "1.0.0" });
    assert.equal(result?.ok, true, "an allowlisted attestor must be trusted (no false negative)");
    assert.equal(result?.gate?.status, "PASS");
    assert.deepEqual(result?.gate?.independentAttestors, [TRUSTED]);
  });
});
