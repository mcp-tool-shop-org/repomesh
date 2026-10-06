// RepoMesh Policy — Stage A amend tests (LDG-005 compareSemver NaN guard).
//
// check-policy.mjs is a top-level script that reads the ledger from REPOMESH_LEDGER_PATH and the
// node tree from REPOMESH_NODES_PATH. We feed it a crafted ledger containing a malformed version
// string (which reaches compareSemver only because the policy node reads raw, pre-schema) and
// assert it neither crashes nor emits a bogus monotonicity verdict — it warns and skips.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, "..", "scripts", "check-policy.mjs");

function makeEvent(version, ts, opts = {}) {
  return {
    type: "ReleasePublished",
    repo: opts.repo || "test-org/test-repo",
    version,
    commit: "a".repeat(40),
    timestamp: ts,
    artifacts: [{ name: "b.js", sha256: opts.sha256 || "b".repeat(64), uri: "https://example.com/b.js" }],
    attestations: [],
    signature: { alg: "ed25519", keyId: "k", value: "x".repeat(40), canonicalHash: "f".repeat(64) },
  };
}

function runPolicy(events, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-policy-"));
  const ledgerPath = path.join(dir, "events.jsonl");
  fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const args = [CHECKER];
  let outPath = null;
  if (opts.output) {
    outPath = path.join(dir, "out.jsonl");
    args.push("--output", outPath);
  }
  if (opts.sign) args.push("--sign");
  const env = { ...process.env, REPOMESH_LEDGER_PATH: ledgerPath, REPOMESH_NODES_PATH: path.join(dir, "nodes") };
  if (opts.sign) {
    delete env.REPOMESH_SIGNING_KEY;
    delete env.REPOMESH_KEY_ID;
  }
  const res = spawnSync("node", args, { env, encoding: "utf8" });
  const outFile = outPath && fs.existsSync(outPath) ? fs.readFileSync(outPath) : null;
  return { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "", outFile };
}

describe("LDG-005 compareSemver NaN guard", () => {
  it("does not crash on a malformed version and warns instead of a bogus verdict", () => {
    const r = runPolicy([
      makeEvent("1.0.0", "2026-01-01T00:00:00.000Z"),
      makeEvent("1.x.0", "2026-01-02T00:00:00.000Z"), // non-integer minor → NaN segment
    ]);
    // Exit 2 means a monotonicity ERROR was raised; a NaN must NOT be coerced to 0 and produce one.
    assert.notEqual(r.code, 2, "NaN segment must not produce a bogus semver.monotonicity error\n" + r.err);
    assert.match(r.err + r.out, /non-integer|skipping semver/i, "must warn about the non-integer segment");
  });

  it("still flags a genuine non-monotonic downgrade", () => {
    const r = runPolicy([
      makeEvent("2.0.0", "2026-01-01T00:00:00.000Z"),
      makeEvent("1.0.0", "2026-01-02T00:00:00.000Z"), // real downgrade
    ]);
    assert.equal(r.code, 2, "a real downgrade must still be flagged as an error\n" + r.out);
    assert.match(r.out, /monotonicity/i);
  });

  it("accepts a clean monotonic sequence", () => {
    const r = runPolicy([
      makeEvent("1.0.0", "2026-01-01T00:00:00.000Z"),
      makeEvent("1.0.1", "2026-01-02T00:00:00.000Z"),
      makeEvent("1.1.0", "2026-01-03T00:00:00.000Z"),
    ]);
    assert.equal(r.code, 0, "clean monotonic sequence must pass\n" + r.out + r.err);
  });
});

describe("warnings-only output is an empty file, not a counted blank line", () => {
  const sharedHash = "c".repeat(64);

  it("writes zero bytes when the only finding is a hash-collision warning", () => {
    const r = runPolicy([
      makeEvent("1.0.0", "2026-01-01T00:00:00.000Z", { sha256: sharedHash }),
      makeEvent("1.0.1", "2026-01-02T00:00:00.000Z", { sha256: sharedHash, repo: "test-org/other" }),
    ], { output: true });
    assert.equal(r.code, 0, "a warning must not exit 2\n" + r.out + r.err);
    assert.match(r.out, /hash\.collision/i);
    assert.ok(r.outFile, "output file must exist");
    assert.equal(r.outFile.length, 0, "warnings-only output must be 0 bytes, not a lone newline");
  });

  it("does not require a signing key when nothing will be ledgered", () => {
    const r = runPolicy([
      makeEvent("1.0.0", "2026-01-01T00:00:00.000Z", { sha256: sharedHash }),
      makeEvent("1.0.1", "2026-01-02T00:00:00.000Z", { sha256: sharedHash, repo: "test-org/other" }),
    ], { output: true, sign: true });
    assert.equal(r.code, 0, "warnings-only --sign must not fail closed on a missing key\n" + r.err);
    assert.equal(r.outFile.length, 0);
  });

  it("still writes one PolicyViolation line for a real downgrade", () => {
    const r = runPolicy([
      makeEvent("2.0.0", "2026-01-01T00:00:00.000Z"),
      makeEvent("1.0.0", "2026-01-02T00:00:00.000Z"),
    ], { output: true });
    assert.equal(r.code, 2);
    const lines = r.outFile.toString("utf8").split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).type, "PolicyViolation");
  });
});
