// Anchor + root-schema domain — Stage A fix-up WAVE 2: D14 (root-schema half, CRITICAL #2).
//
// A repo-level repomesh.overrides.json MUST NOT be able to RAISE a failing bucket. The ROOT
// schema copy (schemas/repomesh.overrides.schema.json) clamps scoring.assuranceWeights.*.fail
// to max 0, mirroring EXACTLY the floor the CLI agent applies to the packages schema copy
// (packages/repomesh-cli/schemas/...). The two copies must not drift.
//
// RED on the old root schema (fail max:100). GREEN after the floor + matching description land.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const rootSchemaPath = resolve(ROOT, "schemas", "repomesh.overrides.schema.json");
const pkgSchemaPath = resolve(ROOT, "packages", "repomesh-cli", "schemas", "repomesh.overrides.schema.json");

describe("D14 / root overrides schema: assuranceWeights.fail floor (max 0)", () => {
  const rootSchema = JSON.parse(fs.readFileSync(rootSchemaPath, "utf8"));
  const failProp = rootSchema.properties.scoring.properties.assuranceWeights
    .additionalProperties.properties.fail;

  it("assuranceWeights.*.fail is capped at maximum 0 (a repo cannot raise a failing bucket)", () => {
    assert.equal(failProp.maximum, 0, "scoring.assuranceWeights.*.fail must be clamped to max 0");
  });

  it("assuranceWeights.*.fail keeps minimum 0 (no negative weights either)", () => {
    assert.equal(failProp.minimum, 0, "fail weight floor stays at 0");
  });

  it("the floor is documented (raising fail is profile/governance-only; warn ≤ default)", () => {
    assert.match(failProp.description || "", /profile|governance|cannot|raise/i,
      "the fail-bucket floor must be documented");
    assert.match(failProp.description || "", /warn/i,
      "the warn ≤ default constraint must be documented");
  });
});

describe("D14 / root overrides schema: stays byte-identical to the packages copy", () => {
  it("the root schema copy deep-equals the packages copy (no drift)", () => {
    const rootSchema = JSON.parse(fs.readFileSync(rootSchemaPath, "utf8"));
    const pkgSchema = JSON.parse(fs.readFileSync(pkgSchemaPath, "utf8"));
    assert.deepEqual(rootSchema, pkgSchema, "the two overrides schema copies must not drift");
  });
});
