import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "..", "schemas", "event.schema.json");

describe("D6 / schema copy: optional sha256 on $defs.attestation", () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const att = schema.$defs.attestation;

  it("attestation defines an optional sha256 field", () => {
    assert.ok(att.properties.sha256, "sha256 property must exist");
    assert.equal(att.properties.sha256.type, "string");
    assert.ok(att.properties.sha256.pattern, "sha256 should have a 64-hex pattern");
    assert.equal(att.properties.sha256.pattern, "^[0-9a-f]{64}$");
  });

  it("sha256 is OPTIONAL (not in required)", () => {
    const required = att.required || [];
    assert.ok(!required.includes("sha256"), "sha256 must NOT be required");
  });

  it("attestation keeps additionalProperties:false", () => {
    assert.equal(att.additionalProperties, false);
  });
});
