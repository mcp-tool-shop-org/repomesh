// D15 (HIGH #4) — failOnSeverities UNIONS with the floor {critical, high, unknown}.
// A repo-supplied `failOnSeverities` may ADD severities to the fail set but must NEVER remove the
// threshold-derived floor (which always includes critical+high) or 'unknown'.
//
// Pre-fix code REPLACED the threshold floor with `new Set([...failOnSeverities, 'unknown'])`, so
// a repo could set failOnSeverities:['low'] and a critical CVE would NO LONGER fail. These tests
// are RED on the replace-logic and GREEN after the union fix.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeFailSeverities,
  failSeveritiesFromThreshold,
  scoreVulns,
} from "../security/scripts/verify-security.mjs";

const CRITICAL_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H";

describe("D15 failOnSeverities UNIONS with the {critical, high, unknown} floor", () => {
  it("a repo override of ['low'] still includes critical, high, and unknown", () => {
    const fs = computeFailSeverities("moderate", { failOnSeverities: ["low"] });
    assert.ok(fs.has("critical"), "critical can never be removed by a repo override");
    assert.ok(fs.has("high"), "high can never be removed by a repo override");
    assert.ok(fs.has("unknown"), "unknown is always in the floor (SEC-001)");
    assert.ok(fs.has("low"), "the override ADDS low to the set");
  });

  it("REGRESSION: failOnSeverities:['low'] still FAILS a critical CVE", () => {
    const failSeverities = computeFailSeverities("moderate", { failOnSeverities: ["low"] });
    const results = [
      { package: "log4j-core", vulns: [{ id: "CVE-2021-44228", severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }] }] },
    ];
    const out = scoreVulns(results, { ignoreIds: new Set(), failSeverities });
    assert.equal(out.result, "fail", "a critical CVE must fail even when the repo override only lists 'low'");
    assert.equal(out.counts.critical, 1);
  });

  it("no override falls back to the threshold-derived floor", () => {
    const fs = computeFailSeverities("moderate", null);
    const expected = failSeveritiesFromThreshold("moderate");
    assert.deepEqual([...fs].sort(), [...expected].sort());
  });

  it("no override with no overrides object still includes critical+high+unknown", () => {
    const fs = computeFailSeverities("high", undefined);
    assert.ok(fs.has("critical"));
    assert.ok(fs.has("high"));
    assert.ok(fs.has("unknown"));
  });

  it("an empty failOnSeverities array does not strip the floor", () => {
    const fs = computeFailSeverities("moderate", { failOnSeverities: [] });
    assert.ok(fs.has("critical"));
    assert.ok(fs.has("high"));
    assert.ok(fs.has("unknown"));
  });

  it("the override is a strict superset of the threshold floor (union, not replace)", () => {
    const floor = failSeveritiesFromThreshold("moderate");
    const withOverride = computeFailSeverities("moderate", { failOnSeverities: ["low"] });
    for (const sev of floor) {
      assert.ok(withOverride.has(sev), `union must retain floor severity '${sev}'`);
    }
  });
});
