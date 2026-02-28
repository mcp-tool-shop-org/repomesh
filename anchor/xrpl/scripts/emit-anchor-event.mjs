#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildAttestationEvent, signEvent, writeJsonlLine, loadSigningKeyFromEnvOrFile } from "../../../verifiers/lib/common.mjs";

const args = process.argv.slice(2);
const sign = args.includes("--sign");
const outIdx = args.indexOf("--output");
const out = outIdx !== -1 ? args[outIdx + 1] : null;
const keyId = process.env.REPOMESH_KEY_ID || "ci-repomesh-2026";
const skIdx = args.indexOf("--signing-key");
const signingKeyPath = skIdx !== -1 ? args[skIdx + 1] : null;

const anchorDir = path.join(import.meta.dirname, "..");
const result = JSON.parse(fs.readFileSync(path.join(anchorDir, "anchor-result.json"), "utf8"));
const rootData = JSON.parse(fs.readFileSync(path.join(anchorDir, "partition-root.json"), "utf8"));

if (!result.ok) { console.error("Anchor tx failed. Not emitting."); process.exit(1); }

const notes = `ledger.anchor: pass \u2014 Partition anchored to XRPL ${result.network}\n${JSON.stringify({ txHash: result.txHash, network: result.network, walletAddress: result.walletAddress, partitionId: rootData.partitionId, partitionStart: rootData.partitionStart, partitionEnd: rootData.partitionEnd, eventCount: rootData.eventCount, merkleRoot: rootData.root, algo: rootData.algo, prev: rootData.prev || null, range: rootData.range || null })}`;

const artifacts = [{ name: `anchor-${rootData.partitionId}.json`, sha256: rootData.root, uri: `https://testnet.xrpl.org/transactions/${result.txHash}` }];

const ev = buildAttestationEvent({
  repo: "mcp-tool-shop-org/repomesh",
  version: rootData.partitionId.replace(/[^a-zA-Z0-9.-]/g, "-"),
  commit: "0000000",
  artifacts,
  attestations: [{ type: "ledger.anchor", uri: `xrpl:tx:${result.txHash}` }],
  notes
});

const signed = sign ? signEvent(ev, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev;
if (out) writeJsonlLine(out, signed);
console.log(`Anchor event emitted: partition=${rootData.partitionId} tx=${result.txHash}`);
if (out) console.log(`Written to: ${out}`);
