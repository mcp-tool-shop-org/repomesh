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

function makeEvent(version, ts) {
  return {
    type: "ReleasePublished",
    repo: "test-org/test-repo",
    version,
    commit: "a".repeat(40),
    timestamp: ts,
    artifacts: [{ name: "b.js", sha256: "b".repeat(64), uri: "https://example.com/b.js" }],
    attestations: [],
    signature: { alg: "ed25519", keyId: "k", value: "x".repeat(40), canonicalHash: "f".repeat(64) },
  };
}

function runPolicy(events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-policy-"));
  const ledgerPath = path.join(dir, "events.jsonl");
  fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const res = spawnSync("node", [CHECKER], {
    env: { ...process.env, REPOMESH_LEDGER_PATH: ledgerPath, REPOMESH_NODES_PATH: path.join(dir, "nodes") },
    encoding: "utf8",
  });
  return { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
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
