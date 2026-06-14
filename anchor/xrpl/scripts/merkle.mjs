import crypto from "node:crypto";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

// Domain-separation prefixes for the RFC-6962 (Certificate Transparency) Merkle tree (v2).
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function validateLeaves(leavesHex) {
  if (!Array.isArray(leavesHex) || leavesHex.length === 0) {
    throw new Error("merkle: need at least 1 leaf");
  }
  return leavesHex.map((h, i) => {
    if (typeof h !== "string" || !/^[0-9a-fA-F]{64}$/.test(h)) {
      throw new Error(`Invalid leaf[${i}] (expected 64 hex chars): ${h}`);
    }
    return Buffer.from(h, "hex");
  });
}

// v1 — historical algorithm. NO domain separation; lone odd node is DUPLICATED (CVE-2012-2459).
// Kept byte-identical so already-anchored v1 partitions still verify. Do NOT change this function.
export function merkleRootHex(leavesHex) {
  let level = validateLeaves(leavesHex);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = (i + 1 < level.length) ? level[i + 1] : level[i];
      next.push(sha256(Buffer.concat([left, right])));
    }
    level = next;
  }
  return level[0].toString("hex");
}

// v2 — RFC-6962 (Certificate Transparency). Domain separation:
//   leaf hash      = sha256(0x00 || leafBytes)
//   internal node  = sha256(0x01 || left || right)
//   lone odd node  = CARRIED UP UNCHANGED (no duplicate-last)
// This closes CVE-2012-2459 (second-preimage via dup-last) and the leaf/node ambiguity.
export function merkleRootHexV2(leavesHex) {
  const raw = validateLeaves(leavesHex);
  // First hash every leaf with the leaf-domain prefix.
  let level = raw.map((b) => sha256(Buffer.concat([LEAF_PREFIX, b])));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(sha256(Buffer.concat([NODE_PREFIX, level[i], level[i + 1]])));
      } else {
        next.push(level[i]); // carry the lone odd node up unchanged
      }
    }
    level = next;
  }
  return level[0].toString("hex");
}

// Compute a root for the requested algo. Defaults to v1 for backward compatibility.
export function merkleRootForAlgo(leavesHex, algo = "sha256-merkle-v1") {
  if (algo === "sha256-merkle-v2") return merkleRootHexV2(leavesHex);
  if (algo === "sha256-merkle-v1") return merkleRootHex(leavesHex);
  throw new Error(`Unknown merkle algo: ${algo}`);
}

export function merkleManifest(leavesHex, algo = "sha256-merkle-v1") {
  const root = merkleRootForAlgo(leavesHex, algo);
  return {
    algo,
    leafEncoding: "canonicalHash:hex(32)",
    leafCount: leavesHex.length,
    root,
  };
}
