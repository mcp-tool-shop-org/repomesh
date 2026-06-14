// Anchor domain — Stage A amend: D4 / ANC-001 / ANC-002 (+ REG-001 anchor half).
//
// Probes the FULL anchor-tx verification invariant via the pure, exported verifyAnchorTx():
//   ANC-001  tx.Account MUST be in trustedAnchorAccounts (any funded wallet forges otherwise).
//   ANC-002  tx.validated === true (an unvalidated/pending tx must not certify an anchor).
//   tesSUCCESS  meta.TransactionResult must be 'tesSUCCESS'.
//   REG-001  on-chain memo r/h/c must match the locally recomputed root / manifestHash / count.
//   algo dispatch  root recompute uses the algo from the manifest/memo (v1 vs v2).
// Each check is tested for BOTH halves: a clean anchor PASSES, a tampered one FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAnchorTx } from "../scripts/verify-anchor.mjs";
import { merkleRootHex, merkleRootHexV2 } from "../scripts/merkle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "..", "config.json");
const TRUSTED = "rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W";

const leafHex = (n) => crypto.createHash("sha256").update(`leaf-${n}`).digest("hex");
const leaves = [leafHex(0), leafHex(1), leafHex(2)];

// Build a self-consistent v1 fixture: memo r/h/c agree with the recomputed local root.
function v1Fixture() {
  const root = merkleRootHex(leaves);
  const memo = { v: 1, p: "all", n: "testnet", r: root, h: "deadbeef".repeat(8), c: leaves.length, algo: "sha256-merkle-v1" };
  return { memo, localRoot: root, localManifestHash: memo.h };
}

function v2Fixture() {
  const root = merkleRootHexV2(leaves);
  const memo = { v: 1, p: "all", n: "testnet", r: root, h: "feedface".repeat(8), c: leaves.length, algo: "sha256-merkle-v2" };
  return { memo, localRoot: root, localManifestHash: memo.h };
}

function tx(overrides = {}) {
  return {
    validated: true,
    Account: TRUSTED,
    meta: { TransactionResult: "tesSUCCESS" },
    ...overrides,
  };
}

describe("config.json trustedAnchorAccounts (D4)", () => {
  it("seeds trustedAnchorAccounts with the genesis wallet", () => {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    assert.ok(Array.isArray(cfg.trustedAnchorAccounts), "config.trustedAnchorAccounts must be an array");
    assert.ok(cfg.trustedAnchorAccounts.includes(TRUSTED),
      "the genesis anchor wallet must be in the allowlist");
  });
});

describe("D4/REG-001 verifyAnchorTx — clean anchor PASSES", () => {
  it("a fully-valid v1 anchor verifies ok", () => {
    const f = v1Fixture();
    const r = verifyAnchorTx({ tx: tx(), memo: f.memo, localRoot: f.localRoot,
      localManifestHash: f.localManifestHash, leafCount: leaves.length, trustedAnchorAccounts: [TRUSTED] });
    assert.equal(r.ok, true, "clean v1 anchor must pass\n" + JSON.stringify(r, null, 2));
  });

  it("a fully-valid v2 anchor verifies ok (algo dispatch)", () => {
    const f = v2Fixture();
    const r = verifyAnchorTx({ tx: tx(), memo: f.memo, localRoot: f.localRoot,
      localManifestHash: f.localManifestHash, leafCount: leaves.length, trustedAnchorAccounts: [TRUSTED] });
    assert.equal(r.ok, true, "clean v2 anchor must pass\n" + JSON.stringify(r, null, 2));
  });
});

describe("ANC-001 tx.Account allowlist", () => {
  it("FAILS when tx.Account is not in trustedAnchorAccounts", () => {
    const f = v1Fixture();
    const r = verifyAnchorTx({ tx: tx({ Account: "rROGUEwallet11111111111111111111" }), memo: f.memo,
      localRoot: f.localRoot, localManifestHash: f.localManifestHash, leafCount: leaves.length,
      trustedAnchorAccounts: [TRUSTED] });
    assert.equal(r.ok, false, "untrusted anchor account must fail");
    assert.match(r.reason || "", /account|wallet|trust|allowlist/i);
  });
});

describe("ANC-002 tx.validated", () => {
  it("FAILS when tx.validated !== true", () => {
    const f = v1Fixture();
    const r = verifyAnchorTx({ tx: tx({ validated: false }), memo: f.memo, localRoot: f.localRoot,
      localManifestHash: f.localManifestHash, leafCount: leaves.length, trustedAnchorAccounts: [TRUSTED] });
    assert.equal(r.ok, false, "unvalidated tx must fail");
    assert.match(r.reason || "", /validat/i);
  });
});

describe("tesSUCCESS meta.TransactionResult", () => {
  it("FAILS when meta.TransactionResult is not tesSUCCESS", () => {
    const f = v1Fixture();
    const r = verifyAnchorTx({ tx: tx({ meta: { TransactionResult: "tecPATH_DRY" } }), memo: f.memo,
      localRoot: f.localRoot, localManifestHash: f.localManifestHash, leafCount: leaves.length,
      trustedAnchorAccounts: [TRUSTED] });
    assert.equal(r.ok, false, "non-tesSUCCESS tx must fail");
    assert.match(r.reason || "", /tessuccess|result|transaction/i);
  });
});

describe("REG-001 memo r/h/c binding", () => {
  it("FAILS when memo root does not match the local root", () => {
    const f = v1Fixture();
    const r = verifyAnchorTx({ tx: tx(), memo: { ...f.memo, r: "0".repeat(64) }, localRoot: f.localRoot,
      localManifestHash: f.localManifestHash, leafCount: leaves.length, trustedAnchorAccounts: [TRUSTED] });
    assert.equal(r.ok, false, "memo root mismatch must fail");
    assert.match(r.reason || "", /root/i);
  });

  it("FAILS when memo manifestHash does not match local", () => {
    const f = v1Fixture();
    const r = verifyAnchorTx({ tx: tx(), memo: f.memo, localRoot: f.localRoot,
      localManifestHash: "abc123".padEnd(64, "0"), leafCount: leaves.length, trustedAnchorAccounts: [TRUSTED] });
    assert.equal(r.ok, false, "manifestHash mismatch must fail");
    assert.match(r.reason || "", /manifest|hash/i);
  });

  it("FAILS when memo count does not match local leaf count", () => {
    const f = v1Fixture();
    const r = verifyAnchorTx({ tx: tx(), memo: { ...f.memo, c: 99 }, localRoot: f.localRoot,
      localManifestHash: f.localManifestHash, leafCount: leaves.length, trustedAnchorAccounts: [TRUSTED] });
    assert.equal(r.ok, false, "count mismatch must fail");
    assert.match(r.reason || "", /count/i);
  });
});
