import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }

describe("log.mjs helper", () => {
  it("exports isQuiet, isVerbose, isDebug, log, verbose, debug", async () => {
    const mod = await import(toURL(resolve(srcDir, "log.mjs")));
    assert.equal(typeof mod.isQuiet, "function");
    assert.equal(typeof mod.isVerbose, "function");
    assert.equal(typeof mod.isDebug, "function");
    assert.equal(typeof mod.log, "function");
    assert.equal(typeof mod.verbose, "function");
    assert.equal(typeof mod.debug, "function");
  });

  it("isQuiet returns false when --quiet not in argv", async () => {
    const mod = await import(toURL(resolve(srcDir, "log.mjs")));
    // process.argv won't have --quiet in test
    assert.equal(mod.isQuiet(), false);
  });

  it("isDebug returns false when --debug not in argv", async () => {
    const mod = await import(toURL(resolve(srcDir, "log.mjs")));
    assert.equal(mod.isDebug(), false);
  });
});

describe("completion subcommand", () => {
  it("outputs bash completion script", async () => {
    const { execFileSync } = await import("node:child_process");
    const result = execFileSync("node", [resolve(srcDir, "cli.mjs"), "completion"], {
      encoding: "utf8",
      cwd: resolve(__dirname, ".."),
    });
    assert.ok(result.includes("_repomesh"), "Should contain bash function name");
    assert.ok(result.includes("complete -F _repomesh repomesh"), "Should contain complete directive");
    assert.ok(result.includes("verify-release"), "Should list verify-release command");
  });

  it("outputs zsh completion script with --shell zsh", async () => {
    const { execFileSync } = await import("node:child_process");
    const result = execFileSync("node", [resolve(srcDir, "cli.mjs"), "completion", "--shell", "zsh"], {
      encoding: "utf8",
      cwd: resolve(__dirname, ".."),
    });
    assert.ok(result.includes("#compdef repomesh"), "Should contain zsh compdef header");
    assert.ok(result.includes("_repomesh"), "Should contain zsh function name");
  });
});

describe("global flags registered", () => {
  it("--help output includes --quiet and --verbose", async () => {
    const { execFileSync } = await import("node:child_process");
    const result = execFileSync("node", [resolve(srcDir, "cli.mjs"), "--help"], {
      encoding: "utf8",
      cwd: resolve(__dirname, ".."),
    });
    assert.ok(result.includes("--quiet"), "Should list --quiet flag");
    assert.ok(result.includes("--verbose"), "Should list --verbose flag");
    assert.ok(result.includes("--debug"), "Should list --debug flag");
  });
});

describe("error hints in verify-release", () => {
  it("verifySignature returns hint when public key not found", async () => {
    const fs = await import("node:fs");
    const crypto = await import("node:crypto");
    const tmpDir = resolve(__dirname, "..", ".tmp-hints-test");
    const eventsDir = resolve(tmpDir, "ledger", "events");
    const registryDir = resolve(tmpDir, "registry");
    const schemasDir = resolve(tmpDir, "schemas");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.mkdirSync(registryDir, { recursive: true });
    fs.mkdirSync(schemasDir, { recursive: true });

    // Build event with correct canonicalHash so signature check reaches key lookup
    const { canonicalize } = await import(toURL(resolve(srcDir, "verify", "canonicalize.mjs")));
    const eventBody = {
      type: "ReleasePublished",
      repo: "org/hints-test",
      version: "1.0.0",
      timestamp: "2026-01-01T00:00:00Z",
      commit: "abc123",
      artifacts: [],
    };
    const canonHash = crypto.createHash("sha256").update(canonicalize(eventBody), "utf8").digest("hex");
    const event = {
      ...eventBody,
      signature: { keyId: "nonexistent-key", canonicalHash: canonHash, value: "dGVzdA==" }
    };
    fs.writeFileSync(resolve(eventsDir, "events.jsonl"), JSON.stringify(event) + "\n");

    const { verifyRelease } = await import(toURL(resolve(srcDir, "verify", "verify-release.mjs")));
    const origExit = process.exit;
    const origCwd = process.cwd;
    let output = "";
    const origLog = console.log;
    console.log = (msg) => { output += msg; };
    process.exit = (code) => { throw new Error("EXIT"); };
    process.cwd = () => tmpDir;

    try {
      await verifyRelease({ repo: "org/hints-test", version: "1.0.0", json: true });
    } catch (e) {
      if (e.message !== "EXIT") throw e;
    } finally {
      process.exit = origExit;
      process.cwd = origCwd;
      console.log = origLog;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    assert.ok(output.includes("no public key"), "Should mention missing public key");
    assert.ok(output.includes("node.json"), "Should hint about node.json registration");
  });
});
