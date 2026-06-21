// Stage C — FIX 3 (STGB-SP-003): a single trust entry missing a score must NOT poison the
// headline "Avg Integrity / Avg Assurance" stat cards with NaN.
//
// The averaging lives in build-metrics.mjs (the dashboard sparklines/deltas/current snapshot)
// and is mirrored in build-stats.mjs (the landing-page stats). Both export a pure `averageScore`
// helper that this suite pins: it averages only numeric values, excludes missing/non-numeric
// ones, and returns 0 for an empty/all-missing set — never NaN.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { averageScore as avgMetrics } from "../build-metrics.mjs";
import { averageScore as avgStats } from "../build-stats.mjs";

for (const [name, averageScore] of [["build-metrics", avgMetrics], ["build-stats", avgStats]]) {
  describe(`FIX 3 (STGB-SP-003) — ${name} averageScore guards NaN`, () => {
    it("averages the present numeric scores", () => {
      const trust = [{ integrityScore: 100 }, { integrityScore: 40 }];
      assert.equal(averageScore(trust, "integrityScore"), 70);
    });

    it("excludes a missing (undefined) score instead of yielding NaN", () => {
      const trust = [{ integrityScore: 100 }, { /* no integrityScore */ }, { integrityScore: 50 }];
      const avg = averageScore(trust, "integrityScore");
      assert.ok(!Number.isNaN(avg), "result must not be NaN");
      assert.equal(avg, 75, "averages only the two present scores (100,50)");
    });

    it("excludes a null score", () => {
      const trust = [{ assuranceScore: 80 }, { assuranceScore: null }, { assuranceScore: 60 }];
      const avg = averageScore(trust, "assuranceScore");
      assert.ok(!Number.isNaN(avg));
      assert.equal(avg, 70);
    });

    it("excludes a non-numeric (string) score", () => {
      const trust = [{ integrityScore: 90 }, { integrityScore: "oops" }, { integrityScore: 30 }];
      const avg = averageScore(trust, "integrityScore");
      assert.ok(!Number.isNaN(avg));
      assert.equal(avg, 60);
    });

    it("returns 0 (not NaN) when every entry is missing the score", () => {
      const trust = [{}, { integrityScore: undefined }, { integrityScore: null }];
      assert.equal(averageScore(trust, "integrityScore"), 0);
    });

    it("returns 0 for an empty trust list", () => {
      assert.equal(averageScore([], "integrityScore"), 0);
    });

    it("tolerates a non-array argument (returns 0, no throw)", () => {
      assert.equal(averageScore(null, "integrityScore"), 0);
      assert.equal(averageScore(undefined, "assuranceScore"), 0);
    });
  });
}
