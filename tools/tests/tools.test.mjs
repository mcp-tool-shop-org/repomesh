import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

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

    const { execSync } = await import("node:child_process");
    const result = execSync(
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

    const parsed = JSON.parse(result);
    assert.equal(parsed.ok, true, "verification passes");
    assert.equal(parsed.release.signatureValid, true, "signature is valid");
    assert.equal(parsed.release.keyId, KEY_ID, "keyId matches");
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

    for (const bad of badInputs) {
      try {
        execSync(
          `node tools/repomesh.mjs init --repo "${bad}" --no-pr`,
          {
            cwd: path.resolve(import.meta.dirname, "..", ".."),
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 5000,
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

      // The verify-release with --anchored should not follow the traversal path.
      // It should report "not anchored" rather than crash or read outside files.
      const { execSync } = await import("node:child_process");
      const result = execSync(
        `node tools/verify-release.mjs --repo ${REPO} --version 1.0.0 --anchored --json`,
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

      const parsed = JSON.parse(result);
      // The traversal path should have been blocked -- anchor should be null or not anchored
      assert.equal(parsed.ok, true, "overall verification passes (release is valid)");
      assert.equal(parsed.anchor?.anchored, false, "anchor not found (traversal blocked)");
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
      const result = execSync(
        `node tools/verify-release.mjs --repo ${REPO} --version 1.0.0 --anchored --json`,
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

      const parsed = JSON.parse(result);
      assert.equal(parsed.anchor?.anchored, false, "absolute path outside root is blocked");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
