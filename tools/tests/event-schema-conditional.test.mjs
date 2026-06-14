// Regression tests for the key-lifecycle conditional event envelope (contract §3.2).
//
// TEST-FIRST: these assert the type-dispatched required-set:
//   - release-family events keep TODAY's full required set (version/commit/artifacts/attestations);
//   - KeyRotation/KeyRevocation require a `key` object and do NOT require version/commit/artifacts;
//   - both event.schema.json copies (root + CLI mirror) are byte-identical.
//
// They FAIL on the pre-fix schema (no KeyRotation/KeyRevocation enum, single static `required`)
// and PASS once schemas/event.schema.json carries the allOf conditionals.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js");
const addFormats = require("ajv-formats");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const ROOT_EVENT_SCHEMA = path.join(REPO_ROOT, "schemas", "event.schema.json");
const CLI_EVENT_SCHEMA = path.join(
  REPO_ROOT,
  "packages",
  "repomesh-cli",
  "schemas",
  "event.schema.json"
);

const eventSchema = JSON.parse(fs.readFileSync(ROOT_EVENT_SCHEMA, "utf8"));

function makeValidator() {
  // Mirror validate-ledger.mjs + tools.test.mjs ajv config exactly.
  const ajv = new (Ajv2020.default || Ajv2020)({ allErrors: true, strict: false });
  (addFormats.default || addFormats)(ajv);
  const validate = ajv.compile(eventSchema);
  return (ev) => ({ ok: validate(ev), errors: validate.errors });
}

const validate = makeValidator();

// A real release-family event lifted from the live ledger (events.jsonl line 1 shape).
function releasePublished(overrides = {}) {
  return {
    type: "ReleasePublished",
    repo: "mcp-tool-shop-org/shipcheck",
    version: "1.0.3",
    commit: "c6267db5d44706b4ab2294c2b343a6f1bc40c09c",
    timestamp: "2026-02-28T04:31:26.173Z",
    artifacts: [
      {
        name: "shipcheck.mjs",
        sha256: "91859b3c8741df50339fab07d5a3ed9b31a2081c76b62cac8c08978e54a9ffe7",
        uri: "https://github.com/mcp-tool-shop-org/shipcheck/releases/tag/v1.0.3",
      },
    ],
    attestations: [],
    signature: {
      alg: "ed25519",
      keyId: "ci-shipcheck-2026",
      value: "7IO3YgGJxUHvs+o53tbrmpplRGBQeErpxA6MaRgo07sU0YEytLIBOiD4YxJZhJ0FHTVNhWGiAY3pMlse2Jm9CQ==",
      canonicalHash: "c29e3f557b4900c77b47c43012ebb4e9e6f5531746afbd748338cc45f2b5c9e6",
    },
    ...overrides,
  };
}

function keyRotation(overrides = {}) {
  return {
    type: "KeyRotation",
    repo: "mcp-tool-shop-org/foo",
    timestamp: "2026-06-14T12:00:00Z",
    key: {
      action: "rotate",
      retiringKeyId: "mike-2026-01",
      newKeyId: "mike-2026-06",
      newPublicKey:
        "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH=\n-----END PUBLIC KEY-----",
      effectiveAt: "2026-06-14T12:00:00Z",
    },
    signature: {
      alg: "ed25519",
      keyId: "mike-2026-01",
      value: "7IO3YgGJxUHvs+o53tbrmpplRGBQeErpxA6MaRgo07sU0YEytLIBOiD4YxJZhJ0FHTVNhWGiAY3pMlse2Jm9CQ==",
      canonicalHash: "c29e3f557b4900c77b47c43012ebb4e9e6f5531746afbd748338cc45f2b5c9e6",
    },
    ...overrides,
  };
}

function keyRevocation(overrides = {}) {
  return {
    type: "KeyRevocation",
    repo: "mcp-tool-shop-org/foo",
    timestamp: "2026-06-20T09:00:00Z",
    key: {
      action: "revoke",
      revokedKeyId: "mike-2026-01",
      reason: "compromise",
      invalidAfter: "2026-06-18T00:00:00Z",
    },
    signature: {
      alg: "ed25519",
      keyId: "mike-2026-06",
      value: "7IO3YgGJxUHvs+o53tbrmpplRGBQeErpxA6MaRgo07sU0YEytLIBOiD4YxJZhJ0FHTVNhWGiAY3pMlse2Jm9CQ==",
      canonicalHash: "c29e3f557b4900c77b47c43012ebb4e9e6f5531746afbd748338cc45f2b5c9e6",
    },
    ...overrides,
  };
}

