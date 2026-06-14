// STGB-VER-006 — verify-repro previously collapsed 3 structurally different outcomes into ONE 'warn'
// token (no artifact hashes / Docker unavailable / real partial mismatch). After the fix:
//   - CAN'T-RUN cases (no artifact hashes, Docker unavailable, build/clone error) -> 'unscored'
//     (0 assurance) with DISTINCT reason codes.
//   - REAL comparison outcomes keep 'warn' (partial) / 'fail' (hash mismatch) / 'pass' (all match),
//     each with a distinct reasonCode.
//
// RED before fix: the no-artifact-hashes path returned { result: "warn", reason: "no artifacts" }.
// This test asserts it is now 'unscored' with the distinct "no-artifact-hashes" reason + a hint.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIERS_ROOT = path.join(HERE, "..");

const REPO = "test-org/test-repo";
const VERSION = "1.0.0";

// Build a temp working dir whose ledger has a ReleasePublished with EMPTY artifacts, so the verifier
// hits the "no artifact hashes to compare" can't-run branch before any Docker call.
function withEmptyArtifactsLedger(fn) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-ver006-"));
  const ledgerDir = path.join(baseDir, "ledger", "events");
  fs.mkdirSync(ledgerDir, { recursive: true });
  const dst = path.join(baseDir, "verifiers", "repro");
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(
    path.join(VERIFIERS_ROOT, "repro", "config.json"),
    path.join(dst, "config.json")
  );

  const releaseEvent = {
    type: "ReleasePublished",
    repo: REPO,
    version: VERSION,
    commit: "abc123",
    artifacts: [], // empty -> can't-run, non-scoring
    attestations: [],
  };
  fs.writeFileSync(path.join(ledgerDir, "events.jsonl"), JSON.stringify(releaseEvent) + "\n", "utf8");

  const origCwd = process.cwd();
  process.chdir(baseDir);
  return Promise.resolve(fn(baseDir)).finally(() => process.chdir(origCwd));
}

describe("STGB-VER-006 repro can't-run cases are 'unscored' with distinct reasons", () => {
  it("no artifact hashes -> result 'unscored' with reason 'no-artifact-hashes' + hint", async () => {
    const { runOne } = await import("../repro/scripts/verify-repro.mjs");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-ver006-out-"));
    const outPath = path.join(outDir, "repro.jsonl");
    await withEmptyArtifactsLedger(async () => {
      const r = await runOne({ repo: REPO, version: VERSION, sign: false, out: outPath });
      assert.equal(r.result, "unscored", "no artifacts is a can't-run case -> unscored, not warn");
      assert.equal(r.reason, "no-artifact-hashes", "distinct reason code for the empty-artifacts case");
      assert.ok(r.hint, "the can't-run case carries a human hint");
    });
    // The emitted attestation URI carries :unscored, not :warn.
    const ev = JSON.parse(fs.readFileSync(outPath, "utf8").trim().split("\n")[0]);
    assert.match(ev.attestations[0].uri, /:unscored$/, "no-artifacts writes a :unscored URI");
    assert.match(ev.notes, /no-artifact-hashes/, "the distinct reason code appears in the notes");
  });
});

describe("STGB-VER-006 isBuildCommandAllowed unchanged (additive only)", () => {
  it("still accepts the shipped build command", async () => {
    const { isBuildCommandAllowed } = await import("../repro/scripts/verify-repro.mjs");
    assert.equal(isBuildCommandAllowed("npm ci && npm run build && npm pack"), true);
    assert.equal(isBuildCommandAllowed("rm -rf / ; echo pwn"), false);
  });
});
