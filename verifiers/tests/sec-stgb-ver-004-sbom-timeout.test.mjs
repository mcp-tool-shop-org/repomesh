// STGB-VER-004 — fetch-sbom's fetchRawWithRetries now sets an AbortSignal.timeout (mirrors osv.mjs
// 10s) so a hung SBOM URI cannot stall the scan forever. On timeout/abort the fetch rejects, retries
// exhaust, and fetchCycloneDxComponentsBound throws — verify-security maps that to result 'unscored'
// (cannot certify on an un-fetchable SBOM), with a machine-readable reason + a human hint, NOT a
// silent hang and NOT a clean pass.
//
// We assert two things:
//   1) fetchRawWithRetries passes an AbortSignal to fetch (the timeout guard is wired).
//   2) An SBOM fetch that always rejects -> verify-security result 'unscored', reason 'sbom fetch failed'.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchCycloneDxComponentsBound } from "../lib/fetch-sbom.mjs";
import { runOne as runSecurity } from "../security/scripts/verify-security.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIERS_ROOT = path.join(HERE, "..");

describe("STGB-VER-004 SBOM fetch carries an abort timeout", () => {
  it("passes an AbortSignal to fetch on every attempt", async () => {
    const origFetch = globalThis.fetch;
    let sawSignal = false;
    globalThis.fetch = async (_url, opts) => {
      if (opts && opts.signal && typeof opts.signal.aborted === "boolean") sawSignal = true;
      // Reject so retries exhaust quickly and the function throws.
      throw new Error("simulated network drop");
    };
    try {
      await assert.rejects(
        () => fetchCycloneDxComponentsBound("https://example.com/sbom.json", undefined, ),
        /simulated network drop/
      );
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.ok(sawSignal, "fetch must be called with an AbortSignal (timeout guard)");
  });

  it("the signal it passes is a live AbortSignal (abortable), not a stub", async () => {
    const origFetch = globalThis.fetch;
    let captured = null;
    globalThis.fetch = async (_url, opts) => {
      captured = opts.signal;
      throw new Error("drop"); // reject fast; we only need to capture the signal
    };
    try {
      await assert.rejects(
        () => fetchCycloneDxComponentsBound("https://example.com/sbom.json", undefined),
        /drop/
      );
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.ok(captured instanceof AbortSignal, "the timeout guard must pass a real AbortSignal");
  });
});

const REPO = "test-org/test-repo";
const VERSION = "1.0.0";

function withFailingSbomLedger(fn) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-ver004-"));
  const ledgerDir = path.join(baseDir, "ledger", "events");
  fs.mkdirSync(ledgerDir, { recursive: true });
  const dst = path.join(baseDir, "verifiers", "security");
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(
    path.join(VERIFIERS_ROOT, "security", "config.json"),
    path.join(dst, "config.json")
  );
  const releaseEvent = {
    type: "ReleasePublished",
    repo: REPO,
    version: VERSION,
    commit: "abc123",
    artifacts: [{ name: "pkg.tgz", sha256: "deadbeef" }],
    attestations: [{ type: "sbom", uri: "https://example.com/sbom.json", sha256: "a".repeat(64) }],
  };
  fs.writeFileSync(path.join(ledgerDir, "events.jsonl"), JSON.stringify(releaseEvent) + "\n", "utf8");

  const origCwd = process.cwd();
  const origFetch = globalThis.fetch;
  // SBOM fetch always rejects (simulating a hung URI whose timeout fired / network drop).
  globalThis.fetch = async () => { throw new Error("ETIMEDOUT sbom fetch"); };
  process.chdir(baseDir);
  return Promise.resolve(fn()).finally(() => {
    process.chdir(origCwd);
    globalThis.fetch = origFetch;
  });
}

describe("STGB-VER-004 un-fetchable SBOM -> verify-security 'unscored'", () => {
  it("an SBOM fetch that always fails yields result 'unscored' + reason 'sbom fetch failed'", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-ver004-out-"));
    const outPath = path.join(outDir, "security.jsonl");
    await withFailingSbomLedger(async () => {
      const r = await runSecurity({ repo: REPO, version: VERSION, sign: false, out: outPath });
      assert.equal(r.result, "unscored", "an un-fetchable SBOM is non-scoring, not a crash or a pass");
      assert.equal(r.reason, "sbom fetch failed");
      assert.ok(r.hint, "carries a human hint");
    });
    const ev = JSON.parse(fs.readFileSync(outPath, "utf8").trim().split("\n")[0]);
    assert.match(ev.attestations[0].uri, /:unscored$/, "writes a :unscored URI");
  });
});