describe("event.schema.json — conditional envelope (contract §3.2)", () => {
  it("an existing ReleasePublished event still validates (non-destructive)", () => {
    const r = validate(releasePublished());
    assert.ok(r.ok, `ReleasePublished should validate: ${JSON.stringify(r.errors)}`);
  });

  it("a ReleasePublished MISSING version FAILS (release-family required preserved)", () => {
    const ev = releasePublished();
    delete ev.version;
    const r = validate(ev);
    assert.equal(r.ok, false, "ReleasePublished without version must be rejected");
  });

  it("a KeyRotation event validates", () => {
    const r = validate(keyRotation());
    assert.ok(r.ok, `KeyRotation should validate: ${JSON.stringify(r.errors)}`);
  });

  it("a KeyRevocation event validates", () => {
    const r = validate(keyRevocation());
    assert.ok(r.ok, `KeyRevocation should validate: ${JSON.stringify(r.errors)}`);
  });

  it("a KeyRotation MISSING key FAILS", () => {
    const ev = keyRotation();
    delete ev.key;
    const r = validate(ev);
    assert.equal(r.ok, false, "KeyRotation without key must be rejected");
  });

  it("a KeyRevocation MISSING key FAILS", () => {
    const ev = keyRevocation();
    delete ev.key;
    const r = validate(ev);
    assert.equal(r.ok, false, "KeyRevocation without key must be rejected");
  });

  it("KeyRotation does NOT require version/commit/artifacts", () => {
    const ev = keyRotation();
    assert.ok(!("version" in ev) && !("commit" in ev) && !("artifacts" in ev));
    const r = validate(ev);
    assert.ok(r.ok, `key-family must not require release fields: ${JSON.stringify(r.errors)}`);
  });

  it("type enum includes KeyRotation and KeyRevocation", () => {
    assert.ok(eventSchema.properties.type.enum.includes("KeyRotation"));
    assert.ok(eventSchema.properties.type.enum.includes("KeyRevocation"));
  });

  it("a top-level `key` property is defined as $defs.keyLifecycle", () => {
    assert.ok(eventSchema.properties.key, "top-level key property must exist");
    assert.equal(eventSchema.properties.key.$ref, "#/$defs/keyLifecycle");
    assert.ok(eventSchema.$defs.keyLifecycle, "$defs.keyLifecycle must exist");
  });
});

describe("event.schema.json — both copies byte-identical (contract §11)", () => {
  it("root and CLI mirror are byte-for-byte identical", () => {
    const rootBytes = fs.readFileSync(ROOT_EVENT_SCHEMA);
    const cliBytes = fs.readFileSync(CLI_EVENT_SCHEMA);
    assert.ok(rootBytes.equals(cliBytes), "event.schema.json copies must be identical");
  });
});

describe("node.schema.json — maintainer window fields (contract §3.1)", () => {
  const nodeSchema = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "schemas", "node.schema.json"), "utf8")
  );
  const m = nodeSchema.$defs.maintainer;

  it("maintainer keeps additionalProperties:false", () => {
    assert.equal(m.additionalProperties, false);
  });

  it("maintainers stays minItems:1", () => {
    assert.equal(nodeSchema.properties.maintainers.minItems, 1);
  });

  it("declares the optional window fields (validFrom/validUntil/revokedAt/revocationReason/invalidAfter)", () => {
    for (const f of ["validFrom", "validUntil", "revokedAt", "revocationReason", "invalidAfter"]) {
      assert.ok(m.properties[f], `maintainer must declare ${f}`);
    }
    assert.deepEqual(m.properties.revocationReason.enum, ["rotation", "compromise", "retirement"]);
  });

  it("window fields are OPTIONAL (a grandfathered maintainer has none of them)", () => {
    for (const f of ["validFrom", "validUntil", "revokedAt", "revocationReason", "invalidAfter"]) {
      assert.ok(!m.required.includes(f), `${f} must NOT be required`);
    }
  });

  it("a grandfathered maintainer (no window fields) still validates", () => {
    const ajv = new (Ajv2020.default || Ajv2020)({ allErrors: true, strict: false });
    (addFormats.default || addFormats)(ajv);
    const validate = ajv.compile(nodeSchema);
    const node = {
      id: "mcp-tool-shop-org/foo",
      kind: "registry",
      provides: ["build.provenance.v1"],
      consumes: [],
      interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
      invariants: { deterministicBuild: true, signedReleases: true, semver: true, changelog: true },
      maintainers: [
        {
          name: "Mike",
          keyId: "mike-2026-01",
          publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAabcdefghij=\n-----END PUBLIC KEY-----",
        },
      ],
    };
    assert.ok(validate(node), `grandfathered node must validate: ${JSON.stringify(validate.errors)}`);
  });
});
