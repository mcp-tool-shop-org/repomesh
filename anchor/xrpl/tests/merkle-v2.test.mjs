// Anchor domain — Stage A amend: D3 / ANC-003 Merkle v2 (RFC-6962, domain separation).
//
// Probes the FULL invariant:
//   1. merkleRootHexV2 implements RFC-6962 domain separation
//      (leaf = sha256(0x00||leaf), node = sha256(0x01||l||r), lone odd carried up).
//   2. v2 is NOT byte-equal to v1 (the CVE-2012-2459 dup-last + no-domain-separation fix changed the root).
//   3. v1 (merkleRootHex) is preserved byte-identical to the historical algorithm.
//   4. v2 resists the CVE-2012-2459 collision: a tree of N leaves and a crafted tree that
//      duplicates the last leaf produce DIFFERENT roots (v1 collides; v2 must not).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { merkleRootHex, merkleRootHexV2, merkleManifest } from "../scripts/merkle.mjs";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}
const hex = (b) => b.toString("hex");
const leafHex = (n) => crypto.createHash("sha256").update(`leaf-${n}`).digest("hex");

// Reference RFC-6962 implementation (independent of the module under test).
function refV2(leavesHex) {
  let level = leavesHex.map((h) => sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(h, "hex")])));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(sha256(Buffer.concat([Buffer.from([0x01]), level[i], level[i + 1]])));
      } else {
        next.push(level[i]); // lone odd: carry up unchanged
      }
    }
    level = next;
  }
  return hex(level[0]);
}

describe("D3/ANC-003 merkleRootHexV2 (RFC-6962)", () => {
  it("exports merkleRootHexV2", () => {
    assert.equal(typeof merkleRootHexV2, "function", "merkleRootHexV2 must be exported");
  });

  it("matches an independent RFC-6962 reference for 1..6 leaves", () => {
    for (let n = 1; n <= 6; n++) {
      const leaves = Array.from({ length: n }, (_, i) => leafHex(i));
      assert.equal(merkleRootHexV2(leaves), refV2(leaves), `v2 root mismatch for n=${n}`);
    }
  });

  it("single-leaf v2 root is sha256(0x00||leaf), NOT the raw leaf (domain separation)", () => {
    const leaf = leafHex(0);
    const expected = hex(sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(leaf, "hex")])));
    assert.equal(merkleRootHexV2([leaf]), expected);
    assert.notEqual(merkleRootHexV2([leaf]), leaf, "v2 single-leaf root must not equal the raw leaf");
  });

  it("v2 differs from v1 for an odd leaf count (dup-last vs carry-up + domain sep)", () => {
    const leaves = [leafHex(0), leafHex(1), leafHex(2)];
    assert.notEqual(merkleRootHexV2(leaves), merkleRootHex(leaves),
      "v2 must differ from v1 (the breaking-change fix)");
  });

  it("resists CVE-2012-2459: N leaves vs the dup-last(N+1) tree give different v2 roots", () => {
    // v1 of [a,b,c] computes the same as a tree where c is duplicated to make a 4-leaf even level.
    // Under v2, presenting a 4-leaf tree [a,b,c,c] must NOT collide with the 3-leaf [a,b,c].
    const a = leafHex(0), b = leafHex(1), c = leafHex(2);
    const three = merkleRootHexV2([a, b, c]);
    const fourDup = merkleRootHexV2([a, b, c, c]);
    assert.notEqual(three, fourDup, "v2 must not collide a tree with its dup-last variant");
  });

  it("preserves v1 byte-identically (historical roots still verify)", () => {
    // The committed genesis manifest root (8 real leaves) — v1 must reproduce it unchanged.
    // Use a stable synthetic check: v1 of two leaves = sha256(l0||l1) with NO domain byte.
    const l0 = leafHex(0), l1 = leafHex(1);
    const expectedV1 = hex(sha256(Buffer.concat([Buffer.from(l0, "hex"), Buffer.from(l1, "hex")])));
    assert.equal(merkleRootHex([l0, l1]), expectedV1, "v1 must remain the no-domain-separation algorithm");
  });
});

describe("D3 merkleManifest version dispatch", () => {
  it("merkleManifest can emit a v2 algo string with the v2 root", () => {
    const leaves = [leafHex(0), leafHex(1), leafHex(2)];
    const m = merkleManifest(leaves, "sha256-merkle-v2");
    assert.equal(m.algo, "sha256-merkle-v2");
    assert.equal(m.root, merkleRootHexV2(leaves), "v2 manifest root must use the v2 algorithm");
  });

  it("merkleManifest defaults to v1 byte-identically (backward compatible)", () => {
    const leaves = [leafHex(0), leafHex(1), leafHex(2)];
    const m = merkleManifest(leaves);
    assert.equal(m.algo, "sha256-merkle-v1");
    assert.equal(m.root, merkleRootHex(leaves));
  });
});
