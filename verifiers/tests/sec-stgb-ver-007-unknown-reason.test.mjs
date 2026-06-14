// STGB-VER-007 — when a vuln buckets to "unknown", the operator must get a DECODABLE reason naming
// the raw severity string we could not parse (or noting its absence), not just an opaque "unknown".
// severityBucketWithReason() returns { bucket, reason }; scoreVulns rolls these up into
// `unknownReasons` so the attestation notes explain WHY a vuln was treated as unscored/failing.
//
// N/A for RED on a pre-existing test: this is a NEW surface (reason strings). It is verified GREEN.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { severityBucketWithReason } from "../lib/osv.mjs";
import { scoreVulns, failSeveritiesFromThreshold } from "../security/scripts/verify-security.mjs";

describe("STGB-VER-007 severityBucketWithReason names the undecodable severity", () => {
  it("a decodable critical vuln has bucket=critical and reason=null", () => {
    const v = { id: "CVE-1", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" }] };
    const out = severityBucketWithReason(v);
    assert.equal(out.bucket, "critical");
    assert.equal(out.reason, null);
  });

  it("an undecodable CVSS vector reports the raw string it could not parse", () => {
    const v = { id: "CVE-2", severity: [{ type: "CVSS_V3", score: "GARBAGE-NOT-A-VECTOR" }] };
    const out = severityBucketWithReason(v);
    assert.equal(out.bucket, "unknown");
    assert.match(out.reason, /could not decode/i);
    assert.match(out.reason, /GARBAGE-NOT-A-VECTOR/, "the raw unparseable score must appear in the reason");
  });

  it("an unrecognized database_specific.severity word is named", () => {
    const v = { id: "CVE-3", database_specific: { severity: "SPICY" } };
    const out = severityBucketWithReason(v);
    assert.equal(out.bucket, "unknown");
    assert.match(out.reason, /SPICY/, "the unrecognized severity word must appear in the reason");
  });

  it("a vuln with no severity info at all reports absence", () => {
    const v = { id: "CVE-4" };
    const out = severityBucketWithReason(v);
    assert.equal(out.bucket, "unknown");
    assert.match(out.reason, /no severity/i);
  });
});

describe("STGB-VER-007 scoreVulns surfaces unknownReasons", () => {
  it("collects a decodable reason per unknown vuln", () => {
    const failSeverities = failSeveritiesFromThreshold("moderate");
    const results = [
      { package: "mystery", vulns: [{ id: "CVE-X", severity: [{ type: "CVSS_V3", score: "not-a-vector" }] }] },
    ];
    const out = scoreVulns(results, { ignoreIds: new Set(), failSeverities });
    assert.equal(out.counts.unknown, 1);
    assert.equal(out.result, "fail", "unknown still fails by default (SEC-001 unchanged)");
    assert.equal(out.unknownReasons.length, 1);
    assert.match(out.unknownReasons[0], /CVE-X in mystery/);
    assert.match(out.unknownReasons[0], /not-a-vector/, "the raw unparseable severity is decodable from the reason");
  });
});
