// STGB-VER-001 (Mike's policy) — when the OSV scan cannot actually run (OSV unreachable/timeout, OR
// a per-package failure leaves some package unscanned), verify-security emits result 'unscored'
// (0 assurance, reported MISSING), NOT 'warn'. A transient outage must never inflate the score.
//
// STGB-VER-002 (real bug) — a partial scan still surfaces the criticals found in the packages that
// DID scan, while reporting overall 'unscored' (cannot certify).
//
// RED before fix: verify-security's OSV catch returned { result: "warn" } and a ":warn" URI.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { runOne as runSecurity } from "../security/scripts/verify-security.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIERS_ROOT = path.join(HERE, "..");

const REPO = "test-org/test-repo";
const VERSION = "1.0.0";
const CRITICAL_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H";

// Two queryable npm packages so we can fail one and scan the other.
const SBOM_OBJ = {
  bomFormat: "CycloneDX",
  components: [
    { name: "alpha", version: "1.0.0", purl: "pkg:npm/alpha@1.0.0", licenses: [{ license: { id: "MIT" } }] },
    { name: "beta", version: "2.0.0", purl: "pkg:npm/beta@2.0.0", licenses: [{ license: { id: "MIT" } }] },
  ],
};
const SBOM_BYTES = Buffer.from(JSON.stringify(SBOM_OBJ), "utf8");
const SBOM_SHA256 = crypto.createHash("sha256").update(SBOM_BYTES).digest("hex");

// Build a temp working dir with a ledger whose sbom attestation sha256 MATCHES the bytes we serve,
// so the digest binds and the scan reaches the OSV stage. `osvFetch` controls per-package behavior.
function withBoundLedger(osvFetch, fn) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-ver001-"));
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
    attestations: [{ type: "sbom", uri: "https://example.com/sbom.json", sha256: SBOM_SHA256 }],
  };
  fs.writeFileSync(path.join(ledgerDir, "events.jsonl"), JSON.stringify(releaseEvent) + "\n", "utf8");

  const origCwd = process.cwd();
  const origFetch = globalThis.fetch;
  // SBOM fetch returns the bound bytes; OSV POSTs are delegated to osvFetch.
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") return osvFetch(url, opts);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => SBOM_BYTES.buffer.slice(
        SBOM_BYTES.byteOffset, SBOM_BYTES.byteOffset + SBOM_BYTES.byteLength),
    };
  };
  process.chdir(baseDir);
  return Promise.resolve(fn()).finally(() => {
    process.chdir(origCwd);
    globalThis.fetch = origFetch;
  });
}

const LOW_VECTOR = "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N";

describe("STGB-VER-002 partial OSV scan -> unscored (would-be pass/warn downgraded)", () => {
  it("one package fails while the other would PASS -> result 'unscored' (no clean pass on a partial scan)", async () => {
    // alpha is clean (would be pass); beta always rejects (transient). The ONLY reason not to pass
    // is the unscanned package -> the doctrine requires 'unscored', never a pass.
    const osvFetch = async (_url, opts) => {
      const q = JSON.parse(opts.body);
      if (q.package.name === "beta") throw new Error("ECONNRESET");
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    await withBoundLedger(osvFetch, async () => {
      const r = await runSecurity({ repo: REPO, version: VERSION, sign: false, out: null });
      assert.equal(r.result, "unscored", "a partial scan cannot earn a clean pass -> unscored, not pass/warn");
      assert.ok(r.failures.some(f => f.package === "beta"), "the unscanned package is recorded in failures");
      assert.match(r.reason, /could not be scanned/i);
      assert.ok(r.hint, "an unscored partial scan carries a hint");
    });
  });

  it("one package fails while the other has only a LOW vuln (would WARN) -> 'unscored'", async () => {
    const osvFetch = async (_url, opts) => {
      const q = JSON.parse(opts.body);
      if (q.package.name === "beta") throw new Error("timeout");
      return { ok: true, json: async () => ({ vulns: [{ id: "CVE-low", severity: [{ type: "CVSS_V3", score: LOW_VECTOR }] }] }) };
    };
    await withBoundLedger(osvFetch, async () => {
      const r = await runSecurity({ repo: REPO, version: VERSION, sign: false, out: null });
      assert.equal(r.result, "unscored", "a would-be warn with an unscanned package is non-scoring");
    });
  });

  it("a critical found in a scanned package still reads as fail (danger not hidden) AND notes the unscanned package", async () => {
    // alpha critical (fails the gate), beta unscanned. A real fail must NOT be masked into unscored —
    // 'fail' is a stronger negative than 'unscored' and still honors "never a clean pass".
    const osvFetch = async (_url, opts) => {
      const q = JSON.parse(opts.body);
      if (q.package.name === "beta") throw new Error("timeout");
      return { ok: true, json: async () => ({ vulns: [{ id: "CVE-2021-44228", severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }] }] }) };
    };
    await withBoundLedger(osvFetch, async () => {
      const r = await runSecurity({ repo: REPO, version: VERSION, sign: false, out: null });
      assert.equal(r.result, "fail", "a real critical keeps the result 'fail' even with a partial scan");
      // The critical from the scanned package is surfaced...
      assert.ok(r.topCritical.some(s => /CVE-2021-44228/.test(s)), "criticals from the scanned package are surfaced");
      // ...and the unscanned package is still recorded so the operator knows the scan was incomplete.
      assert.ok(r.failures.some(f => f.package === "beta"), "the unscanned package is recorded even on a fail");
      assert.match(r.reason, /could not be scanned/i, "the fail reason notes the additional unscanned package");
    });
  });
});

describe("STGB-VER-001 wholesale OSV outage -> unscored", () => {
  it("every package fails (total outage) -> result 'unscored', :unscored URI", async () => {
    const osvFetch = async () => { throw new Error("ENOTFOUND api.osv.dev"); };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-ver001-out-"));
    const outPath = path.join(outDir, "security.jsonl");
    await withBoundLedger(osvFetch, async () => {
      const r = await runSecurity({ repo: REPO, version: VERSION, sign: false, out: outPath });
      assert.equal(r.result, "unscored", "a total OSV outage is non-scoring, not warn");
    });
    const ev = JSON.parse(fs.readFileSync(outPath, "utf8").trim().split("\n")[0]);
    assert.match(ev.attestations[0].uri, /:unscored$/, "outage writes a :unscored URI, not :warn");
  });
});
