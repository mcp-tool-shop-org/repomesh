// Stage C — remote-revocation legibility warning (STGB-CLI-001).
//
// In REMOTE mode the local revocation defenses (derive-stricter, ledger-immutability) are inert,
// so a revocation-sensitive verification's integrity rests on trusting the (possibly overridden)
// source. The CLI must surface this loudly when remote AND NOT --anchored, escalated when a URL
// override is present. --local OR --anchored closes the gap (no warning). --quiet suppresses it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
const cli = resolve(__dirname, "..", "src", "cli.mjs");
function toURL(p) { return pathToFileURL(p).href; }
const { deriveRemoteRevocationWarning } = await import(toURL(resolve(srcDir, "remote-defaults.mjs")));

describe("STGB-CLI-001: deriveRemoteRevocationWarning logic", () => {
  it("remote + NOT anchored => warns (gap exists)", () => {
    const r = deriveRemoteRevocationWarning({ local: false, anchored: false });
    assert.equal(r.warn, true, "remote, no on-chain witness => warn");
    assert.equal(r.escalated, false, "no URL override => not escalated");
    assert.ok(r.lines.join("\n").includes("WARNING"), "carries a loud WARNING");
    assert.match(r.lines.join("\n").toLowerCase(), /inert|trusting|revocation/, "explains the gap");
  });

  it("local mode => no warning (real defenses run)", () => {
    const r = deriveRemoteRevocationWarning({ local: true, anchored: false });
    assert.equal(r.warn, false);
    assert.deepEqual(r.lines, []);
  });

  it("--anchored => no warning (on-chain witness closes the gap)", () => {
    const r = deriveRemoteRevocationWarning({ local: false, anchored: true });
    assert.equal(r.warn, false);
  });

  it("a URL override escalates the warning", () => {
    const r = deriveRemoteRevocationWarning({ local: false, anchored: false, ledgerUrl: "https://evil.example/ledger.jsonl" });
    assert.equal(r.warn, true);
    assert.equal(r.escalated, true, "an override raises the stakes");
    const text = r.lines.join("\n");
    assert.match(text, /ESCALATED/, "escalation is explicit");
    assert.match(text, /evil\.example/, "names the overridden source");
  });

  it("nodes-url override also escalates", () => {
    const r = deriveRemoteRevocationWarning({ local: false, anchored: false, nodesUrl: "https://x.example/nodes" });
    assert.equal(r.escalated, true);
    assert.match(r.lines.join("\n"), /x\.example/);
  });

  it("always points to --anchored / --local as the remedy", () => {
    const r = deriveRemoteRevocationWarning({ local: false, anchored: false });
    assert.match(r.lines.join("\n"), /--anchored/, "remedy mentions --anchored");
    assert.match(r.lines.join("\n"), /--local/, "remedy mentions --local");
  });
});

// Spawn-level: confirm the warning reaches stderr in remote mode and is suppressed appropriately.
// We point cwd at a non-checkout dir and use a malformed ledger-url so the verify fails fast
// (STGB-CLI-007), but the WARNING is emitted BEFORE the fetch, so it shows regardless of outcome.
function run(args) {
  // Short timeout so the (failing) remote fetch returns fast and the test stays deterministic;
  // the WARNING is emitted before the fetch, so it appears regardless of network outcome.
  const env = { ...process.env, REPOMESH_FETCH_TIMEOUT: "500" };
  try {
    const stdout = execFileSync("node", [cli, ...args], { encoding: "utf8", cwd: os.tmpdir(), env, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? null, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

describe("STGB-CLI-001: warning wiring in verify-release", () => {
  const base = ["verify-release", "--repo", "org/app", "--version", "1.0.0", "--ledger-url", "https://example.com/ledger.jsonl"];

  it("remote (no --anchored) prints the WARNING to stderr", () => {
    const { stderr } = run(base);
    assert.match(stderr, /WARNING: remote verification/, "remote, no witness => warning on stderr");
    assert.match(stderr, /ESCALATED/, "a --ledger-url override escalates");
  });

  it("--quiet suppresses the warning", () => {
    const { stderr } = run([...base, "--quiet"]);
    assert.doesNotMatch(stderr, /WARNING: remote verification/, "--quiet suppresses the advisory warning");
  });

  it("--json keeps stdout clean (warning never leaks onto stdout)", () => {
    const { stdout } = run([...base, "--json"]);
    assert.doesNotMatch(stdout, /WARNING: remote verification/, "warning must not pollute the JSON blob on stdout");
  });
});
