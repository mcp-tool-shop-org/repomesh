// Anchor domain — Stage A fix-up WAVE 2: D16 (HIGH #3).
//
// The on-chain memo MUST self-describe its Merkle algorithm so the standalone verifier can
// recompute the root with the SAME algorithm that produced it.
//
// Invariant probed end-to-end against the real verify-anchor fallback logic:
//   - buildAnchorMemo carries `algo` from the partition-root data into the memo dataObj.
//   - For a v2 partition, decoding the memo and recomputing the root using the verifier's
//     `memo.algo || 'sha256-merkle-v1'` fallback yields a MATCH (PASS) — not a v1 MISMATCH.
//   - Legacy memos with no `algo` field still resolve to v1 (backward compatibility).
//   - MemoType stays backward-compatible (the verifier locates `repomesh-anchor-v1`).
//
// RED on current code: a v2 memo carries no `algo`, so the fallback recomputes it as v1 -> MISMATCH.
// GREEN after D16: the memo carries `algo: 'sha256-merkle-v2'` -> the verifier recomputes v2 -> MATCH.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildAnchorMemo } from "../scripts/post-anchor.mjs";
import { merkleRootHex, merkleRootHexV2, merkleRootForAlgo } from "../scripts/merkle.mjs";

const leafHex = (n) => crypto.createHash("sha256").update(`leaf-${n}`).digest("hex");
const leaves = [leafHex(0), leafHex(1), leafHex(2)];

function hexToString(hex) { return Buffer.from(hex, "hex").toString("utf8"); }

// Decode a Memo built by buildAnchorMemo back into { memoType, dataObj } the way verify-anchor does.
function decodeMemo({ Memo }) {
  return {
    memoType: hexToString(Memo.MemoType),
    dataObj: JSON.parse(hexToString(Memo.MemoData)),
  };
}

// The EXACT fallback verify-anchor.mjs uses to pick the recompute algorithm.
const algoFromMemo = (memo) => memo.algo || "sha256-merkle-v1";

describe("D16 — anchor memo self-describes its algo", () => {
  it("a v2 partition's memo recomputes PASS through the verifier fallback (RED before fix)", () => {
    const v2Root = merkleRootHexV2(leaves);
    const memoEnvelope = buildAnchorMemo({
      partitionId: "all",
      network: "testnet",
      rootHex: v2Root,
      manifestHash: "feedface".repeat(8),
      count: leaves.length,
      prev: "0",
      range: null,
      algo: "sha256-merkle-v2",
    });
    const { dataObj } = decodeMemo(memoEnvelope);

    // The verifier recomputes the root using the algo the memo declares.
    const recomputed = merkleRootForAlgo(leaves, algoFromMemo(dataObj));
    assert.equal(
      recomputed,
      dataObj.r,
      "v2 memo must recompute to a MATCH via memo.algo — without an algo field the fallback picks v1 and MISMATCHES"
    );
  });

  it("buildAnchorMemo includes the algo field in the memo dataObj", () => {
    const v2Root = merkleRootHexV2(leaves);
    const { dataObj } = decodeMemo(buildAnchorMemo({
      partitionId: "all", network: "testnet", rootHex: v2Root,
      manifestHash: "feedface".repeat(8), count: leaves.length, prev: "0", range: null,
      algo: "sha256-merkle-v2",
    }));
    assert.equal(dataObj.algo, "sha256-merkle-v2", "memo dataObj must carry algo for self-description");
  });

  it("a v1 partition's memo still recomputes PASS (algo flows through unchanged)", () => {
    const v1Root = merkleRootHex(leaves);
    const { dataObj } = decodeMemo(buildAnchorMemo({
      partitionId: "all", network: "testnet", rootHex: v1Root,
      manifestHash: "deadbeef".repeat(8), count: leaves.length, prev: "0", range: null,
      algo: "sha256-merkle-v1",
    }));
    const recomputed = merkleRootForAlgo(leaves, algoFromMemo(dataObj));
    assert.equal(recomputed, dataObj.r, "v1 memo must still verify");
  });

  it("a legacy memo with no algo field resolves to v1 (backward compatibility)", () => {
    // Simulate a pre-D16 memo: dataObj without the algo key.
    const v1Root = merkleRootHex(leaves);
    const legacyDataObj = { v: 1, p: "all", n: "testnet", r: v1Root, h: "x".repeat(64), c: leaves.length };
    const recomputed = merkleRootForAlgo(leaves, algoFromMemo(legacyDataObj));
    assert.equal(recomputed, v1Root, "a legacy memo (no algo) must fall back to v1 and still MATCH");
  });

  it("MemoType stays backward-compatible (repomesh-anchor-v1) so existing verifiers locate it", () => {
    const { memoType } = decodeMemo(buildAnchorMemo({
      partitionId: "all", network: "testnet", rootHex: merkleRootHexV2(leaves),
      manifestHash: "feedface".repeat(8), count: leaves.length, prev: "0", range: null,
      algo: "sha256-merkle-v2",
    }));
    assert.equal(memoType, "repomesh-anchor-v1", "MemoType must remain repomesh-anchor-v1 for backward compatibility");
  });
});
