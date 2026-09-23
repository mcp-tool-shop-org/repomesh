import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSeedAlgorithm, assertPostingAccount } from "../scripts/post-anchor.mjs";

const TRUSTED = "rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W";
const xrplNs = { ECDSA: { ed25519: "ed25519", secp256k1: "ecdsa-secp256k1" } };

describe("seed algorithm is explicit", () => {
  it("defaults a missing name to ed25519", () => {
    assert.deepEqual(resolveSeedAlgorithm(xrplNs, undefined), { ok: true, algorithm: "ed25519" });
  });

  it("accepts secp256k1", () => {
    assert.deepEqual(resolveSeedAlgorithm(xrplNs, "secp256k1"), { ok: true, algorithm: "ecdsa-secp256k1" });
  });

  it("rejects an unknown name", () => {
    const result = resolveSeedAlgorithm(xrplNs, "rsa");
    assert.equal(result.ok, false);
  });
});

describe("posting account must match the seed and the shipped allowlist", () => {
  const trusted = new Set([TRUSTED]);

  it("accepts the configured account when it is shipped", () => {
    assert.equal(assertPostingAccount(TRUSTED, { postingAccount: TRUSTED }, trusted).ok, true);
  });

  it("refuses a seed that derives a different address", () => {
    const result = assertPostingAccount("rOther000000000000000000000000000", { postingAccount: TRUSTED }, trusted);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Refusing to submit/);
  });

  it("refuses a posting account that is not on the shipped ceiling", () => {
    const result = assertPostingAccount("rOther000000000000000000000000000", {
      postingAccount: "rOther000000000000000000000000000",
    }, trusted);
    assert.equal(result.ok, false);
    assert.match(result.reason, /shipped anchor allowlist/);
  });
});
