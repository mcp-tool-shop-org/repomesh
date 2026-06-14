// STGB-VER-002 (real bug) — osvQueryAll must TOLERATE a per-package failure: one transient OSV error
// must NOT abort the whole scan and throw away criticals already found in OTHER packages. Each
// package is queried in its own try/catch; failures are recorded in results.failures; if ANY package
// could not be scanned the overall security.scan result is 'unscored' (never a clean pass), while the
// criticals from the packages that DID scan are still surfaced.
//
// STGB-VER-001 — a wholesale OSV outage maps to 'unscored' (0 pts), not 'warn'.
//
// RED before fix: pre-fix osvQueryAll awaited each query unguarded, so a single rejection threw and
// the scan aborted; verify-security's catch returned { result: "warn" }.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { osvQueryAll, osvQueryAllWithStatus, OSV_QUERY_ENDPOINT, OSV_USER_AGENT } from "../lib/osv.mjs";

const CRITICAL_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H";

const QUERIES = [
  { package: { ecosystem: "npm", name: "alpha" }, version: "1.0.0" },
  { package: { ecosystem: "npm", name: "beta" }, version: "2.0.0" },
  { package: { ecosystem: "npm", name: "gamma" }, version: "3.0.0" },
];

describe("STGB-VER-002 osvQueryAll tolerates a per-package failure", () => {
  it("one failing package among several still returns the others' vulns + records the failure", async () => {
    // beta always rejects (transient); alpha carries a real critical; gamma is clean.
    const fetchImpl = async (_url, opts) => {
      const q = JSON.parse(opts.body);
      const name = q.package.name;
      if (name === "beta") throw new Error("ECONNRESET");
      if (name === "alpha") {
        return { ok: true, json: async () => ({ vulns: [{ id: "CVE-2021-44228", severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }] }] }) };
      }
      return { ok: true, json: async () => ({ vulns: [] }) };
    };

    const results = await osvQueryAll(QUERIES, { fetchImpl });
    // Alignment preserved 1:1 even though beta failed (SEC-010).
    assert.equal(results.length, 3, "results align 1:1 with queries despite a failure");

    // The critical from alpha survives the beta failure.
    const alpha = results.find(r => r.package === "alpha");
    assert.equal(alpha.vulns[0].id, "CVE-2021-44228", "alpha's critical must survive beta's failure");

    // beta is recorded as a failure, with empty vulns + an error string.
    const beta = results.find(r => r.package === "beta");
    assert.deepEqual(beta.vulns, [], "failed package has empty vulns");
    assert.match(String(beta.error), /ECONNRESET/, "failed package carries its error message");

    // The failures list surfaces beta.
    assert.equal(results.failures.length, 1, "exactly one package could not be scanned");
    assert.equal(results.failures[0].package, "beta");
  });

  it("osvQueryAllWithStatus exposes { results, failures } explicitly", async () => {
    const fetchImpl = async (_url, opts) => {
      const q = JSON.parse(opts.body);
      if (q.package.name === "beta") throw new Error("timeout");
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    const { results, failures } = await osvQueryAllWithStatus(QUERIES, { fetchImpl });
    assert.equal(results.length, 3);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].package, "beta");
  });

  it("a fully reachable scan reports zero failures", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ vulns: [] }) });
    const results = await osvQueryAll(QUERIES, { fetchImpl });
    assert.equal(results.failures.length, 0, "no failures on a clean scan");
  });
});

describe("STGB-VER-005 OSV endpoint + UA are pinned and sent", () => {
  it("exports a pinned endpoint constant and a User-Agent", () => {
    assert.equal(OSV_QUERY_ENDPOINT, "https://api.osv.dev/v1/query");
    assert.match(OSV_USER_AGENT, /repomesh-verifier/);
  });

  it("sends the pinned User-Agent header on the request", async () => {
    let sentUA = null;
    let sentUrl = null;
    const fetchImpl = async (url, opts) => {
      sentUrl = url;
      sentUA = opts.headers["user-agent"];
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    await osvQueryAll([QUERIES[0]], { fetchImpl });
    assert.equal(sentUrl, OSV_QUERY_ENDPOINT, "uses the pinned endpoint constant");
    assert.equal(sentUA, OSV_USER_AGENT, "sends the pinned User-Agent");
  });
});
