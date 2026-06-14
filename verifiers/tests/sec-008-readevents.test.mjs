// SEC-008 — per-line JSON.parse must be wrapped in try/catch in BOTH
// verifiers/lib/common.mjs readEvents AND attestor/scripts/attest-release.mjs readEvents.
// A malformed line yields a STRUCTURED, line-numbered error (never a raw SyntaxError stack)
// and the corrupt ledger is rejected — not silently truncated.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readEvents } from "../lib/common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATTESTOR = path.join(HERE, "..", "..", "attestor", "scripts", "attest-release.mjs");

function tmpLedger(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-sec008-"));
  const p = path.join(dir, "events.jsonl");
  fs.writeFileSync(p, contents, "utf8");
  return { dir, p };
}

const GOOD_LINE = JSON.stringify({
  type: "ReleasePublished",
  repo: "test-org/test-repo",
  version: "1.0.0",
  commit: "a".repeat(40),
  timestamp: "2026-01-01T00:00:00.000Z",
  artifacts: [{ name: "x.js", sha256: "b".repeat(64), uri: "https://example.com/x.js" }],
  attestations: [],
  signature: { alg: "ed25519", keyId: "k", value: "x".repeat(40), canonicalHash: "f".repeat(64) },
});

describe("SEC-008 common.mjs readEvents", () => {
  it("throws a structured, line-numbered error on a malformed line (not a raw SyntaxError)", () => {
    const { p } = tmpLedger(GOOD_LINE + "\n" + "{not valid json" + "\n");
    let caught;
    try {
      readEvents(p);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "readEvents must throw on a malformed line, not silently drop it");
    assert.equal(caught.code, "REPOMESH_LEDGER_PARSE_ERROR", "error must carry a structured code");
    assert.equal(caught.lineNumber, 2, "error must name the offending line number");
    assert.match(caught.message, /:2:/, "message must include the line number");
  });

  it("parses a clean ledger and skips a trailing newline", () => {
    const { p } = tmpLedger(GOOD_LINE + "\n");
    const events = readEvents(p);
    assert.equal(events.length, 1);
    assert.equal(events[0].repo, "test-org/test-repo");
  });
});

describe("SEC-008 attestor readEvents", () => {
  function runAttestor(ledgerContents) {
    const { dir, p } = tmpLedger(ledgerContents);
    const res = spawnSync("node", [ATTESTOR, "--scan-new"], {
      env: { ...process.env, REPOMESH_LEDGER_PATH: p, REPOMESH_NODES_PATH: path.join(dir, "nodes") },
      encoding: "utf8",
    });
    return { code: res.status ?? 1, out: res.stdout || "", err: res.stderr || "" };
  }

  it("exits 1 with a structured line-numbered error on a malformed ledger line", () => {
    const r = runAttestor(GOOD_LINE + "\n" + "{broken" + "\n");
    assert.equal(r.code, 1, "attestor must exit non-zero on a corrupt ledger\n" + r.err);
    assert.match(r.err, /Malformed JSON in ledger/i, "must print a structured malformed-JSON error");
    assert.match(r.err, /:2:/, "must name the offending line number");
    assert.doesNotMatch(r.err, /SyntaxError[\s\S]*at .*node:internal/i, "must not leak a raw V8 stack");
  });

  it("processes a clean ledger without a parse error", () => {
    // No nodes dir => signature.chain fails, but the run must still complete (no parse crash).
    const r = runAttestor(GOOD_LINE + "\n");
    assert.doesNotMatch(r.err, /Malformed JSON in ledger/i, "clean ledger must not trigger a parse error");
    assert.notEqual(r.code, undefined);
  });
});
