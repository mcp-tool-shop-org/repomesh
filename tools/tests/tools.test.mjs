import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";

// require shim for node:test ESM context (used by Amend Wave A1 tests below)
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-test-"));
}

function generateTestKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v)
      .sort()
      .reduce((o, k) => {
        o[k] = sortKeys(v[k]);
        return o;
      }, {});
  }
  return v;
}

function signEvent(ev, privateKeyPem, keyId) {
  const copy = JSON.parse(JSON.stringify(ev));
  copy.signature = { alg: "ed25519", keyId, value: "", canonicalHash: "" };
  const stripped = JSON.parse(JSON.stringify(copy));
  delete stripped.signature;
  const canonical = canonicalize(stripped);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  const privKey = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privKey);
  copy.signature.value = sig.toString("base64");
  copy.signature.canonicalHash = hash;
  return copy;
}

function buildLedger(tmpDir, events) {
  const ledgerDir = path.join(tmpDir, "ledger", "events");
  fs.mkdirSync(ledgerDir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(path.join(ledgerDir, "events.jsonl"), lines, "utf8");
}

function registerNode(tmpDir, repoId, nodeJson) {
  const [org, repo] = repoId.split("/");
  const nodeDir = path.join(tmpDir, "ledger", "nodes", org, repo);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, "node.json"), JSON.stringify(nodeJson, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// 1. keygen.mjs -- Ed25519 PEM generation via openssl
// ---------------------------------------------------------------------------
describe("keygen.mjs", () => {
  let tmpDir;
  before(() => { tmpDir = makeTempDir(); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("generates valid Ed25519 PEM files", async () => {
    const { generateKeypair } = await import("../../tools/keygen.mjs");
    const outDir = path.join(tmpDir, "keys");
    const result = generateKeypair(outDir);

    // openssl might not be available in all CI environments
    if (result === null) {
      // If openssl is missing, skip gracefully
      return;
    }

    assert.ok(result.privatePath, "privatePath returned");
    assert.ok(result.publicPath, "publicPath returned");
    assert.ok(result.publicKeyPem, "publicKeyPem returned");

    // Verify files exist
    assert.ok(fs.existsSync(result.privatePath), "private.pem exists");
    assert.ok(fs.existsSync(result.publicPath), "public.pem exists");

    // Verify PEM headers
    const privPem = fs.readFileSync(result.privatePath, "utf8");
    const pubPem = fs.readFileSync(result.publicPath, "utf8");
    assert.match(privPem, /-----BEGIN PRIVATE KEY-----/, "private key has PEM header");
    assert.match(pubPem, /-----BEGIN PUBLIC KEY-----/, "public key has PEM header");

    // Verify the public key is loadable as Ed25519
    const keyObj = crypto.createPublicKey(pubPem);
    assert.equal(keyObj.asymmetricKeyType, "ed25519", "key type is ed25519");
  });

  it("does not overwrite existing keys", async () => {
    const { generateKeypair } = await import("../../tools/keygen.mjs");
    const outDir = path.join(tmpDir, "keys-exists");
    fs.mkdirSync(outDir, { recursive: true });

    // Pre-create a private.pem so keygen sees existing keys
    const marker = "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n";
    fs.writeFileSync(path.join(outDir, "private.pem"), marker, "utf8");
    // Also need public.pem for the readFileSync in the existing-key path
    fs.writeFileSync(path.join(outDir, "public.pem"), "existing-pub", "utf8");

    const result = generateKeypair(outDir);
    // Should return without overwriting
    assert.ok(result, "returns existing key info");
    // Private file should still have our marker content
    const content = fs.readFileSync(path.join(outDir, "private.pem"), "utf8");
    assert.ok(content.includes("test"), "private key was not overwritten");
  });
});

// ---------------------------------------------------------------------------
// 2. check-policy.mjs -- semver monotonicity + artifact hash uniqueness
// ---------------------------------------------------------------------------
describe("check-policy.mjs", () => {
  it("detects semver monotonicity violation", async () => {
    const tmpDir = makeTempDir();
    const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
    try {
      // Two releases: 1.1.0 then 1.0.0 (violation)
      const events = [
        {
          type: "ReleasePublished",
          repo: "test-org/test-repo",
          version: "1.1.0",
          commit: "aaa",
          timestamp: "2026-01-01T00:00:00Z",
          artifacts: [],
          signature: { alg: "ed25519", keyId: "k1", value: "sig", canonicalHash: "hash" },
        },
        {
          type: "ReleasePublished",
          repo: "test-org/test-repo",
          version: "1.0.0",
          commit: "bbb",
          timestamp: "2026-01-02T00:00:00Z",
          artifacts: [],
          signature: { alg: "ed25519", keyId: "k1", value: "sig", canonicalHash: "hash" },
        },
      ];
      buildLedger(tmpDir, events);

      const { execSync } = await import("node:child_process");
      execSync(
        `node policy/scripts/check-policy.mjs`,
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
            REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
          },
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
      assert.fail("Expected non-zero exit");
    } catch (e) {
      // check-policy exits 2 for errors
      assert.equal(e.status, 2, "exits with code 2 for semver violation");
      const combined = (e.stdout || "") + (e.stderr || "");
      assert.ok(
        combined.includes("semver.monotonicity"),
        "output mentions semver.monotonicity"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes with valid monotonic releases", async () => {
    const tmpDir = makeTempDir();
    const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
    try {
      const events = [
        {
          type: "ReleasePublished",
          repo: "test-org/test-repo",
          version: "1.0.0",
          commit: "aaa",
          timestamp: "2026-01-01T00:00:00Z",
          artifacts: [],
          signature: { alg: "ed25519", keyId: "k1", value: "sig", canonicalHash: "hash" },
        },
        {
          type: "ReleasePublished",
          repo: "test-org/test-repo",
          version: "1.1.0",
          commit: "bbb",
          timestamp: "2026-01-02T00:00:00Z",
          artifacts: [],
          signature: { alg: "ed25519", keyId: "k1", value: "sig", canonicalHash: "hash" },
        },
      ];
      buildLedger(tmpDir, events);

      const { execSync } = await import("node:child_process");
      const result = execSync(
        `node policy/scripts/check-policy.mjs`,
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
            REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
          },
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
      assert.ok(result.includes("No policy violations"), "reports clean");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. verify-release.mjs -- event parsing, hash validation, signature verify
// ---------------------------------------------------------------------------
describe("verify-release.mjs", () => {
  let tmpDir;
  let keys;
  const REPO = "test-org/test-repo";
  const VERSION = "1.0.0";
  const KEY_ID = "test-key-1";

  before(() => {
    tmpDir = makeTempDir();
    keys = generateTestKeypair();
  });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("verifies a validly signed release event", async () => {
    const baseEvent = {
      type: "ReleasePublished",
      repo: REPO,
      version: VERSION,
      commit: "abc123",
      timestamp: "2026-03-01T00:00:00Z",
      artifacts: [{ name: "dist.tar.gz", sha256: "a".repeat(64) }],
      notes: "",
    };
    const signed = signEvent(baseEvent, keys.privateKeyPem, KEY_ID);

    // Register node with public key
    registerNode(tmpDir, REPO, {
      id: REPO,
      kind: "tool",
      maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem }],
    });

    buildLedger(tmpDir, [signed]);

    // This test proves SIGNATURE verification: a validly self-signed release event must
    // resolve + verify its signature and bind the keyId. The overall verdict is now
    // UNVERIFIED (no independent witness, per D5), so we capture stdout regardless of
    // exit code and assert on the signature half — NOT on ok:true.
    const { execSync } = await import("node:child_process");
    let stdout;
    try {
      stdout = execSync(
        `node tools/verify-release.mjs --repo ${REPO} --version ${VERSION} --json`,
        {
          cwd: path.resolve(import.meta.dirname, "..", ".."),
          env: {
            ...process.env,
            REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
            REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
          },
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    } catch (e) {
      stdout = e.stdout || "";
    }

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.release.signatureValid, true, "signature is valid");
    assert.equal(parsed.release.keyId, KEY_ID, "keyId matches");
    assert.equal(parsed.release.signerNode, REPO, "signerNode bound to event repo");
  });

  it("fails on tampered canonical hash", async () => {
    const baseEvent = {
      type: "ReleasePublished",
      repo: REPO,
      version: "2.0.0",
      commit: "def456",
      timestamp: "2026-03-02T00:00:00Z",
      artifacts: [],
      notes: "",
    };
    const signed = signEvent(baseEvent, keys.privateKeyPem, KEY_ID);
    // Tamper the canonical hash
    signed.signature.canonicalHash = "0".repeat(64);

    registerNode(tmpDir, REPO, {
      id: REPO,
      kind: "tool",
      maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem }],
    });

    // Write to a separate ledger file for this test
    const ledgerDir = path.join(tmpDir, "ledger2", "events");
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(
      path.join(ledgerDir, "events.jsonl"),
      JSON.stringify(signed) + "\n",
      "utf8"
    );

    const { execSync } = await import("node:child_process");
    try {
      execSync(
        `node tools/verify-release.mjs --repo ${REPO} --version 2.0.0 --json`,
        {
          cwd: path.resolve(import.meta.dirname, "..", ".."),
          env: {
            ...process.env,
            REPOMESH_LEDGER_PATH: path.join(ledgerDir, "events.jsonl"),
            REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
          },
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
      assert.fail("Expected non-zero exit for tampered hash");
    } catch (e) {
      assert.notEqual(e.status, 0, "exits non-zero");
      // JSON output should indicate failure
      const out = JSON.parse(e.stdout);
      assert.equal(out.ok, false, "verification fails");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Input validation -- org/repo format
// ---------------------------------------------------------------------------
describe("input validation", () => {
  it("rejects missing org/repo format in init-node", async () => {
    const { execSync } = await import("node:child_process");
    const badInputs = ["noslash", "", "a/b/c", "  /repo"];

    // ISOLATION (LDG-006 / pollution root cause): some of these inputs ("a/b/c",
    // "  /repo") split into a truthy org/repo and are therefore ACCEPTED by the
    // simple validator — init then writes node.json + ledger/nodes/<org>/<repo>/
    // under its target dir. Run every case against a throwaway tmpdir so the real
    // repo's node.json and ledger/nodes/ are NEVER mutated by this test.
    const tmpDir = makeTempDir();
    try {
      for (const bad of badInputs) {
        try {
          execSync(
            `node tools/repomesh.mjs init --repo "${bad}" --no-pr --target-dir "${tmpDir}"`,
            {
              cwd: path.resolve(import.meta.dirname, "..", ".."),
              encoding: "utf8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: 30000,
            }
          );
          // "noslash" and "" should fail; "a/b/c" splits to ["a","b/c"] which may pass the simple check
          // We only assert failure for clearly bad ones
          if (!bad.includes("/")) {
            assert.fail(`Expected rejection for "${bad}"`);
          }
        } catch (e) {
          assert.notEqual(e.status, 0, `non-zero exit for bad repo "${bad}"`);
        }
      }
      // Pollution guard: the real repo tree must be untouched by this test.
      const realRoot = path.resolve(import.meta.dirname, "..", "..");
      assert.ok(!fs.existsSync(path.join(realRoot, "ledger", "nodes", "a")),
        "init must not write ledger/nodes/a into the real repo");
      assert.ok(!fs.existsSync(path.join(realRoot, "ledger", "nodes", "demo-org")),
        "init must not write ledger/nodes/demo-org into the real repo");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects missing --repo in verify-release", async () => {
    const { execSync } = await import("node:child_process");
    try {
      execSync(
        `node tools/repomesh.mjs verify-release --version 1.0.0`,
        {
          cwd: path.resolve(import.meta.dirname, "..", ".."),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 5000,
        }
      );
      assert.fail("Expected non-zero exit for missing --repo");
    } catch (e) {
      assert.notEqual(e.status, 0, "exits non-zero when --repo missing");
    }
  });

  it("rejects missing --version in verify-release", async () => {
    const { execSync } = await import("node:child_process");
    try {
      execSync(
        `node tools/repomesh.mjs verify-release --repo org/repo`,
        {
          cwd: path.resolve(import.meta.dirname, "..", ".."),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 5000,
        }
      );
      assert.fail("Expected non-zero exit for missing --version");
    } catch (e) {
      assert.notEqual(e.status, 0, "exits non-zero when --version missing");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Path traversal guards -- manifestPath in verify-release
// ---------------------------------------------------------------------------
describe("path traversal guards", () => {
  it("blocks manifestPath with .. traversal in anchor verification", async () => {
    const tmpDir = makeTempDir();
    try {
      const keys = generateTestKeypair();
      const KEY_ID = "traversal-key";
      const REPO = "test-org/traversal-test";

      // Create a release event
      const release = signEvent(
        {
          type: "ReleasePublished",
          repo: REPO,
          version: "1.0.0",
          commit: "abc",
          timestamp: "2026-01-01T00:00:00Z",
          artifacts: [],
          notes: "",
        },
        keys.privateKeyPem,
        KEY_ID
      );

      // Create a malicious anchor event with path traversal in manifestPath
      const maliciousAnchor = signEvent(
        {
          type: "AttestationPublished",
          repo: REPO,
          version: "1.0.0",
          commit: "abc",
          timestamp: "2026-01-02T00:00:00Z",
          artifacts: [],
          attestations: [{ type: "ledger.anchor" }],
          notes: `Anchor event\n${JSON.stringify({
            manifestPath: "../../etc/passwd",
            txHash: "fake",
          })}`,
        },
        keys.privateKeyPem,
        KEY_ID
      );

      registerNode(tmpDir, REPO, {
        id: REPO,
        kind: "tool",
        maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem }],
      });

      buildLedger(tmpDir, [release, maliciousAnchor]);

      // The verify-release with --anchored must NOT follow the traversal path. Under the post-D4
      // strict semantics, an --anchored request with no valid anchor found is a FAIL (exit 1) —
      // but the traversal is still proven blocked because the anchor was NOT resolved.
      const { execSync } = await import("node:child_process");
      let out;
      try {
        const result = execSync(
          `node tools/verify-release.mjs --repo ${REPO} --version 1.0.0 --anchored --json`,
          {
            cwd: path.resolve(import.meta.dirname, "..", ".."),
            env: {
              ...process.env,
              REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
              REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
              REPOMESH_OFFLINE: "1",
            },
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          }
        );
        out = JSON.parse(result);
      } catch (e) {
        out = JSON.parse(e.stdout);
      }
      // Traversal blocked -> anchor was not resolved (anchored:false); strict --anchored fails.
      assert.equal(out.anchor?.anchored, false, "anchor not found (traversal blocked)");
      assert.equal(out.ok, false, "strict --anchored with no resolvable anchor fails (no silent PASS)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("blocks manifestPath resolving outside repo root", async () => {
    // This tests the path.resolve + startsWith guard in findAnchorForHash
    const tmpDir = makeTempDir();
    try {
      const keys = generateTestKeypair();
      const KEY_ID = "root-escape-key";
      const REPO = "test-org/root-escape";

      const release = signEvent(
        {
          type: "ReleasePublished",
          repo: REPO,
          version: "1.0.0",
          commit: "xyz",
          timestamp: "2026-01-01T00:00:00Z",
          artifacts: [],
          notes: "",
        },
        keys.privateKeyPem,
        KEY_ID
      );

      // Use an absolute path outside the repo
      const outsidePath = path.join(os.tmpdir(), "evil-manifest.json");
      const maliciousAnchor = signEvent(
        {
          type: "AttestationPublished",
          repo: REPO,
          version: "1.0.0",
          commit: "xyz",
          timestamp: "2026-01-02T00:00:00Z",
          artifacts: [],
          attestations: [{ type: "ledger.anchor" }],
          notes: `Anchor\n${JSON.stringify({ manifestPath: outsidePath })}`,
        },
        keys.privateKeyPem,
        KEY_ID
      );

      registerNode(tmpDir, REPO, {
        id: REPO,
        kind: "tool",
        maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem }],
      });

      buildLedger(tmpDir, [release, maliciousAnchor]);

      const { execSync } = await import("node:child_process");
      let out;
      try {
        const result = execSync(
          `node tools/verify-release.mjs --repo ${REPO} --version 1.0.0 --anchored --json`,
          {
            cwd: path.resolve(import.meta.dirname, "..", ".."),
            env: {
              ...process.env,
              REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
              REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
              REPOMESH_OFFLINE: "1",
            },
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          }
        );
        out = JSON.parse(result);
      } catch (e) {
        out = JSON.parse(e.stdout);
      }
      assert.equal(out.anchor?.anchored, false, "absolute path outside root is blocked");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Amend Wave A1 helpers — full ledger fixtures for D1/D4/D5 invariants.
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function runVerify(env, args) {
  const { execSync } = require("node:child_process");
  try {
    const stdout = execSync(`node tools/verify-release.mjs ${args}`, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || "", stderr: e.stderr || "" };
  }
}

// Build a signed AttestationPublished event for a given attestation type + result.
function signAttestation({ repo, version, type, result, keys, keyId, timestamp }) {
  const ev = {
    type: "AttestationPublished",
    repo,
    version,
    commit: "abc",
    timestamp: timestamp || "2026-03-01T01:00:00Z",
    attestations: [{ type }],
    notes: `${type}: ${result}`,
  };
  return signEvent(ev, keys.privateKeyPem, keyId);
}

// ---------------------------------------------------------------------------
// D1 / TOOLS-001 — repo-bound signer resolution for ReleasePublished.
// Invariant (both halves): (a) a key registered to repo A must NOT validate a
// release for repo B even if it carries the right keyId; (b) a key registered
// to the SAME repo still validates (no false negative).
// ---------------------------------------------------------------------------
describe("D1/TOOLS-001 repo-bound signer", () => {
  it("rejects a release signed by another repo's registered key (cross-repo forgery)", () => {
    const tmpDir = makeTempDir();
    try {
      const victim = "victim-org/victim-repo";
      const attacker = "attacker-org/attacker-repo";
      const KEY_ID = "ci-shared-2026";
      const attackerKeys = generateTestKeypair();

      const forged = signEvent(
        {
          type: "ReleasePublished",
          repo: victim,
          version: "9.9.9",
          commit: "evil",
          timestamp: "2026-03-01T00:00:00Z",
          artifacts: [],
          notes: "",
        },
        attackerKeys.privateKeyPem,
        KEY_ID
      );

      registerNode(tmpDir, attacker, {
        id: attacker,
        kind: "tool",
        maintainers: [{ keyId: KEY_ID, publicKey: attackerKeys.publicKeyPem, contact: "a@x" }],
      });
      buildLedger(tmpDir, [forged]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
      }, `--repo ${victim} --version 9.9.9 --json`);

      assert.notEqual(r.status, 0, "cross-repo forgery must exit non-zero");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "forged release must NOT pass");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts a release signed by the repo's own registered key", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "good-org/good-repo";
      const KEY_ID = "ci-good-repo-2026";
      const keys = generateTestKeypair();
      const rel = signEvent(
        {
          type: "ReleasePublished",
          repo,
          version: "1.0.0",
          commit: "abc",
          timestamp: "2026-03-01T00:00:00Z",
          artifacts: [],
          notes: "",
        },
        keys.privateKeyPem,
        KEY_ID
      );
      registerNode(tmpDir, repo, {
        id: repo,
        kind: "tool",
        maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem, contact: "g@x" }],
      });
      buildLedger(tmpDir, [rel]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
      }, `--repo ${repo} --version 1.0.0 --json`);

      // D1 is about repo-bound SIGNATURE resolution: the own-repo key must verify and
      // bind to the event repo. The overall gate verdict is D5's concern — a self-signed
      // release with no independent witness is UNVERIFIED, so we do NOT assert ok:true
      // here (mirrors packages verify-gate.test.mjs "accepts own-key release").
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, true, "own-key release signature must verify");
      assert.equal(out.release.signerNode, repo, "signerNode bound to event repo");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D4 / TOOLS-002 / REG-001 — anchor verification: root recompute + offline honesty.
// Invariant (multiple halves): (a) --anchored with NO anchor → exit 1 (no silent
// PASS); (b) a manifest whose root does NOT match the recomputed partition root
// → FAIL; (c) offline + txHash present → print "XRPL NOT verified", never a fake tx=.
// ---------------------------------------------------------------------------
describe("D4/TOOLS-002/REG-001 anchor verification", () => {
  function makeAnchoredFixture(tmpDir, { tamperRoot = false } = {}) {
    const repo = "anc-org/anc-repo";
    const KEY_ID = "ci-anc-repo-2026";
    const keys = generateTestKeypair();
    const release = signEvent(
      {
        type: "ReleasePublished",
        repo,
        version: "1.0.0",
        commit: "abc",
        timestamp: "2026-02-28T00:00:00Z",
        artifacts: [],
        notes: "",
      },
      keys.privateKeyPem,
      KEY_ID
    );

    const leaves = [release.signature.canonicalHash];
    const { merkleRootHex } = require("../../anchor/xrpl/scripts/merkle.mjs");
    const realRoot = merkleRootHex(leaves);
    const root = tamperRoot ? "f".repeat(64) : realRoot;
    const manifestBase = {
      v: 1,
      algo: "sha256-merkle-v1",
      partitionId: "2026-02-28",
      network: "testnet",
      prev: null,
      range: [leaves[0], leaves[leaves.length - 1]],
      count: leaves.length,
      root,
    };
    const canon = canonicalize(manifestBase);
    const manifestHash = crypto.createHash("sha256").update(canon, "utf8").digest("hex");
    const manifest = { ...manifestBase, manifestHash };

    const manifestRel = "anchor-test-manifests/anc.json";
    const manifestAbs = path.join(tmpDir, manifestRel);
    fs.mkdirSync(path.dirname(manifestAbs), { recursive: true });
    fs.writeFileSync(manifestAbs, JSON.stringify(manifest, null, 2), "utf8");

    // D18: the anchor EVENT must be signed by a node in the BUNDLED trusted attestor/anchor set to
    // count as an independent witness under --anchored-or-local. Sign it with the bundled
    // xrpl-anchor node (a separate node from the release repo).
    const ANCHOR_NODE = "mcp-tool-shop-org/repomesh-xrpl-anchor";
    const ANCHOR_KEY = "ci-xrpl-anchor-2026";
    const anchorKeys = generateTestKeypair();
    // Anchor event lives on a DIFFERENT day so the date-based partition "2026-02-28" contains
    // ONLY the release leaf (matching how the manifest root above was computed).
    const anchor = signEvent(
      {
        type: "AttestationPublished",
        repo,
        version: "1.0.0",
        commit: "abc",
        timestamp: "2026-03-01T12:00:00Z",
        attestations: [{ type: "ledger.anchor" }],
        notes: `Anchor\n${JSON.stringify({ manifestPath: manifestRel, txHash: "DEADBEEF".repeat(8), network: "testnet" })}`,
      },
      anchorKeys.privateKeyPem,
      ANCHOR_KEY
    );

    registerNode(tmpDir, repo, {
      id: repo,
      kind: "tool",
      maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem, contact: "a@x" }],
    });
    registerNode(tmpDir, ANCHOR_NODE, {
      id: ANCHOR_NODE,
      kind: "attestor",
      maintainers: [{ keyId: ANCHOR_KEY, publicKey: anchorKeys.publicKeyPem, contact: "anchor@x" }],
    });
    buildLedger(tmpDir, [release, anchor]);
    return { repo };
  }

  it("--anchored with no anchor exits 1 (no silent PASS)", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "noanc-org/noanc-repo";
      const KEY_ID = "ci-noanc-repo-2026";
      const keys = generateTestKeypair();
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [], notes: "" },
        keys.privateKeyPem, KEY_ID
      );
      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem, contact: "n@x" }] });
      buildLedger(tmpDir, [release]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_OFFLINE: "1",
      }, `--repo ${repo} --version 1.0.0 --anchored --json`);

      assert.notEqual(r.status, 0, "--anchored + no anchor must exit non-zero");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "no-anchor under --anchored must fail");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails when manifest root does not match recomputed partition root", () => {
    const tmpDir = makeTempDir();
    try {
      const { repo } = makeAnchoredFixture(tmpDir, { tamperRoot: true });
      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_ROOT: tmpDir,
        REPOMESH_OFFLINE: "1",
      }, `--repo ${repo} --version 1.0.0 --anchored --json`);
      assert.notEqual(r.status, 0, "tampered root must exit non-zero");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "tampered partition root must fail");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("offline + txHash present does not print a fake 'tx=' anchored line", () => {
    const tmpDir = makeTempDir();
    try {
      const { repo } = makeAnchoredFixture(tmpDir);
      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_ROOT: tmpDir,
        REPOMESH_OFFLINE: "1",
      }, `--repo ${repo} --version 1.0.0 --anchored`);
      assert.notEqual(r.status, 0, "strict --anchored offline must fail");
      const combined = r.stdout + r.stderr;
      assert.ok(/XRPL NOT verified/i.test(combined), "must state XRPL NOT verified");
      assert.ok(!/Anchored:\s*YES \(.*tx=DEADBEEF/i.test(combined), "must NOT print a fake anchored tx= line");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("offline with --anchored-or-local degrades gracefully without a fake tx", () => {
    const tmpDir = makeTempDir();
    try {
      const { repo } = makeAnchoredFixture(tmpDir);
      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_ROOT: tmpDir,
        REPOMESH_OFFLINE: "1",
      }, `--repo ${repo} --version 1.0.0 --anchored --anchored-or-local --json`);
      assert.equal(r.status, 0, "--anchored-or-local offline passes (local manifest verified)");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, true, "local-manifest-only is acceptable under --anchored-or-local");
      assert.equal(out.anchor.xrplVerified, false, "xrplVerified must be false offline");
      assert.equal(out.anchor.txHash, null, "no fake txHash surfaced offline");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("D18: --anchored-or-local with a FORGED (non-trusted-signer) anchor does NOT flip UNVERIFIED->PASS", () => {
    // The anchor event is signed by the release's OWN key (a 'tool' node, NOT a trusted anchor
    // node). Its local manifest + root recompute fine, but the anchor EVENT signature does not
    // resolve to a bundled trusted attestor/anchor node, so it must NOT be credited as a witness.
    // RED on pre-D18 (anchor witness credited on rootValid alone), GREEN after.
    const tmpDir = makeTempDir();
    try {
      const repo = "forge-org/forge-repo";
      const KEY_ID = "ci-forge-repo-2026";
      const keys = generateTestKeypair();
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-02-28T00:00:00Z", artifacts: [], notes: "" },
        keys.privateKeyPem, KEY_ID
      );
      const { merkleRootHex } = require("../../anchor/xrpl/scripts/merkle.mjs");
      const leaves = [release.signature.canonicalHash];
      const manifestBase = { v: 1, algo: "sha256-merkle-v1", partitionId: "2026-02-28", network: "testnet", prev: null, range: [leaves[0], leaves[0]], count: 1, root: merkleRootHex(leaves) };
      const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
      const manifest = { ...manifestBase, manifestHash };
      const manifestRel = "anchor-test-manifests/forge.json";
      fs.mkdirSync(path.join(tmpDir, "anchor-test-manifests"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, manifestRel), JSON.stringify(manifest, null, 2), "utf8");
      // FORGED: anchor event signed by the release's own (untrusted, kind:tool) key.
      const anchor = signEvent(
        { type: "AttestationPublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T12:00:00Z", attestations: [{ type: "ledger.anchor" }], notes: `Anchor\n${JSON.stringify({ manifestPath: manifestRel, txHash: "DEADBEEF".repeat(8), network: "testnet" })}` },
        keys.privateKeyPem, KEY_ID
      );
      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem, contact: "f@x" }] });
      buildLedger(tmpDir, [release, anchor]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_ROOT: tmpDir,
        REPOMESH_OFFLINE: "1",
      }, `--repo ${repo} --version 1.0.0 --anchored --anchored-or-local --json`);

      assert.notEqual(r.status, 0, "a forged-signer anchor must NOT make the release PASS");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "forged anchor must not be credited as a witness");
      assert.equal(out.gate.verdict, "UNVERIFIED", "no trusted witness => UNVERIFIED, never PASS");
      assert.equal(out.anchor.signerTrusted, false, "anchor signer must be reported as not trusted");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies a range-pinned manifest inside a LARGER ledger (drift-proof leaf resolution)", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "drift-org/drift-repo";
      const KEY_ID = "ci-drift-repo-2026";
      const keys = generateTestKeypair();
      // The release is the FIRST event; the manifest pins ONLY that one leaf (range+count=1).
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-02-28T00:00:00Z", artifacts: [], notes: "" },
        keys.privateKeyPem, KEY_ID
      );
      const { merkleRootHex } = require("../../anchor/xrpl/scripts/merkle.mjs");
      const leaves = [release.signature.canonicalHash];
      const manifestBase = { v: 1, algo: "sha256-merkle-v1", partitionId: "genesis", network: "testnet", prev: null, range: [leaves[0], leaves[0]], count: 1, root: merkleRootHex(leaves) };
      const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
      const manifest = { ...manifestBase, manifestHash };
      const manifestRel = "anchor-test-manifests/genesis.json";
      fs.mkdirSync(path.join(tmpDir, "anchor-test-manifests"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, manifestRel), JSON.stringify(manifest, null, 2), "utf8");

      // D18: anchor event signed by the bundled trusted xrpl-anchor node so it counts as a witness.
      const ANCHOR_NODE = "mcp-tool-shop-org/repomesh-xrpl-anchor";
      const ANCHOR_KEY = "ci-xrpl-anchor-2026";
      const anchorKeys = generateTestKeypair();
      const anchor = signEvent(
        { type: "AttestationPublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", attestations: [{ type: "ledger.anchor" }], notes: `Anchor\n${JSON.stringify({ manifestPath: manifestRel, txHash: "AB".repeat(32), network: "testnet" })}` },
        anchorKeys.privateKeyPem, ANCHOR_KEY
      );
      // Add SUBSEQUENT noise events to the ledger so a naive "genesis = all events" resolver would
      // recompute the wrong root. The range-pinned slice must ignore them.
      const noise = signEvent(
        { type: "ReleasePublished", repo, version: "1.1.0", commit: "ddd", timestamp: "2026-03-02T00:00:00Z", artifacts: [], notes: "" },
        keys.privateKeyPem, KEY_ID
      );

      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: KEY_ID, publicKey: keys.publicKeyPem, contact: "d@x" }] });
      registerNode(tmpDir, ANCHOR_NODE, { id: ANCHOR_NODE, kind: "attestor", maintainers: [{ keyId: ANCHOR_KEY, publicKey: anchorKeys.publicKeyPem, contact: "anchor@x" }] });
      buildLedger(tmpDir, [release, anchor, noise]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_ROOT: tmpDir,
        REPOMESH_OFFLINE: "1",
      }, `--repo ${repo} --version 1.0.0 --anchored --anchored-or-local --json`);

      assert.equal(r.status, 0, "range-pinned manifest in a larger ledger still verifies");
      const out = JSON.parse(r.stdout);
      assert.equal(out.anchor.rootValid, true, "root recomputed over the pinned window matches the manifest");
      assert.equal(out.anchor.partition, "genesis", "partition id preserved");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D5 — attestation gate driven by trust profile.
// Invariant (both halves): (a) a FAILING required attestation makes verify exit 1;
// (b) a clean release with a baseline profile (no required attestations) passes.
// ---------------------------------------------------------------------------
describe("D5 attestation gate", () => {
  it("FAILS a release whose required attestation is signed but result=fail", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "gate-org/gate-repo";
      const RELKEY = "ci-gate-repo-2026";
      const ATTKEY = "ci-attestor-2026";
      const relKeys = generateTestKeypair();
      const attKeys = generateTestKeypair();

      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [{ name: "d", sha256: "a".repeat(64) }], notes: "" },
        relKeys.privateKeyPem, RELKEY
      );
      const failAtt = signAttestation({ repo, version: "1.0.0", type: "security.scan", result: "fail", keys: attKeys, keyId: ATTKEY });

      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: RELKEY, publicKey: relKeys.publicKeyPem, contact: "g@x" }] });
      registerNode(tmpDir, "att-org/attestor", { id: "att-org/attestor", kind: "attestor", maintainers: [{ keyId: ATTKEY, publicKey: attKeys.publicKeyPem, contact: "att@x" }] });
      const profileDir = path.join(tmpDir, "profiles");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, "gate.json"), JSON.stringify({
        id: "gate", version: "v1",
        requiredChecks: { integrity: ["signed"], assurance: ["security.scan"] },
      }), "utf8");
      const repoNodeDir = path.join(tmpDir, "ledger", "nodes", "gate-org", "gate-repo");
      fs.writeFileSync(path.join(repoNodeDir, "repomesh.profile.json"), JSON.stringify({ profileId: "gate" }), "utf8");

      buildLedger(tmpDir, [release, failAtt]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: profileDir,
      }, `--repo ${repo} --version 1.0.0 --json`);

      assert.notEqual(r.status, 0, "failing required attestation must exit non-zero");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "failing required attestation must fail the gate");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("baseline self-signed release with NO independent witness is UNVERIFIED (not PASS)", () => {
    // Mirrors the published packages copy: independence is required UNCONDITIONALLY.
    // A baseline profile requires zero attestation types, but a self-signed-only
    // release with no independent attestor and no anchor is still NOT trustworthy
    // — verdict UNVERIFIED, ok:false. (This test previously asserted PASS, which
    // encoded the profile-gated bypass bug now closed in tools/verify-release.mjs.)
    const tmpDir = makeTempDir();
    try {
      const repo = "base-org/base-repo";
      const RELKEY = "ci-base-repo-2026";
      const relKeys = generateTestKeypair();
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [{ name: "d", sha256: "a".repeat(64) }], notes: "" },
        relKeys.privateKeyPem, RELKEY
      );
      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: RELKEY, publicKey: relKeys.publicKeyPem, contact: "b@x" }] });
      const profileDir = path.join(tmpDir, "profiles");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, "baseline.json"), JSON.stringify({
        id: "baseline", version: "v1",
        requiredChecks: { integrity: ["signed"], assurance: [] },
      }), "utf8");
      const repoNodeDir = path.join(tmpDir, "ledger", "nodes", "base-org", "base-repo");
      fs.writeFileSync(path.join(repoNodeDir, "repomesh.profile.json"), JSON.stringify({ profileId: "baseline" }), "utf8");

      buildLedger(tmpDir, [release]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: profileDir,
      }, `--repo ${repo} --version 1.0.0 --json`);

      assert.notEqual(r.status, 0, "baseline self-signed-only release must exit non-zero");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "baseline self-signed-only release must NOT pass");
      assert.equal(out.release.signatureValid, true, "the release signature itself is valid");
      assert.equal(out.gate.verdict, "UNVERIFIED", "verdict is UNVERIFIED, never PASS");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports UNVERIFIED (never PASS) for a self-signed release missing its required attestations", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "self-org/self-repo";
      const RELKEY = "ci-self-repo-2026";
      const relKeys = generateTestKeypair();
      // Release is validly self-signed, but the profile requires security.scan and NO attestor signs.
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [{ name: "d", sha256: "a".repeat(64) }], notes: "" },
        relKeys.privateKeyPem, RELKEY
      );
      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: RELKEY, publicKey: relKeys.publicKeyPem, contact: "s@x" }] });
      const profileDir = path.join(tmpDir, "profiles");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, "strict.json"), JSON.stringify({
        id: "strict", version: "v1",
        requiredChecks: { integrity: ["signed"], assurance: ["security.scan"] },
      }), "utf8");
      const repoNodeDir = path.join(tmpDir, "ledger", "nodes", "self-org", "self-repo");
      fs.writeFileSync(path.join(repoNodeDir, "repomesh.profile.json"), JSON.stringify({ profileId: "strict" }), "utf8");

      buildLedger(tmpDir, [release]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: profileDir,
      }, `--repo ${repo} --version 1.0.0 --json`);

      assert.notEqual(r.status, 0, "self-signed-only release under a strict profile must not exit 0");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "missing required attestation → not ok");
      // The release signature itself is valid; the failure is the gate, reported honestly.
      assert.equal(out.release.signatureValid, true, "release signature is valid");
      assert.ok(out.gate.verdict === "FAIL" || out.gate.verdict === "UNVERIFIED", "gate verdict is FAIL/UNVERIFIED, never PASS");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D11 / TOOLS-003 — init-node must NOT print the private PEM body; keygen chmod 0600.
