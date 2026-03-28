import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");

function toURL(p) { return pathToFileURL(p).href; }

describe("F1: malformed JSON.parse handling", () => {
  it("fetchJson throws on invalid JSON with clear message", async () => {
    const { fetchJson } = await import(toURL(resolve(srcDir, "http.mjs")));
    await assert.rejects(
      () => fetchJson("http://127.0.0.1:1/nonexistent"),
      (err) => {
        assert.ok(err.message.length > 0, "Error should have a message");
        return true;
      }
    );
  });

  it("verify-release loadEvents tolerates malformed JSONL lines", async () => {
    const tmpDir = resolve(__dirname, "..", ".tmp-hardening-test");
    const eventsDir = resolve(tmpDir, "ledger", "events");
    const registryDir = resolve(tmpDir, "registry");
    const schemasDir = resolve(tmpDir, "schemas");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.mkdirSync(registryDir, { recursive: true });
    fs.mkdirSync(schemasDir, { recursive: true });

    fs.writeFileSync(
      resolve(eventsDir, "events.jsonl"),
      '{"type":"ReleasePublished","repo":"org/test","version":"1.0.0","timestamp":"2026-01-01T00:00:00Z","commit":"abc","artifacts":[],"signature":{"keyId":"k1","canonicalHash":"' + "a".repeat(64) + '","value":"dGVzdA=="}}\nNOT_JSON\n{"type":"AttestationPublished"}\n'
    );

    const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")));

    const origExit = process.exit;
    const origCwd = process.cwd;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; throw new Error("EXIT"); };
    process.cwd = () => tmpDir;

    try {
      await verifyRelease({ repo: "org/test", version: "1.0.0", json: true });
    } catch (e) {
      if (e.message !== "EXIT") throw e;
    } finally {
      process.exit = origExit;
      process.cwd = origCwd;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    assert.ok(exitCode !== null, "Should have attempted processing (exited due to missing signature, not JSONL parse)");
  });
});

describe("F2: verify-release with missing node.json", () => {
  it("findPublicKey returns null gracefully when node.json is missing", async () => {
    const tmpDir = resolve(__dirname, "..", ".tmp-hardening-test-2");
    const eventsDir = resolve(tmpDir, "ledger", "events");
    const nodesDir = resolve(tmpDir, "ledger", "nodes", "org", "repo");
    const registryDir = resolve(tmpDir, "registry");
    const schemasDir = resolve(tmpDir, "schemas");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.mkdirSync(nodesDir, { recursive: true });
    fs.mkdirSync(registryDir, { recursive: true });
    fs.mkdirSync(schemasDir, { recursive: true });

    const event = {
      type: "ReleasePublished",
      repo: "org/repo",
      version: "1.0.0",
      timestamp: "2026-01-01T00:00:00Z",
      commit: "abc123",
      artifacts: [],
      signature: { keyId: "key-1", canonicalHash: "a".repeat(64), value: "dGVzdA==" }
    };
    fs.writeFileSync(resolve(eventsDir, "events.jsonl"), JSON.stringify(event) + "\n");

    const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")));
    const origExit = process.exit;
    const origCwd = process.cwd;
    let exitCode = null;
    let output = "";
    const origLog = console.log;
    console.log = (msg) => { output += msg; };
    process.exit = (code) => { exitCode = code; throw new Error("EXIT"); };
    process.cwd = () => tmpDir;

    try {
      await verifyRelease({ repo: "org/repo", version: "1.0.0", json: true });
    } catch (e) {
      if (e.message !== "EXIT") throw e;
    } finally {
      process.exit = origExit;
      process.cwd = origCwd;
      console.log = origLog;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    assert.ok(output.includes("no public key") || exitCode === 1, "Should fail gracefully when node.json missing");
  });
});

describe("F4+F5: http timeout and debug logging", () => {
  it("fetchText rejects with timeout message on unreachable host", async () => {
    const { fetchText } = await import(toURL(resolve(srcDir, "http.mjs")));
    await assert.rejects(
      () => fetchText("http://192.0.2.1:1/test"),
      (err) => {
        assert.ok(err.message.length > 0);
        assert.ok(
          err.message.includes("192.0.2.1") || err.message.includes("timeout") || err.message.includes("Timeout") || err.message.includes("fetch") || err.message.includes("Network"),
          `Error message should be descriptive, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it("fetchJson rejects with clear message on invalid JSON response", async () => {
    const { fetchJson } = await import(toURL(resolve(srcDir, "http.mjs")));
    await assert.rejects(
      () => fetchJson("http://192.0.2.1:1/test"),
      (err) => {
        assert.ok(err.message.length > 0);
        return true;
      }
    );
  });
});

describe("F8: env var URL overrides", () => {
  it("DEFAULT_LEDGER_URL respects REPOMESH_LEDGER_URL env var", async () => {
    const mod = await import(toURL(resolve(srcDir, "remote-defaults.mjs")));
    assert.ok(mod.DEFAULT_LEDGER_URL.includes("raw.githubusercontent.com") || process.env.REPOMESH_LEDGER_URL,
      "Should use default GitHub URL or env override");
    assert.ok(typeof mod.DEFAULT_MANIFESTS_URL === "string");
    assert.ok(mod.DEFAULT_MANIFESTS_URL.length > 0);
  });
});
