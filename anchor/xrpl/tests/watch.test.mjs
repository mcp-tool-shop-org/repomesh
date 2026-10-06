import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { watchDiff, normalizeReleaseTag } from "../scripts/watch.mjs";

const baseline = {
  rippledLatest: "3.4.0",
  warnFloor: "3.4.0",
  batchEnabled: false,
  sponsorEnabled: false,
};

describe("xrpl watch diff", () => {
  it("strips a leading v from a release tag", () => {
    assert.equal(normalizeReleaseTag("v3.4.0"), "3.4.0");
  });

  it("is quiet when the live surface matches the baseline", () => {
    const diff = watchDiff(baseline, {
      rippledLatest: "3.4.0",
      batchEnabled: false,
      sponsorEnabled: false,
      buildVersion: "3.4.0",
    });
    assert.deepEqual(diff.reasons, []);
    assert.equal(diff.buildWarning, null);
  });

  it("reports a new rippled release and an enabled amendment", () => {
    const diff = watchDiff(baseline, {
      rippledLatest: "3.5.0",
      batchEnabled: true,
      sponsorEnabled: false,
      buildVersion: "3.3.0",
    });
    assert.equal(diff.reasons.length, 2);
    assert.match(diff.buildWarning, /below the RepoMesh floor/);
  });
});