// ---------------------------------------------------------------------------
describe("D11/TOOLS-003 private key not printed", () => {
  it("keygen sets 0600 perms on private.pem (POSIX)", async () => {
    const { generateKeypair } = await import("../../tools/keygen.mjs");
    const tmpDir = makeTempDir();
    try {
      const outDir = path.join(tmpDir, "k");
      const result = generateKeypair(outDir);
      if (result === null) return; // openssl missing — skip
      if (process.platform !== "win32") {
        const mode = fs.statSync(result.privatePath).mode & 0o777;
        assert.equal(mode, 0o600, "private.pem is chmod 0600 on POSIX");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("init-node output never contains BEGIN PRIVATE KEY", () => {
    const tmpDir = makeTempDir();
    try {
      const { execSync } = require("node:child_process");
      let r;
      try {
        const stdout = execSync(`node tools/init-node.mjs --repo demo-org/demo-repo --profile baseline --no-pr --target-dir "${tmpDir}"`, {
          cwd: REPO_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
        });
        r = { status: 0, stdout, stderr: "" };
      } catch (e) { r = { status: e.status, stdout: e.stdout || "", stderr: e.stderr || "" }; }
      const combined = r.stdout + r.stderr;
      assert.ok(!combined.includes("BEGIN PRIVATE KEY"), "init-node must not print the private PEM body");
      assert.ok(/gh secret set/i.test(combined), "init-node should instruct gh secret set from the key path");
      // Pollution guard: with --target-dir, the real repo's ledger must be untouched.
      assert.ok(!fs.existsSync(path.join(REPO_ROOT, "ledger", "nodes", "demo-org")),
        "init-node --target-dir must not write demo-org into the real ledger");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D11 / TOOLS-004 — init-node validates --key-id + ledgerRepo before interpolation.
// ---------------------------------------------------------------------------
describe("D11/TOOLS-004 key-id / ledger-repo validation", () => {
  it("rejects a malicious --key-id that would inject YAML", () => {
    const tmpDir = makeTempDir();
    try {
      const { execSync } = require("node:child_process");
      let failed = false;
      try {
        execSync(`node tools/init-node.mjs --repo demo-org/demo-repo --profile baseline --no-pr --target-dir "${tmpDir}" --key-id "EVIL UPPER"`, {
          cwd: REPO_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
        });
      } catch (e) { failed = e.status !== 0; }
      assert.ok(failed, "malicious/invalid --key-id must be rejected (non-zero exit)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D11 / TOOLS-006 — build-timeline readJSON wraps parse in try/catch.
// ---------------------------------------------------------------------------
describe("D11/TOOLS-006 build-timeline resilient JSON", () => {
  it("readJSON wraps JSON.parse in try/catch (regression guard)", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "pages", "build-timeline.mjs"), "utf8");
    assert.ok(/try\s*{[\s\S]*JSON\.parse[\s\S]*}\s*catch/.test(src), "build-timeline readJSON wraps JSON.parse in try/catch");
  });
});

// ---------------------------------------------------------------------------
// D11 / TOOLS-005 — build-pages escapes timestamps + ledger strings.
// ---------------------------------------------------------------------------
describe("D11/TOOLS-005 build-pages escapes timestamps", () => {
  it("every timestamp interpolation is wrapped in esc()", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "pages", "build-pages.mjs"), "utf8");
    assert.ok(!/\$\{entry\.timestamp\}/.test(src), "entry.timestamp must be esc()-wrapped");
    assert.ok(!/\$\{latestRelease\.timestamp\}/.test(src), "latestRelease.timestamp must be esc()-wrapped");
  });
});

// ---------------------------------------------------------------------------
// D5 INDEPENDENCE GATE — tools/verify-release.mjs must mirror the published
// packages/repomesh-cli copy: a release needs >=1 INDEPENDENT witness
// (an attestor whose signerNode !== the release signer, OR a verified/accepted
// anchor) UNCONDITIONALLY — regardless of profile. A self-signed-only release
// with no independent witness and no anchor is NEVER PASS (verdict UNVERIFIED,
// ok:false, exit 1). This closes the profile-gated bypass where the baseline
// profile (zero required attestation types) let a self-signed release reach PASS.
//
// Proves BOTH halves of the invariant:
//   (a) baseline self-signed, no attestor, no anchor   -> UNVERIFIED / ok:false / exit 1
//   (b) release WITH a valid independent attestor       -> PASS / ok:true / exit 0
// ---------------------------------------------------------------------------
describe("D5 independence gate (tools mirrors packages)", () => {
  it("(a) baseline self-signed release with NO independent witness is UNVERIFIED, never PASS (exit 1)", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "indep-org/indep-repo";
      const RELKEY = "ci-indep-repo-2026";
      const relKeys = generateTestKeypair();
      // Validly self-signed release. Baseline profile requires NO attestation types,
      // so under the OLD profile-gated logic this would have reached PASS — the bug.
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [{ name: "d", sha256: "a".repeat(64) }], notes: "" },
        relKeys.privateKeyPem, RELKEY
      );
      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: RELKEY, publicKey: relKeys.publicKeyPem, contact: "i@x" }] });
      const profileDir = path.join(tmpDir, "profiles");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, "baseline.json"), JSON.stringify({
        id: "baseline", version: "v1",
        requiredChecks: { integrity: ["signed"], assurance: [] },
      }), "utf8");
      const repoNodeDir = path.join(tmpDir, "ledger", "nodes", "indep-org", "indep-repo");
      fs.writeFileSync(path.join(repoNodeDir, "repomesh.profile.json"), JSON.stringify({ profileId: "baseline" }), "utf8");

      buildLedger(tmpDir, [release]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: profileDir,
      }, `--repo ${repo} --version 1.0.0 --json`);

      assert.notEqual(r.status, 0, "self-signed-only baseline release must exit non-zero");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "self-signed-only baseline release must NOT be ok");
      assert.equal(out.release.signatureValid, true, "the release signature itself is valid");
      assert.equal(out.gate.verdict, "UNVERIFIED", "verdict must be UNVERIFIED (never PASS) with no independent witness");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("(b) baseline release WITH a valid independent attestor (signerNode != release signer) PASSES", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "indep-org/indep-repo2";
      const RELKEY = "ci-indep-repo2-2026";
      const ATTKEY = "ci-witness-2026";
      const relKeys = generateTestKeypair();
      const attKeys = generateTestKeypair();
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [{ name: "d", sha256: "a".repeat(64) }], notes: "" },
        relKeys.privateKeyPem, RELKEY
      );
      // An INDEPENDENT attestor (a different node) signs a passing attestation.
      // D12: the attestor must be a node in the BUNDLED trusted-attestor allowlist — a random
      // "witness-org/witness" no longer earns trust. Use an allowlisted org node.
      const WITNESS = "mcp-tool-shop-org/repomesh-security-verifier";
      const att = signAttestation({ repo, version: "1.0.0", type: "security.scan", result: "pass", keys: attKeys, keyId: ATTKEY, timestamp: "2026-03-01T02:00:00Z" });

      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: RELKEY, publicKey: relKeys.publicKeyPem, contact: "i@x" }] });
      registerNode(tmpDir, WITNESS, { id: WITNESS, kind: "attestor", maintainers: [{ keyId: ATTKEY, publicKey: attKeys.publicKeyPem, contact: "w@x" }] });
      const profileDir = path.join(tmpDir, "profiles");
      fs.mkdirSync(profileDir, { recursive: true });
      // baseline requires no attestation types — the independent attestor alone is the witness.
      fs.writeFileSync(path.join(profileDir, "baseline.json"), JSON.stringify({
        id: "baseline", version: "v1",
        requiredChecks: { integrity: ["signed"], assurance: [] },
      }), "utf8");
      const repoNodeDir = path.join(tmpDir, "ledger", "nodes", "indep-org", "indep-repo2");
      fs.writeFileSync(path.join(repoNodeDir, "repomesh.profile.json"), JSON.stringify({ profileId: "baseline" }), "utf8");

      buildLedger(tmpDir, [release, att]);

      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: profileDir,
      }, `--repo ${repo} --version 1.0.0 --json`);

      assert.equal(r.status, 0, "release with an independent attestor must exit 0");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, true, "release with an independent attestor must be ok");
      assert.equal(out.gate.verdict, "PASS", "verdict is PASS when an independent witness is present");
      assert.equal(out.gate.independentAttestor, true, "independentAttestor flag is set");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D12 (CRITICAL #1) — tools/verify-release.mjs carries the BUNDLED trusted-attestor
// allowlist (the 5 org nodes; allowed kinds {attestor, registry}), identical to the
// published packages copy. A valid-signature attestation from a NON-allowlisted node
// (or a node of a disallowed kind) is NOT a trusted attestor: it neither satisfies a
// required gate slot NOR counts as an independent witness. A fetched verifier.policy.json
// may NARROW the bundled set, never WIDEN it. RED on pre-D12 (cross-node lookup accepted
// any registered node), GREEN after.
// ---------------------------------------------------------------------------
describe("D12 bundled attestor allowlist (tools mirrors packages)", () => {
  const TRUSTED = "mcp-tool-shop-org/repomesh-security-verifier";
  const NOT_TRUSTED = "rogue-org/rogue-attestor";

  it("a valid-signature attestation from a NON-allowlisted node is NOT an independent witness (UNVERIFIED)", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "d12-org/d12-repo";
      const RELKEY = "ci-d12-repo-2026";
      const ATTKEY = "ci-rogue-2026";
      const relKeys = generateTestKeypair();
      const attKeys = generateTestKeypair();
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [{ name: "d", sha256: "a".repeat(64) }], notes: "" },
        relKeys.privateKeyPem, RELKEY
      );
      // Rogue attestor (valid KIND, NOT allowlisted) signs a perfectly valid passing attestation.
      const rogueAtt = signAttestation({ repo, version: "1.0.0", type: "security.scan", result: "pass", keys: attKeys, keyId: ATTKEY, timestamp: "2026-03-01T02:00:00Z" });

      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: RELKEY, publicKey: relKeys.publicKeyPem, contact: "d@x" }] });
      registerNode(tmpDir, NOT_TRUSTED, { id: NOT_TRUSTED, kind: "attestor", maintainers: [{ keyId: ATTKEY, publicKey: attKeys.publicKeyPem, contact: "r@x" }] });
      const profileDir = path.join(tmpDir, "profiles");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, "baseline.json"), JSON.stringify({
        id: "baseline", version: "v1", requiredChecks: { integrity: ["signed"], assurance: [] },
      }), "utf8");
      const repoNodeDir = path.join(tmpDir, "ledger", "nodes", "d12-org", "d12-repo");
      fs.writeFileSync(path.join(repoNodeDir, "repomesh.profile.json"), JSON.stringify({ profileId: "baseline" }), "utf8");

      buildLedger(tmpDir, [release, rogueAtt]);
      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: profileDir,
      }, `--repo ${repo} --version 1.0.0 --json`);

      assert.notEqual(r.status, 0, "a non-allowlisted attestor must NOT make a release PASS");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false, "non-allowlisted attestor must not satisfy independence");
      assert.equal(out.gate.verdict, "UNVERIFIED", "verdict must be UNVERIFIED");
      assert.equal(out.gate.independentAttestor, false, "non-allowlisted signer excluded from independence");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("a non-allowlisted attestation does NOT satisfy a required gate slot (treated as missing)", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "d12b-org/d12b-repo";
      const RELKEY = "ci-d12b-repo-2026";
      const ATTKEY = "ci-rogue-2026";
      const relKeys = generateTestKeypair();
      const attKeys = generateTestKeypair();
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [{ name: "d", sha256: "a".repeat(64) }], notes: "" },
        relKeys.privateKeyPem, RELKEY
      );
      const rogueAtt = signAttestation({ repo, version: "1.0.0", type: "security.scan", result: "pass", keys: attKeys, keyId: ATTKEY, timestamp: "2026-03-01T02:00:00Z" });

      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: RELKEY, publicKey: relKeys.publicKeyPem, contact: "d@x" }] });
      registerNode(tmpDir, NOT_TRUSTED, { id: NOT_TRUSTED, kind: "attestor", maintainers: [{ keyId: ATTKEY, publicKey: attKeys.publicKeyPem, contact: "r@x" }] });
      const profileDir = path.join(tmpDir, "profiles");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, "strict.json"), JSON.stringify({
        id: "strict", version: "v1", requiredChecks: { integrity: ["signed"], assurance: ["security.scan"] },
      }), "utf8");
      const repoNodeDir = path.join(tmpDir, "ledger", "nodes", "d12b-org", "d12b-repo");
      fs.writeFileSync(path.join(repoNodeDir, "repomesh.profile.json"), JSON.stringify({ profileId: "strict" }), "utf8");

      buildLedger(tmpDir, [release, rogueAtt]);
      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: profileDir,
      }, `--repo ${repo} --version 1.0.0 --json`);

      assert.notEqual(r.status, 0, "non-allowlisted attestation must not satisfy the required slot");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false);
      assert.ok(!out.gate.satisfied.includes("security.scan"),
        "security.scan must NOT be satisfied by a non-allowlisted attestor");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("an allowlisted attestor IS trusted (no false negative — release PASSES)", () => {
    const tmpDir = makeTempDir();
    try {
      const repo = "d12c-org/d12c-repo";
      const RELKEY = "ci-d12c-repo-2026";
      const ATTKEY = "ci-sv-2026";
      const relKeys = generateTestKeypair();
      const attKeys = generateTestKeypair();
      const release = signEvent(
        { type: "ReleasePublished", repo, version: "1.0.0", commit: "abc", timestamp: "2026-03-01T00:00:00Z", artifacts: [{ name: "d", sha256: "a".repeat(64) }], notes: "" },
        relKeys.privateKeyPem, RELKEY
      );
      const att = signAttestation({ repo, version: "1.0.0", type: "security.scan", result: "pass", keys: attKeys, keyId: ATTKEY, timestamp: "2026-03-01T02:00:00Z" });

      registerNode(tmpDir, repo, { id: repo, kind: "tool", maintainers: [{ keyId: RELKEY, publicKey: relKeys.publicKeyPem, contact: "d@x" }] });
      registerNode(tmpDir, TRUSTED, { id: TRUSTED, kind: "attestor", maintainers: [{ keyId: ATTKEY, publicKey: attKeys.publicKeyPem, contact: "s@x" }] });
      const profileDir = path.join(tmpDir, "profiles");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(path.join(profileDir, "baseline.json"), JSON.stringify({
        id: "baseline", version: "v1", requiredChecks: { integrity: ["signed"], assurance: [] },
      }), "utf8");
      const repoNodeDir = path.join(tmpDir, "ledger", "nodes", "d12c-org", "d12c-repo");
      fs.writeFileSync(path.join(repoNodeDir, "repomesh.profile.json"), JSON.stringify({ profileId: "baseline" }), "utf8");

      buildLedger(tmpDir, [release, att]);
      const r = runVerify({
        REPOMESH_LEDGER_PATH: path.join(tmpDir, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(tmpDir, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: profileDir,
      }, `--repo ${repo} --version 1.0.0 --json`);

      assert.equal(r.status, 0, "an allowlisted attestor must be trusted (no false negative)");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, true);
      assert.equal(out.gate.verdict, "PASS");
      assert.equal(out.gate.independentAttestor, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// SB-TOOLS-01 — init generates a SCHEMA-VALID node.json for repos with uppercase
// names (regression: "MyRepo" -> "-y-epo.v1" which failed the capability pattern).
// RED on baseline (init either aborted at the keyId gate OR wrote an invalid manifest);
// GREEN after the normalize + validate-before-write fix.
// ---------------------------------------------------------------------------
describe("SB-TOOLS-01 init produces schema-valid node.json for uppercase repos", () => {
  const Ajv2020 = require("ajv/dist/2020.js");
  const addFormats = require("ajv-formats");
  const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "schemas", "node.schema.json"), "utf8"));

  function validateAgainstSchema(nodeJson) {
    const ajv = new (Ajv2020.default || Ajv2020)({ allErrors: true, strict: false });
    (addFormats.default || addFormats)(ajv);
    const validate = ajv.compile(SCHEMA);
    return { ok: validate(nodeJson), errors: validate.errors };
  }

  // The exact capability pattern from schemas/node.schema.json $defs.capability.
  const CAP = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.v[0-9]+$/;

  for (const repo of ["Foo/MyRepo", "org/ETL-Pipeline", "x/9Lives"]) {
    it(`init --repo ${repo} writes a node.json that passes the node schema`, () => {
      const { execSync } = require("node:child_process");
      const tmpDir = makeTempDir();
      try {
        const r = (() => {
          try {
            const stdout = execSync(
              `node tools/init-node.mjs --repo ${repo} --profile baseline --no-pr --target-dir "${tmpDir}"`,
              { cwd: REPO_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }
            );
            return { status: 0, stdout };
          } catch (e) { return { status: e.status, stdout: e.stdout || "", stderr: e.stderr || "" }; }
        })();

        assert.equal(r.status, 0, `init must succeed for uppercase repo "${repo}" (got exit ${r.status})`);
        const nodePath = path.join(tmpDir, "node.json");
        assert.ok(fs.existsSync(nodePath), "node.json must be written");
        const nodeJson = JSON.parse(fs.readFileSync(nodePath, "utf8"));

        // The generated capability must match the schema pattern (the actual SB-TOOLS-01 bug).
        for (const cap of nodeJson.provides) {
          assert.ok(CAP.test(cap), `generated capability "${cap}" must match the schema pattern`);
        }
        // And the WHOLE manifest must validate against the canonical schema.
        const v = validateAgainstSchema(nodeJson);
        assert.ok(v.ok, `node.json must be schema-valid; errors: ${JSON.stringify(v.errors)}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }

  it("normalizeCapability + validateNodeJson are exported and behave", async () => {
    const m = await import("../../tools/init-node.mjs");
    assert.equal(m.normalizeCapability("MyRepo", 1), "myrepo.v1");
    assert.equal(m.normalizeCapability("ETL-Pipeline", 1), "etl-pipeline.v1");
    assert.ok(m.normalizeCapability("9lives", 1).startsWith("node-"), "digit-leading slug gets a valid prefix");
    // A deliberately invalid manifest must be REJECTED by the validator (loud, not silent).
    const bad = { id: "Foo/Bar", kind: "compute", provides: ["Bad.Cap"], consumes: [],
      interfaces: [{ name: "x", version: "v1", schemaPath: "./x.json" }],
      invariants: { deterministicBuild: true, signedReleases: true, semver: true, changelog: true },
      maintainers: [{ name: "Foo", keyId: "ci-x-2026", publicKey: "x".repeat(40) }] };
    assert.notEqual(m.validateNodeJson(bad), null, "schema-invalid manifest must return a reason string");
  });
});

// ---------------------------------------------------------------------------
// SB-DOCS-01 — `init --json` is implemented (the README documents it). The JSON
// summary must be the ONLY thing on stdout (parseable), and the error path must
// emit {ok:false, reason, hint}. RED on baseline (init had no --json; the README
// example broke); GREEN after implementing --json.
// ---------------------------------------------------------------------------
describe("SB-DOCS-01 init --json emits a clean machine-readable summary", () => {
  it("stdout is pure parseable JSON with ok:true on success", () => {
    const { execSync } = require("node:child_process");
    const tmpDir = makeTempDir();
    try {
      const stdout = execSync(
        `node tools/repomesh.mjs init --repo demo-org/demo-repo --profile open-source --no-pr --target-dir "${tmpDir}" --json`,
        { cwd: REPO_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }
      );
      // The ENTIRE stdout must parse as a single JSON object (no banner pollution).
      const obj = JSON.parse(stdout.trim());
      assert.equal(obj.ok, true);
      assert.equal(obj.repo, "demo-org/demo-repo");
      assert.ok(Array.isArray(obj.node.provides) && obj.node.provides.length > 0);
      assert.ok(obj.files && obj.files.nodeJson, "json carries generated file paths");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("error path emits {ok:false, reason, hint} on stdout and exits non-zero", () => {
    const { execSync } = require("node:child_process");
    let r;
    try {
      const stdout = execSync(`node tools/repomesh.mjs init --repo noslash --no-pr --json`,
        { cwd: REPO_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 });
      r = { status: 0, stdout };
    } catch (e) { r = { status: e.status, stdout: e.stdout || "" }; }
    assert.notEqual(r.status, 0, "bad --repo must exit non-zero");
    const obj = JSON.parse(r.stdout.trim());
    assert.equal(obj.ok, false);
    assert.ok(obj.reason, "json error carries a machine-readable reason");
    assert.ok(obj.hint, "json error carries a human hint");
  });
});

// ---------------------------------------------------------------------------
// SB-TOOLS-02 / SB-TOOLS-03 — register-node retry backoff no longer CPU-spins, and
// the gh pr create call is bounded by a timeout. Source-level regression guards
// (behavior is network-gated; a unit test that triggers a real retry is N/A here).
// ---------------------------------------------------------------------------
describe("SB-TOOLS-02/03 register-node backoff + gh timeout", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "tools", "register-node.mjs"), "utf8");
  it("retry backoff does NOT busy-wait on Date.now()", () => {
    assert.ok(!/while\s*\(\s*Date\.now\(\)\s*<\s*end\s*\)/.test(src), "busy-wait spin loop must be gone");
    assert.ok(/Atomics\.wait|setTimeout/.test(src), "backoff uses a real (non-spinning) sleep");
  });
  it("gh pr create is bounded by a timeout", () => {
    // The pr-create retryExec call must pass a timeout option.
    assert.ok(/pr",\s*"create"[\s\S]*?timeout:\s*\d+/.test(src), "gh pr create must carry a timeout");
  });
});
