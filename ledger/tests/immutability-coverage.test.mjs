// RepoMesh Ledger — immutability COVERAGE regression suite (LEDGER-A-001 / LEDGER-A-002 / LEDGER-A-008).
//
// The 2026-06-20 dogfood swarm found that committed Merkle manifests pinned only the first 8 of 47
// ledger events (the genesis partition), and validate-ledger SKIPPED v2 manifests entirely — so a
// reorder/truncation of any post-genesis event passed `npm run validate:ledger` with exit 0. This
// suite is the regression guard:
//   - the committed all.json manifest must cover the ENTIRE live ledger (drift guard);
//   - validate-ledger must verify v2 manifests (not skip them);
//   - a truncation or reorder of a post-genesis event must FAIL validate-ledger.
//
// These run validate-ledger as a child process against tampered COPIES via HEAD_LEDGER — the real
// ledger file is never mutated.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(LEDGER_DIR, "..");
const VALIDATOR = path.join(LEDGER_DIR, "scripts", "validate-ledger.mjs");
const REAL_LEDGER = path.join(LEDGER_DIR, "events", "events.jsonl");
const ALL_MANIFEST = path.join(REPO_ROOT, "anchor", "xrpl", "manifests", "all.json");

function readEvents(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
}

function runValidator(headLedgerPath) {
  const res = spawnSync(process.execPath, [VALIDATOR], {
    env: { ...process.env, HEAD_LEDGER: headLedgerPath, BASE_LEDGER: "" },
    encoding: "utf8",
  });
  return { code: res.status, out: (res.stdout || "") + (res.stderr || "") };
}

function withTemp(name, contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-ledger-"));
  try {
    const p = path.join(dir, name);
    fs.writeFileSync(p, contents);
    return fn(p);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("ledger immutability COVERAGE (LEDGER-A-001/002/008)", () => {
  it("the committed all.json manifest covers the ENTIRE live ledger (drift guard)", () => {
    const events = readEvents(REAL_LEDGER);
    const manifest = JSON.parse(fs.readFileSync(ALL_MANIFEST, "utf8"));
    assert.equal(
      manifest.count,
      events.length,
      `all.json pins count=${manifest.count} but the ledger has ${events.length} events. ` +
        `Re-run: node anchor/xrpl/scripts/compute-root.mjs --all (then re-anchor). ` +
        `A stale manifest re-opens LEDGER-A-001 (post-manifest events become unverifiable locally).`
    );
    assert.equal(manifest.algo, "sha256-merkle-v2", "all.json must be the RFC-6962 v2 algorithm");
  });

  it("the clean ledger PASSES validate-ledger (sanity)", () => {
    const { code } = runValidator(REAL_LEDGER);
    assert.equal(code, 0, "the unmodified ledger must validate clean");
  });

  it("TRUNCATION of the last event is caught (exit != 0)", () => {
    const events = readEvents(REAL_LEDGER);
    const truncated = events.slice(0, -1).join("\n") + "\n";
    withTemp("truncated.jsonl", truncated, (p) => {
      const { code, out } = runValidator(p);
      assert.notEqual(code, 0, "dropping the last event must FAIL validate-ledger");
      assert.match(out, /Immutability violation/, "must report an immutability violation");
    });
  });

  it("REORDER of two post-genesis events is caught (exit != 0)", () => {
    const events = readEvents(REAL_LEDGER);
    assert.ok(events.length > 21, "fixture assumes the live ledger has >21 events");
    const reordered = [...events];
    const t = reordered[19];
    reordered[19] = reordered[20];
    reordered[20] = t; // swap events 20<->21 (well past the genesis-8 partition)
    withTemp("reordered.jsonl", reordered.join("\n") + "\n", (p) => {
      const { code, out } = runValidator(p);
      assert.notEqual(code, 0, "reordering post-genesis events must FAIL validate-ledger");
      assert.match(out, /Immutability violation/, "must report an immutability violation");
    });
  });
});
