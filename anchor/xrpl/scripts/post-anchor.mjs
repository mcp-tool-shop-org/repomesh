#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import xrpl from "xrpl";

function stringToHex(s) { return Buffer.from(s, "utf8").toString("hex").toUpperCase(); }

function buildAnchorMemo({ partitionId, network, rootHex, manifestHash, count, prev, range }) {
  const dataObj = {
    v: 1,
    p: partitionId,
    n: network,
    r: rootHex,
    h: manifestHash,
    c: count,
    pv: prev || "0",
    rg: range ? `${range[0]}..${range[1]}` : "0",
  };
  const memoData = JSON.stringify(dataObj);
  if (Buffer.byteLength(memoData, "utf8") > 700) throw new Error(`MemoData too large: ${Buffer.byteLength(memoData)} bytes`);
  return { Memo: {
    MemoType: stringToHex("repomesh-anchor-v1"),
    MemoFormat: stringToHex("application/json"),
    MemoData: stringToHex(memoData),
  }};
}

async function main() {
  const configPath = path.join(import.meta.dirname, "..", "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const WS_URL = process.env.XRPL_WS_URL || config.rippledUrl;
  const SEED = process.env.XRPL_SEED;
  if (!SEED) { console.error("Set XRPL_SEED env var"); process.exit(1); }

  const rootPath = path.join(import.meta.dirname, "..", "partition-root.json");
  if (!fs.existsSync(rootPath)) { console.error("Run compute-root.mjs first"); process.exit(1); }
  const rootData = JSON.parse(fs.readFileSync(rootPath, "utf8"));
  if (!rootData.root) { console.log("Empty partition. Skipping."); process.exit(0); }

  const client = new xrpl.Client(WS_URL);
  await client.connect();
  try {
    const wallet = xrpl.Wallet.fromSeed(SEED);
    const tx = {
      TransactionType: "Payment", Account: wallet.address, Destination: wallet.address, Amount: "1",
      Memos: [buildAnchorMemo({
        partitionId: rootData.partitionId,
        network: config.network,
        rootHex: rootData.root,
        manifestHash: rootData.manifestHash,
        count: rootData.eventCount,
        prev: rootData.prev,
        range: rootData.range,
      })],
    };
    const result = await client.submitAndWait(tx, { wallet });
    const txHash = result?.result?.hash || result?.result?.tx_json?.hash;
    const output = {
      ok: (result?.result?.meta?.TransactionResult || result?.result?.engine_result) === "tesSUCCESS",
      network: config.network,
      partitionId: rootData.partitionId,
      root: rootData.root,
      manifestHash: rootData.manifestHash,
      eventCount: rootData.eventCount,
      txHash,
      walletAddress: wallet.address,
    };
    console.log(JSON.stringify(output, null, 2));
    fs.writeFileSync(path.join(import.meta.dirname, "..", "anchor-result.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  } finally { await client.disconnect(); }
}
main().catch(e => { console.error(e); process.exit(1); });
