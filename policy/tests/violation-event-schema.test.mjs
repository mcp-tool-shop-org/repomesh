// SPC-A-005 — PolicyViolation schema-roundtrip regression guard (Stage A amend).
//
// Regression guard for SPC-A-001: the policy node's buildViolationEvent() used to emit
// `artifacts: []`, but PolicyViolation is in the schema's release-shaped enum and therefore
// inherits `required: [version, commit, artifacts, attestations]` + `artifacts minItems:1`.
// That made EVERY violation event schema-invalid → the ledger validator rejected it → a
// genuine policy violation (e.g. a semver downgrade) could never be recorded, leaving the
// entire enforcement path silently dead.
//
// This test builds a real violation event via the live emitter, SIGNS it (so the signature
// fields are real, not the UNSIGNED placeholder), and asserts it validates against the REAL
// schemas/event.schema.json via ajv — the same validator the ledger CI uses. If anyone
// re-empties artifacts or otherwise breaks the violation shape, this turns red.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { buildViolationEvent, signEvent } from "../scripts/check-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const EVENT_SCHEMA_PATH = path.join(REPO_ROOT, "schemas", "event.schema.json");

// Compile the real event schema the same way validate-ledger.mjs does (draft 2020-12 + formats).
function makeValidator() {
  const schema = JSON.parse(fs.readFileSync(EVENT_SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

// A throwaway ed25519 keypair so signEvent() produces a real (32+ char, base64) signature
// and a 64-hex canonicalHash — matching the schema's signature constraints end-to-end.
function freshKeypair() {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" });
}

const SAMPLE_VIOLATION = {
  type: "semver.monotonicity",
  repo: "mcp-tool-shop-org/shipcheck",
  version: "1.0.3",
  commit: "c6267db5d44706b4ab2294c2b343a6f1bc40c09c",
  detail: "Version 1.0.3 is not greater than 1.0.4 (published later at 2026-02-28T05:05:35.855Z)",
  severity: "error",
};

describe("SPC-A-005 PolicyViolation schema roundtrip", () => {
  it("a built violation event carries exactly one schema-valid artifact (not [])", () => {
    const ev = buildViolationEvent(SAMPLE_VIOLATION);
    assert.equal(ev.type, "PolicyViolation");
    assert.ok(Array.isArray(ev.artifacts), "artifacts must be an array");
    assert.ok(ev.artifacts.length >= 1, "SPC-A-001: artifacts must NOT be empty (minItems:1)");
    const art = ev.artifacts[0];
    assert.match(art.sha256, /^[0-9a-f]{64}$/, "artifact sha256 must be 64 lowercase hex");
    assert.ok(art.name && art.name.length >= 1, "artifact name required");
    assert.ok(art.uri && art.uri.length >= 1, "artifact uri required");
  });

  it("a SIGNED violation event validates against schemas/event.schema.json (enforcement path live)", () => {
    const validate = makeValidator();
    const pem = freshKeypair();
    const ev = signEvent(buildViolationEvent(SAMPLE_VIOLATION), pem, "ci-repomesh-2026");
    const ok = validate(ev);
    assert.ok(
      ok,
      "SPC-A-001: a signed PolicyViolation event MUST validate against the real schema — " +
        "otherwise the ledger validator rejects it and enforcement is silently inert.\n" +
        (ok ? "" : require_errorsText(validate)),
    );
  });

  it("artifact sha256 is content-addressed: recomputable from the violation descriptor", () => {
    // Tamper-evidence guard: the digest must be derivable from the violation, not random.
    const ev1 = buildViolationEvent(SAMPLE_VIOLATION);
    const ev2 = buildViolationEvent(SAMPLE_VIOLATION);
    assert.equal(
      ev1.artifacts[0].sha256,
      ev2.artifacts[0].sha256,
      "the same violation must always produce the same artifact digest (deterministic)",
    );
    const different = buildViolationEvent({ ...SAMPLE_VIOLATION, detail: "a different violation" });
    assert.notEqual(
      ev1.artifacts[0].sha256,
      different.artifacts[0].sha256,
      "a different violation must produce a different artifact digest",
    );
  });
});

// Tiny helper so the assertion message can carry ajv's reason without crashing under ESM.
function require_errorsText(validate) {
  try {
    return JSON.stringify(validate.errors, null, 2);
  } catch {
    return "(unable to serialize ajv errors)";
  }
}
