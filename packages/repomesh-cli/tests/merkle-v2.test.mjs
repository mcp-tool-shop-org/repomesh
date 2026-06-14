import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }

// Reference implementation of the contracted v2 spec (RFC-6962 domain separation):
//   leaf  = sha256(0x00 || leafBytes)
//   inner = sha256(0x01 || left || right)
//   lone odd node carried up UNCHANGED (no duplicate-last)
function refV2(leavesHex) {
  const D0 = Buffer.from([0x00]);
  const D1 = Buffer.from([0x01]);
  let level = leavesHex.map(h =>
    crypto.createHash("sha256").update(Buffer.concat([D0, Buffer.from(h, "hex")])).digest()
  );
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(crypto.createHash("sha256").update(Buffer.concat([D1, level[i], level[i + 1]])).digest());
      } else {
        next.push(level[i]); // carry odd up unchanged
      }
    }
    level = next;
  }
  return level[0].toString("hex");
}

describe("CLI-009 / D3: merkleRootHexV2 (RFC-6962 domain separation)", () => {
  const h = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const leaves2 = [h("a"), h("b")];
  const leaves3 = [h("a"), h("b"), h("c")];

  it("exports merkleRootHexV2", async () => {
    const m = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    assert.equal(typeof m.merkleRootHexV2, "function");
  });

  it("v2 matches the contracted RFC-6962 reference (2 leaves)", async () => {
    const { merkleRootHexV2 } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    assert.equal(merkleRootHexV2(leaves2), refV2(leaves2));
  });

  it("v2 carries lone odd node up UNCHANGED (no duplicate-last) — 3 leaves", async () => {
    const { merkleRootHexV2 } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    assert.equal(merkleRootHexV2(leaves3), refV2(leaves3));
  });

  it("v2 differs from v1 (domain separation actually applied)", async () => {
    const { merkleRootHex, merkleRootHexV2 } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    assert.notEqual(merkleRootHexV2(leaves2), merkleRootHex(leaves2));
  });

  it("v2 single leaf = sha256(0x00||leaf)", async () => {
    const { merkleRootHexV2 } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    const one = [h("solo")];
    assert.equal(merkleRootHexV2(one), refV2(one));
  });

  it("v1 root unchanged (backward compatibility)", async () => {
    const { merkleRootHex } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    // v1 duplicate-last on odd: known stable output for these inputs
    const expected = (() => {
      let level = leaves2.map(x => Buffer.from(x, "hex"));
      while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
          const l = level[i];
          const r = (i + 1 < level.length) ? level[i + 1] : level[i];
          next.push(crypto.createHash("sha256").update(Buffer.concat([l, r])).digest());
        }
        level = next;
      }
      return level[0].toString("hex");
    })();
    assert.equal(merkleRootHex(leaves2), expected);
  });
});

// D3: the dispatcher must use the canonical (leavesHex, algo) signature and be FAIL-CLOSED.
// RED on the old packages copy (signature was (algo, leavesHex) + silent fall-through to v1
// on an unknown algo); GREEN after standardizing onto the anchor copy's contract.
describe("D3: merkleRootForAlgo dispatcher contract (fail-closed, canonical arg order)", () => {
  const h = (s) => crypto.createHash("sha256").update(s).digest("hex");

  it("THROWS on an unknown algo (no silent fall-back to v1)", async () => {
    const { merkleRootForAlgo } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    const leaves = [h("a"), h("b"), h("c")];
    assert.throws(
      () => merkleRootForAlgo(leaves, "sha256-merkle-v99"),
      /Unknown merkle algo/,
      "unknown algo must throw (fail-closed), never silently return a v1 root"
    );
  });

  it("dispatches on the SECOND positional arg (leavesHex, algo)", async () => {
    const { merkleRootForAlgo, merkleRootHex, merkleRootHexV2 } =
      await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    const leaves = [h("a"), h("b"), h("c")];
    assert.equal(merkleRootForAlgo(leaves, "sha256-merkle-v1"), merkleRootHex(leaves));
    assert.equal(merkleRootForAlgo(leaves, "sha256-merkle-v2"), merkleRootHexV2(leaves));
    // default (no algo) → v1
    assert.equal(merkleRootForAlgo(leaves), merkleRootHex(leaves));
  });

  it("exports merkleManifest (parity with the canonical anchor copy)", async () => {
    const { merkleManifest, merkleRootHexV2 } =
      await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
    assert.equal(typeof merkleManifest, "function");
    const leaves = [h("a"), h("b"), h("c")];
    const m = merkleManifest(leaves, "sha256-merkle-v2");
    assert.equal(m.algo, "sha256-merkle-v2");
    assert.equal(m.root, merkleRootHexV2(leaves));
  });
});

// D3 byte-for-byte parity: the packages copy and the canonical anchor copy must produce
// IDENTICAL v1 and v2 roots over n=1,2,3,5 (v1==v1, v2==v2, and v1!=v2 per count).
describe("D3: packages merkle.mjs is byte-identical to the anchor copy (n=1,2,3,5)", () => {
  const anchorMerklePath = resolve(__dirname, "..", "..", "..", "anchor", "xrpl", "scripts", "merkle.mjs");
  const leafHex = (n) => crypto.createHash("sha256").update(`leaf-${n}`).digest("hex");

  for (const n of [1, 2, 3, 5]) {
    it(`v1 and v2 roots match the anchor copy for n=${n} (and v1 != v2)`, async () => {
      const pkg = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
      const anc = await import(toURL(anchorMerklePath));
      const leaves = Array.from({ length: n }, (_, i) => leafHex(i));

      assert.equal(pkg.merkleRootHex(leaves), anc.merkleRootHex(leaves), `v1 mismatch n=${n}`);
      assert.equal(pkg.merkleRootHexV2(leaves), anc.merkleRootHexV2(leaves), `v2 mismatch n=${n}`);
      assert.notEqual(pkg.merkleRootHex(leaves), pkg.merkleRootHexV2(leaves), `v1 must differ from v2 n=${n}`);
    });
  }
});
