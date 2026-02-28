// Merkle tree utilities — copied from anchor/xrpl/scripts/merkle.mjs
import crypto from "node:crypto";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

export function merkleRootHex(leavesHex) {
  if (!Array.isArray(leavesHex) || leavesHex.length === 0) {
    throw new Error("merkleRootHex: need at least 1 leaf");
  }
  let level = leavesHex.map((h, i) => {
    if (typeof h !== "string" || !/^[0-9a-fA-F]{64}$/.test(h)) {
      throw new Error(`Invalid leaf[${i}] (expected 64 hex chars): ${h}`);
    }
    return Buffer.from(h, "hex");
  });
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
