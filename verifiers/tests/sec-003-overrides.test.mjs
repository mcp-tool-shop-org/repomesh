// SEC-003 — repomesh.overrides.json must validate against its schema at load; reject on failure.
// The bare-string ignoreVulns branch is GONE — entries must be {id, justification(minLen 10)}.
// List size is capped. A path-traversal repo id is rejected.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadValidatedOverrides,
  OverridesValidationError,
  MAX_IGNORE_VULNS,
} from "../lib/load-overrides.mjs";

// Build a temp nodes tree with an overrides file for org/repo.
function withOverrides(repo, contents) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-sec003-"));
  const [org, repoName] = repo.split("/");
  const dir = path.join(baseDir, org, repoName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "repomesh.overrides.json"),
    typeof contents === "string" ? contents : JSON.stringify(contents),
    "utf8"
  );
  return baseDir;
}

const REPO = "test-org/test-repo";

describe("SEC-003 overrides schema validation at load", () => {
  it("returns null when no overrides file exists", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-sec003-none-"));
    assert.equal(loadValidatedOverrides(REPO, { baseDir }), null);
  });

  it("accepts a valid object-form ignoreVulns entry", () => {
    const baseDir = withOverrides(REPO, {
      security: { ignoreVulns: [{ id: "CVE-2021-44228", justification: "Not reachable in our build path." }] },
    });
    const data = loadValidatedOverrides(REPO, { baseDir });
    assert.equal(data.security.ignoreVulns[0].id, "CVE-2021-44228");
  });

  it("REJECTS a bare-string ignoreVulns entry (string branch dropped)", () => {
    const baseDir = withOverrides(REPO, { security: { ignoreVulns: ["CVE-2021-44228"] } });
    assert.throws(
      () => loadValidatedOverrides(REPO, { baseDir }),
      (e) => e instanceof OverridesValidationError && e.code === "REPOMESH_OVERRIDES_INVALID"
    );
  });

  it("REJECTS an ignoreVulns entry with no justification", () => {
    const baseDir = withOverrides(REPO, { security: { ignoreVulns: [{ id: "CVE-2021-44228" }] } });
    assert.throws(() => loadValidatedOverrides(REPO, { baseDir }), OverridesValidationError);
  });

  it("REJECTS a too-short justification (minLength 10)", () => {
    const baseDir = withOverrides(REPO, { security: { ignoreVulns: [{ id: "CVE-1", justification: "short" }] } });
    assert.throws(() => loadValidatedOverrides(REPO, { baseDir }), OverridesValidationError);
  });

  it("REJECTS unknown top-level keys (additionalProperties:false)", () => {
    const baseDir = withOverrides(REPO, { evilKey: true });
    assert.throws(() => loadValidatedOverrides(REPO, { baseDir }), OverridesValidationError);
  });

  it("REJECTS malformed JSON (not silently swallowed to null)", () => {
    const baseDir = withOverrides(REPO, "{ this is not json");
    assert.throws(() => loadValidatedOverrides(REPO, { baseDir }), OverridesValidationError);
  });

  it("REJECTS an ignoreVulns list that exceeds the size cap", () => {
    const big = Array.from({ length: MAX_IGNORE_VULNS + 1 }, (_, i) => ({
      id: `CVE-${i}`, justification: "padded justification text",
    }));
    const baseDir = withOverrides(REPO, { security: { ignoreVulns: big } });
    assert.throws(() => loadValidatedOverrides(REPO, { baseDir }), /exceeds cap/);
  });

  it("REJECTS a path-traversal repo id", () => {
    assert.throws(() => loadValidatedOverrides("../../etc/passwd"), OverridesValidationError);
  });
});
