// SEC-006 — SPDX AND/OR/paren expressions must be parsed before classification.
//   OR  = any arm allowed.
//   AND = every arm must be allowed (a copyleft arm poisons AND).
// SEC-009 — a self-applied treatUnknownAs override may only be {warn, fail}; never 'pass'.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifySpdxExpression, tokenizeSpdx, normalizeLicenseId } from "../lib/spdx.mjs";
import { classifyLicenses, mergeConfig } from "../license/scripts/verify-license.mjs";

const CTX = {
  allow: new Set(["MIT", "Apache-2.0", "ISC", "BSD-3-Clause"]),
  coprefix: ["GPL-", "LGPL-", "AGPL-", "SSPL-"],
  coexact: new Set(["MPL-2.0"]),
};

describe("SEC-006 classifySpdxExpression", () => {
  it("'MIT OR GPL-3.0-only' is ALLOWED (OR: any arm allowed)", () => {
    assert.equal(classifySpdxExpression("MIT OR GPL-3.0-only", CTX), "allowed");
  });

  it("'Apache-2.0 AND GPL-2.0-only' is COPYLEFT (AND: copyleft arm poisons)", () => {
    assert.equal(classifySpdxExpression("Apache-2.0 AND GPL-2.0-only", CTX), "copyleft");
  });

  it("parenthesized '(MIT OR Apache-2.0) AND ISC' is ALLOWED", () => {
    assert.equal(classifySpdxExpression("(MIT OR Apache-2.0) AND ISC", CTX), "allowed");
  });

  it("parenthesized '(MIT AND GPL-3.0-only) OR Apache-2.0' is ALLOWED (right OR arm allowed)", () => {
    assert.equal(classifySpdxExpression("(MIT AND GPL-3.0-only) OR Apache-2.0", CTX), "allowed");
  });

  it("'GPL-3.0-only OR LGPL-2.1-only' is COPYLEFT (no allowed arm, has copyleft)", () => {
    assert.equal(classifySpdxExpression("GPL-3.0-only OR LGPL-2.1-only", CTX), "copyleft");
  });

  it("'MIT OR SomeWeirdLicense' is ALLOWED; 'SomeWeirdLicense' alone is UNKNOWN", () => {
    assert.equal(classifySpdxExpression("MIT OR SomeWeirdLicense", CTX), "allowed");
    assert.equal(classifySpdxExpression("SomeWeirdLicense", CTX), "unknown");
  });

  it("strips a trailing '+' and a WITH exception", () => {
    assert.equal(normalizeLicenseId("Apache-2.0+"), "Apache-2.0");
    assert.equal(classifySpdxExpression("Apache-2.0 WITH LLVM-exception", CTX), "allowed");
    assert.equal(classifySpdxExpression("GPL-2.0-only WITH Classpath-exception-2.0", CTX), "copyleft");
  });

  it("tokenizer separates operators and parens", () => {
    const kinds = tokenizeSpdx("(MIT OR Apache-2.0) AND ISC").map(t => t.kind);
    assert.deepEqual(kinds, ["(", "ID", "OR", "ID", ")", "AND", "ID"]);
  });
});

describe("SEC-006 classifyLicenses end-to-end (compound expression no longer false-flags)", () => {
  const cfg = { allowlist: [...CTX.allow], copyleftPrefixes: CTX.coprefix, copyleftExact: [...CTX.coexact] };

  it("a component licensed 'MIT OR GPL-3.0-only' passes (was previously mis-flagged unknown)", () => {
    const { result, findings } = classifyLicenses(
      [{ name: "dual", version: "1.0.0", licenses: ["MIT OR GPL-3.0-only"] }],
      cfg
    );
    assert.equal(result, "pass");
    assert.equal(findings.allowed, 1);
    assert.equal(findings.copyleft.length, 0);
  });

  it("a component licensed 'Apache-2.0 AND GPL-2.0-only' FAILS (copyleft poisons AND)", () => {
    const { result, findings } = classifyLicenses(
      [{ name: "poison", version: "1.0.0", licenses: ["Apache-2.0 AND GPL-2.0-only"] }],
      cfg
    );
    assert.equal(result, "fail");
    assert.equal(findings.copyleft.length, 1);
  });
});

describe("SEC-009 treatUnknownAs self-override restriction", () => {
  const baseCfg = { allowlist: ["MIT"], copyleftPrefixes: ["GPL-"], copyleftExact: [] };

  it("honors a stricter self-applied treatUnknownAs:'fail'", () => {
    const merged = mergeConfig(baseCfg, { treatUnknownAs: "fail" });
    assert.equal(merged.treatUnknownAs, "fail");
  });

  it("honors a self-applied treatUnknownAs:'warn'", () => {
    const merged = mergeConfig(baseCfg, { treatUnknownAs: "warn" });
    assert.equal(merged.treatUnknownAs, "warn");
  });

  it("IGNORES a self-applied treatUnknownAs:'pass' (cannot self-certify missing licenses)", () => {
    const merged = mergeConfig(baseCfg, { treatUnknownAs: "pass" });
    assert.notEqual(merged.treatUnknownAs, "pass");
  });

  it("an unknown-license component does NOT pass via self-applied treatUnknownAs:'pass'", () => {
    const merged = mergeConfig(baseCfg, { treatUnknownAs: "pass" });
    const { result } = classifyLicenses(
      [{ name: "mystery", version: "1.0.0", licenses: ["Some-Unknown-License"] }],
      merged
    );
    assert.notEqual(result, "pass", "missing/unknown licenses must never be self-certified as pass");
  });
});
