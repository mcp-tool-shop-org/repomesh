// Stage C — CLI exit-code contract + enum validation (STGB-CLI-002, STGB-CLI-003).
//
// The exit-code contract this CLI must honor for CI gating:
//   0 = PASS / verified
//   1 = a real trust FAIL (tamper / invalid verdict)
//   2 = operator / usage / environment ERROR (bad flag, unknown value, bad config, outage)
//   3 = UNVERIFIED (soft; not-yet-anchored / no independent witness)
//
// STGB-CLI-002: commander argument-parse errors (missing --repo, unknown flag) must exit 2
//               (= usage ERROR), NOT 1 (= trust FAIL), and must honor --json for the error shape.
// STGB-CLI-003: typo'd enum flags (--format jon, bad --fail-on, bad --network) must be REJECTED
//               with a clear error listing valid options and exit 2 — never silently coerced.
//
// These spawn the real CLI so the assertions are on the genuine process exit code, which is what
// CI gates on. We pick a NON-checkout cwd (os.tmpdir()) so any command that would otherwise reach
// the network/ledger fails on the flag check first (the validation runs before any I/O).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = resolve(__dirname, "..", "src", "cli.mjs");

// Run the CLI, returning { code, stdout, stderr }. execFileSync throws on non-zero exit;
// we capture the thrown error's status/stdout/stderr so we can assert on a failing exit.
function run(args, { cwd = os.tmpdir() } = {}) {
  try {
    const stdout = execFileSync("node", [cli, ...args], { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? null, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

describe("STGB-CLI-002: parse/usage errors exit 2 (not 1), honor --json", () => {
  it("missing required --repo => exit 2 (usage ERROR, not trust FAIL)", () => {
    const { code, stderr } = run(["verify-release", "--version", "1.0.0"]);
    assert.equal(code, 2, "missing required option is a usage error -> exit 2");
    assert.match(stderr.toLowerCase(), /repo/, "message should name the missing option");
  });

  it("unknown flag => exit 2 (usage ERROR, not trust FAIL)", () => {
    const { code, stderr } = run(["verify-release", "--repo", "org/app", "--version", "1.0.0", "--bogus"]);
    assert.equal(code, 2, "unknown option is a usage error -> exit 2");
    assert.match(stderr.toLowerCase(), /bogus|unknown/, "message should name the unknown flag");
  });

  it("missing required --repo with --json => exit 2 + structured {code,message,hint} on stdout", () => {
    const { code, stdout } = run(["verify-release", "--version", "1.0.0", "--json"]);
    assert.equal(code, 2, "usage error still exit 2 with --json");
    const blob = stdout.match(/\{[\s\S]*\}/);
    assert.ok(blob, "a JSON error object must be emitted to stdout when --json is set");
    const obj = JSON.parse(blob[0]);
    assert.equal(typeof obj.code, "string", "structured error carries a code");
    assert.equal(typeof obj.message, "string", "structured error carries a message");
    assert.equal(typeof obj.hint, "string", "structured error carries an actionable hint");
    assert.equal(obj.ok, false, "error shape is ok:false");
  });

  it("unknown flag with --json => structured error, exit 2", () => {
    const { code, stdout } = run(["verify-anchor", "--tx", "T", "--json", "--nope"]);
    assert.equal(code, 2);
    const blob = stdout.match(/\{[\s\S]*\}/);
    assert.ok(blob, "JSON error emitted");
    const obj = JSON.parse(blob[0]);
    assert.equal(obj.ok, false);
    assert.match((obj.message || "").toLowerCase(), /nope|unknown/);
  });
});

describe("STGB-CLI-003: typo'd enum flags are rejected (exit 2), never silently coerced", () => {
  it("bad --format jon => exit 2 + lists valid formats (not empty stdout)", () => {
    const { code, stdout, stderr } = run(["verify-release", "--repo", "org/app", "--version", "1.0.0", "--format", "jon"]);
    assert.equal(code, 2, "an unknown --format value is a usage error");
    const all = stdout + stderr;
    assert.match(all, /jon/, "should echo the bad value");
    assert.match(all.toLowerCase(), /text|json|sarif|markdown/, "should list the valid formats");
  });

  it("bad --format jon with --json => structured error, never empty stdout", () => {
    const { code, stdout } = run(["verify-release", "--repo", "org/app", "--version", "1.0.0", "--format", "jon", "--json"]);
    assert.equal(code, 2);
    assert.notEqual(stdout.trim(), "", "a JSON consumer must never get empty stdout for a bad enum");
    const obj = JSON.parse(stdout.match(/\{[\s\S]*\}/)[0]);
    assert.equal(obj.ok, false);
    assert.match((obj.message || "").toLowerCase(), /format/);
  });

  it("bad --fail-on banana => exit 2 + lists unverified|fail", () => {
    const { code, stdout, stderr } = run(["verify-release", "--repo", "org/app", "--version", "1.0.0", "--fail-on", "banana"]);
    assert.equal(code, 2);
    const all = (stdout + stderr).toLowerCase();
    assert.match(all, /unverified/, "valid set listed");
    assert.match(all, /fail/, "valid set listed");
  });

  it("bad --network qa => exit 2 + lists testnet|mainnet|devnet", () => {
    const { code, stdout, stderr } = run(["verify-anchor", "--tx", "T".repeat(64), "--network", "qa"]);
    assert.equal(code, 2);
    const all = (stdout + stderr).toLowerCase();
    assert.match(all, /testnet/, "valid network set listed");
    assert.match(all, /mainnet/);
    assert.match(all, /devnet/);
  });

  it("valid --format json still works (regression guard: no over-rejection)", () => {
    // A valid value must NOT be rejected by the new validation. We point at a non-checkout cwd
    // with no network, so this will fail downstream — but NOT with the enum-rejection message,
    // and NOT with exit 2-from-validation. Accept any of: a real verdict (0/1/3) or a
    // network/env ERROR (2) whose message is NOT about an invalid format value.
    const { code, stdout, stderr } = run(["verify-release", "--repo", "org/app", "--version", "1.0.0", "--format", "json"]);
    const all = (stdout + stderr).toLowerCase();
    assert.doesNotMatch(all, /invalid.*format|unknown.*format|--format must be/, "valid format must not be rejected");
    assert.ok([0, 1, 2, 3].includes(code), "exits with a contract code");
  });
});
