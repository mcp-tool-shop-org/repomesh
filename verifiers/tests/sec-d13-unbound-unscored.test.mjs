// D13 (verifier half) — when an SBOM digest is missing/mismatched (digestStatus.bound===false),
// BOTH verify-security.mjs and verify-license.mjs must emit result 'unscored' (NOT 'warn') so the
// scorer awards 0 assurance points and the check is reported missing (SEC-002 honored across the
// layer boundary). The bound-digest pass/warn/fail behavior is unchanged.
//
// Pre-fix code returned { result: "warn" } and a ":warn" attestation URI on an unbound SBOM, which
// the scorer credited. These tests are RED on 'warn' and GREEN after the 'unscored' fix.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runOne as runSecurity } from "../security/scripts/verify-security.mjs";
import { runOne as runLicense } from "../license/scripts/verify-license.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIERS_ROOT = path.join(HERE, "..");

const REPO = "test-org/test-repo";
const VERSION = "1.0.0";

// A CycloneDX SBOM whose RAW bytes will NOT match the committed sha256 we put on the release event,
// so digestStatus.bound === false (reason: mismatch).
const SBOM_BYTES = Buffer.from(JSON.stringify({
  bomFormat: "CycloneDX",
  components: [
    { name: "left-pad", version: "1.0.0", purl: "pkg:npm/left-pad@1.0.0", licenses: [{ license: { id: "MIT" } }] },
  ],
}), "utf8");

// A wrong (tampered) digest the publisher supposedly committed — does not match SBOM_BYTES.
const TAMPERED_SHA256 = "0".repeat(64);

// Build a temp working dir containing a ledger with one ReleasePublished carrying an sbom
// attestation whose committed sha256 is the tampered value, then cwd into it for the run.
function withTamperedLedger(fn) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-d13-"));
  const ledgerDir = path.join(baseDir, "ledger", "events");
  fs.mkdirSync(ledgerDir, { recursive: true });

  // Seed the verifier config.json files the runners load via process.cwd() (the license verifier
  // loads its config BEFORE the digest gate, so it must be present even on the unbound path).
  for (const which of ["security", "license"]) {
    const dst = path.join(baseDir, "verifiers", which);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(
      path.join(VERIFIERS_ROOT, which, "config.json"),
      path.join(dst, "config.json")
    );
  }
  const releaseEvent = {
    type: "ReleasePublished",
    repo: REPO,
    version: VERSION,
    commit: "abc123",
    artifacts: [{ name: "pkg.tgz", sha256: "deadbeef" }],
    attestations: [
      { type: "sbom", uri: "https://example.com/sbom.json", sha256: TAMPERED_SHA256 },
    ],
  };
  fs.writeFileSync(path.join(ledgerDir, "events.jsonl"), JSON.stringify(releaseEvent) + "\n", "utf8");

  const origCwd = process.cwd();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => SBOM_BYTES.buffer.slice(
      SBOM_BYTES.byteOffset, SBOM_BYTES.byteOffset + SBOM_BYTES.byteLength),
  });
  process.chdir(baseDir);
  return Promise.resolve(fn()).finally(() => {
    process.chdir(origCwd);
    globalThis.fetch = origFetch;
  });
}

describe("D13 unbound/tampered SBOM -> 'unscored' (verify-security.mjs)", () => {
  it("a mismatched SBOM digest yields result 'unscored', NOT 'warn'", async () => {
    await withTamperedLedger(async () => {
      const r = await runSecurity({ repo: REPO, version: VERSION, sign: false, out: null });
      assert.equal(r.result, "unscored", "tampered SBOM must be non-scoring, not warn");
    });
  });
});

describe("D13 unbound/tampered SBOM -> 'unscored' (verify-license.mjs)", () => {
  it("a mismatched SBOM digest yields result 'unscored', NOT 'warn'", async () => {
    await withTamperedLedger(async () => {
      const r = await runLicense({ repo: REPO, version: VERSION, sign: false, out: null });
      assert.equal(r.result, "unscored", "tampered SBOM must be non-scoring, not warn");
    });
  });
});

describe("D13 unbound attestation URI carries the 'unscored' token", () => {
  it("security writes a :unscored attestation, not :warn", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-d13-out-"));
    const outPath = path.join(outDir, "security.jsonl");
    await withTamperedLedger(async () => {
      await runSecurity({ repo: REPO, version: VERSION, sign: false, out: outPath });
    });
    const line = fs.readFileSync(outPath, "utf8").trim().split("\n")[0];
    const ev = JSON.parse(line);
    const uri = ev.attestations[0].uri;
    assert.match(uri, /:unscored$/, `expected :unscored URI, got ${uri}`);
  });

  it("license writes a :unscored attestation, not :warn", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-d13-out-"));
    const outPath = path.join(outDir, "license.jsonl");
    await withTamperedLedger(async () => {
      await runLicense({ repo: REPO, version: VERSION, sign: false, out: outPath });
    });
    const line = fs.readFileSync(outPath, "utf8").trim().split("\n")[0];
    const ev = JSON.parse(line);
    const uri = ev.attestations[0].uri;
    assert.match(uri, /:unscored$/, `expected :unscored URI, got ${uri}`);
  });
});
