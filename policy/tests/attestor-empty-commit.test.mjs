// The attestor cron must not fail when a counted "event" does not change the ledger.
// Live failure (2026-09): a warnings-only policy file was a single "\n", `wc -l` reported 1,
// the blank-line normalizer stripped it, and `git commit` exited 1 on a clean tree.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", ".github", "workflows", "attestor-ci.yml",
);

describe("attestor-ci empty-commit path", () => {
  const src = fs.readFileSync(WORKFLOW, "utf8");

  it("counts non-blank JSONL lines instead of raw wc -l", () => {
    assert.match(src, /count_jsonl\(\)/);
    assert.match(src, /grep -cve '\^\[\[:space:\]\]\*\$'/);
    assert.doesNotMatch(src, /wc -l </);
  });

  it("treats an unchanged ledger after normalize as a clean no-op", () => {
    assert.match(src, /git diff --cached --quiet/);
    assert.match(src, /nothing to append/);
  });

  it("treats policy exit 2 as findings written, not a verifier crash", () => {
    assert.match(src, /policy_status/);
    assert.match(src, /policy_status" -eq 2/);
  });
});
