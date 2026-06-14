// SEC-001 — OSV severity must be decoded so a critical CVE produces result==='fail'.
// SEC-010 — OSV results align 1:1 with queries and carry package names.
// SEC-007 — ignoreVulns matches against the {id, ...aliases} union.
//
// The pre-fix code used /v1/querybatch (no severity), Number(vector) which is always NaN -> "unknown",
// "unknown" never in failSeverities, so security.scan could NEVER fail. These tests probe the pure
// decoding + scoring functions plus osvQueryAll against a mock fetch.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cvss3BaseScore,
  cvss2BaseScore,
  severityBucket,
  scoreToBucket,
  vulnIdentifiers,
  isIgnored,
  osvQueryAll,
} from "../lib/osv.mjs";
import { scoreVulns, failSeveritiesFromThreshold } from "../security/scripts/verify-security.mjs";

// A real critical CVSS:3.1 vector (Log4Shell, CVE-2021-44228 = 10.0).
const CRITICAL_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H";
// A high vector (~7.5).
const HIGH_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H";
// A low vector (~3.7).
const LOW_VECTOR = "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N";

describe("SEC-001 CVSS vector decoding", () => {
  it("decodes a critical CVSS:3.1 vector to >= 9.0", () => {
    const score = cvss3BaseScore(CRITICAL_VECTOR);
    assert.ok(score >= 9.0, `expected critical score, got ${score}`);
    assert.equal(scoreToBucket(score), "critical");
  });

  it("decodes a high vector to the 7-9 band", () => {
    const score = cvss3BaseScore(HIGH_VECTOR);
    assert.ok(score >= 7.0 && score < 9.0, `expected high score, got ${score}`);
    assert.equal(scoreToBucket(score), "high");
  });

  it("decodes a low vector to the <4 band", () => {
    const score = cvss3BaseScore(LOW_VECTOR);
    assert.ok(score > 0 && score < 4.0, `expected low score, got ${score}`);
    assert.equal(scoreToBucket(score), "low");
  });

  it("NEVER uses Number(vector) — a vector string is not a number", () => {
    assert.ok(Number.isNaN(Number(CRITICAL_VECTOR)), "vector strings are NaN under Number()");
    // The decoder must still produce a real score (proving it parses the vector, not Number()s it).
    assert.ok(typeof cvss3BaseScore(CRITICAL_VECTOR) === "number");
  });

  it("returns null on an undecodable vector (caller treats as unknown)", () => {
    assert.equal(cvss3BaseScore("garbage"), null);
  });

  it("decodes a CVSS v2 vector best-effort", () => {
    // AV:N/AC:L/Au:N/C:C/I:C/A:C is the v2 worst case (~10.0).
    const s = cvss2BaseScore("AV:N/AC:L/Au:N/C:C/I:C/A:C");
    assert.ok(s >= 9.0, `expected high v2 score, got ${s}`);
  });
});

describe("SEC-001 severityBucket from full vuln objects", () => {
  it("buckets a CVSS_V3 severity entry as critical", () => {
    const v = { id: "CVE-2021-44228", severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }] };
    assert.equal(severityBucket(v), "critical");
  });

  it("falls back to database_specific.severity word", () => {
    const v = { id: "GHSA-xxxx", database_specific: { severity: "HIGH" } };
    assert.equal(severityBucket(v), "high");
  });

  it("returns unknown when no severity info is present", () => {
    const v = { id: "CVE-0000-0000" };
    assert.equal(severityBucket(v), "unknown");
  });
});

describe("SEC-001 scoreVulns — REGRESSION: a known critical CVE yields fail", () => {
  const failSeverities = failSeveritiesFromThreshold("moderate");

  it("a single critical CVE -> result === 'fail'", () => {
    const results = [
      { package: "log4j-core", vulns: [{ id: "CVE-2021-44228", severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }] }] },
    ];
    const out = scoreVulns(results, { ignoreIds: new Set(), failSeverities });
    assert.equal(out.result, "fail", "a critical CVE must fail security.scan");
    assert.equal(out.counts.critical, 1);
    assert.match(out.topCritical[0], /CVE-2021-44228/);
    assert.match(out.topCritical[0], /log4j-core/, "topCritical must name the affected package (SEC-010)");
  });

  it("an unscored/unknown vuln is treated as FAILING (not silently passed)", () => {
    const results = [{ package: "mystery", vulns: [{ id: "CVE-0000-0001" }] }];
    const out = scoreVulns(results, { ignoreIds: new Set(), failSeverities });
    assert.equal(out.counts.unknown, 1);
    assert.equal(out.result, "fail", "an unscored vuln must not earn a pass");
  });

  it("a clean scan with no vulns -> result === 'pass'", () => {
    const results = [{ package: "left-pad", vulns: [] }];
    const out = scoreVulns(results, { ignoreIds: new Set(), failSeverities });
    assert.equal(out.result, "pass");
  });

  it("only low/moderate vulns -> result === 'warn'", () => {
    const results = [{ package: "x", vulns: [{ id: "CVE-low", severity: [{ type: "CVSS_V3", score: LOW_VECTOR }] }] }];
    const out = scoreVulns(results, { ignoreIds: new Set(), failSeverities });
    assert.equal(out.result, "warn");
  });
});

describe("SEC-007 ignoreVulns matches the {id, aliases} union", () => {
  const failSeverities = failSeveritiesFromThreshold("moderate");

  it("ignoring by an ALIAS (CVE) suppresses a GHSA-id'd vuln", () => {
    const vuln = {
      id: "GHSA-aaaa-bbbb-cccc",
      aliases: ["CVE-2021-44228"],
      severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }],
    };
    assert.ok(vulnIdentifiers(vuln).has("CVE-2021-44228"));
    // ignore by the CVE alias even though the primary id is the GHSA
    assert.ok(isIgnored(vuln, new Set(["CVE-2021-44228"])));
    const results = [{ package: "log4j-core", vulns: [vuln] }];
    const out = scoreVulns(results, { ignoreIds: new Set(["CVE-2021-44228"]), failSeverities });
    assert.equal(out.result, "pass", "ignoring by alias must suppress the vuln entirely");
  });

  it("does NOT ignore an unrelated id", () => {
    const vuln = { id: "GHSA-xyz", aliases: ["CVE-2020-1111"], severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }] };
    assert.equal(isIgnored(vuln, new Set(["CVE-9999-9999"])), false);
  });
});

describe("SEC-010 osvQueryAll alignment + package tagging", () => {
  it("returns results 1:1 with queries, each tagged with its package name", async () => {
    const calls = [];
    const fetchImpl = async (_url, opts) => {
      const q = JSON.parse(opts.body);
      calls.push(q.package.name);
      return { ok: true, json: async () => ({ vulns: [{ id: `vuln-for-${q.package.name}` }] }) };
    };
    const queries = [
      { package: { ecosystem: "npm", name: "alpha" }, version: "1.0.0" },
      { package: { ecosystem: "npm", name: "beta" }, version: "2.0.0" },
    ];
    const results = await osvQueryAll(queries, { fetchImpl });
    assert.equal(results.length, queries.length, "results must align 1:1 with queries");
    assert.equal(results[0].package, "alpha");
    assert.equal(results[1].package, "beta");
    assert.equal(results[0].vulns[0].id, "vuln-for-alpha");
  });
});
