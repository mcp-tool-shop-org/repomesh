import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUNDLED_TRUSTED_ACCOUNTS,
  BUNDLED_TRUSTED_ANCHOR_ACCOUNTS,
  resolveTrustedAnchorAccounts,
  compareRippledBuild,
  rippledBuildWarning,
} from "../src/trusted-anchor-accounts.mjs";

const TRUSTED = "rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W";

describe("shipped anchor allowlist is a ceiling", () => {
  it("the two exported names are the same array", () => {
    assert.equal(BUNDLED_TRUSTED_ACCOUNTS, BUNDLED_TRUSTED_ANCHOR_ACCOUNTS);
    assert.deepEqual([...BUNDLED_TRUSTED_ANCHOR_ACCOUNTS], [TRUSTED]);
  });

  it("drops an account the config omits and ignores an account the config adds", () => {
    const trusted = resolveTrustedAnchorAccounts({
      trustedAnchorAccounts: ["rNotShipped000000000000000000000"],
    });
    assert.equal(trusted.size, 0);
  });

  it("keeps the shipped account when config lists it", () => {
    const trusted = resolveTrustedAnchorAccounts({ trustedAnchorAccounts: [TRUSTED] });
    assert.deepEqual([...trusted], [TRUSTED]);
  });

  it("uses the shipped list when config has no allowlist", () => {
    assert.deepEqual([...resolveTrustedAnchorAccounts({})], [TRUSTED]);
  });
});

describe("rippled build floor", () => {
  it("compares numeric versions", () => {
    assert.equal(compareRippledBuild("3.4.0", "3.4.0"), 0);
    assert.equal(compareRippledBuild("3.3.0", "3.4.0"), -1);
    assert.equal(compareRippledBuild("3.4.1-b2", "3.4.0"), 1);
    assert.equal(compareRippledBuild("not-a-version", "3.4.0"), null);
  });

  it("warns only when a reported build is below the floor", () => {
    assert.equal(rippledBuildWarning("3.4.0"), null);
    assert.match(rippledBuildWarning("3.3.0"), /below the RepoMesh floor 3\.4\.0/);
    assert.equal(rippledBuildWarning(null), null);
  });
});
