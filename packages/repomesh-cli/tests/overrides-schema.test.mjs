import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgSchemaPath = resolve(__dirname, "..", "schemas", "repomesh.overrides.schema.json");
const rootSchemaPath = resolve(__dirname, "..", "..", "..", "schemas", "repomesh.overrides.schema.json");

// FIX 2: security.failOnSeverities:[] (empty array) silently downgrades the gate to only
// 'unknown' because the verifier ternary treats a present (even empty) array as a full
// replacement of the threshold-derived fail set. The schema floor (minItems:1) rejects the
// empty array at validation time. RED on the old schema (no minItems), GREEN after.
describe("FIX 2 / overrides schema: failOnSeverities has a non-empty floor", () => {
  const pkgSchema = JSON.parse(fs.readFileSync(pkgSchemaPath, "utf8"));
  const fos = pkgSchema.properties.security.properties.failOnSeverities;

  it("failOnSeverities enforces minItems:1 (rejects the self-downgrade empty array)", () => {
    assert.equal(fos.minItems, 1, "an empty failOnSeverities array must be rejected to prevent self-downgrade");
  });

  it("failOnSeverities still restricts items to the known severity enum", () => {
    assert.deepEqual(fos.items.enum, ["critical", "high", "moderate", "low"]);
  });

  it("the footgun is documented in the field description", () => {
    assert.match(fos.description, /downgrade/i);
  });

  it("the root schema copy stays byte-identical to the packages copy", () => {
    const rootSchema = JSON.parse(fs.readFileSync(rootSchemaPath, "utf8"));
    assert.deepEqual(rootSchema, pkgSchema, "the two overrides schema copies must not drift");
  });
});

// D14 (packages-schema half): a repo-level repomesh.overrides.json must NOT be able to RAISE the
// value of a failing bucket. scoring.assuranceWeights.*.fail is clamped at the schema layer to
// max 0 (raising fail is profile/governance-ONLY — REG-002 + CRITICAL #2). Mirrors the root schema
// floor the anchor-schema agent applies. RED on the old schema (fail max:100), GREEN after.
describe("D14 / overrides schema: assuranceWeights.fail has a strictness floor (max 0)", () => {
  const pkgSchema = JSON.parse(fs.readFileSync(pkgSchemaPath, "utf8"));
  const failProp = pkgSchema.properties.scoring.properties.assuranceWeights
    .additionalProperties.properties.fail;

  it("assuranceWeights.*.fail is capped at maximum 0 (a repo cannot raise a failing bucket)", () => {
    assert.equal(failProp.maximum, 0, "scoring.assuranceWeights.*.fail must be clamped to max 0");
  });

  it("assuranceWeights.*.fail keeps minimum 0 (no negative weights either)", () => {
    assert.equal(failProp.minimum, 0, "fail weight floor stays at 0");
  });

  it("the floor is documented in the field (raising fail is profile/governance-only)", () => {
    assert.match(failProp.description || "", /profile|governance|cannot|raise/i,
      "the fail-bucket floor must be documented");
  });
});
