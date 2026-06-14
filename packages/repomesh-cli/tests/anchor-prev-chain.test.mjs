// CLI-007: verify-anchor walks + VALIDATES the prev-root chain rather than just
// printing it. We drive a fake XRPL client returning a memo whose `pv` (prev root)
// either resolves to a known prior anchor in the local ledger, or doesn't.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }
const { canonicalize } = await import(toURL(resolve(srcDir, "verify", "canonicalize.mjs")));
const { merkleRootHex } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));

const TRUSTED = "rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W";
function strToHex(s) { return Buffer.from(s, "utf8").toString("hex").toUpperCase(); }

let tmpRoot;
function setupRoot() {
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-chain-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "anchor", "xrpl"), { recursive: true });
  fs.writeFileSync(join(tmpRoot, "anchor", "xrpl", "config.json"), JSON.stringify({
    network: "testnet", rippledUrl: "wss://example", trustedAnchorAccounts: [TRUSTED],
  }));
}
function fakeClientFactory(fakeTxResult) {
  return () => ({ async connect() {}, async disconnect() {}, async request() { return { result: fakeTxResult }; } });
}
async function runVerifyAnchor(args, fakeTxResult) {
  const { verifyAnchor } = await import(toURL(resolve(srcDir, "verify", "verify-anchor.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const oExit = process.exit, oCwd = process.cwd, oLog = console.log, oErr = console.error;
  let exitCode = null, out = "";
  process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
  process.cwd = () => tmpRoot;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try { await verifyAnchor({ json: true, _clientFactory: fakeClientFactory(fakeTxResult), ...args }); }
  catch (e) { if (e.message !== "__EXIT__") throw e; }
  finally { process.exit = oExit; process.cwd = oCwd; console.log = oLog; console.error = oErr; }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch {} }
  return { exitCode, out, result };
}

// Build: a prior anchor over partition "2026-01-01" (1 leaf) recorded in the ledger
// with merkleRoot = prevRoot, plus a current anchor (memo) over "2026-01-02" whose pv = prevRoot.
function buildChained({ linkPrev }) {
  const leafA = crypto.createHash("sha256").update("leaf-a").digest("hex");
  const evA = {
    type: "ReleasePublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
    timestamp: "2026-01-01T00:00:00Z", artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }],
    attestations: [], signature: { alg: "ed25519", keyId: "k", value: "AA==", canonicalHash: leafA },
  };
  const prevRoot = merkleRootHex([leafA]);
  // a prior anchor event recording prevRoot
  const priorAnchor = {
    type: "AttestationPublished", repo: "org/app", version: "0.0.0-genesis", commit: "0000000",
    timestamp: "2026-01-01T12:00:00Z", artifacts: [{ name: "x", sha256: "c".repeat(64), uri: "x" }],
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:PRIOR" }],
    notes: "ledger.anchor: pass\n" + JSON.stringify({ merkleRoot: prevRoot, prev: null, manifestPath: "anchor/xrpl/manifests/p.json" }),
    signature: { alg: "ed25519", keyId: "k", value: "AA==", canonicalHash: "d".repeat(64) },
  };

  const leafB = crypto.createHash("sha256").update("leaf-b").digest("hex");
  const evB = {
    type: "ReleasePublished", repo: "org/app", version: "2.0.0", commit: "beef000",
    timestamp: "2026-01-02T00:00:00Z", artifacts: [{ name: "b", sha256: "b".repeat(64), uri: "x" }],
    attestations: [], signature: { alg: "ed25519", keyId: "k", value: "AA==", canonicalHash: leafB },
  };
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"),
    [evA, priorAnchor, evB].map(e => JSON.stringify(e)).join("\n") + "\n");

  const curRoot = merkleRootHex([leafB]);
  const manifestBase = { v: 1, algo: "sha256-merkle-v1", partitionId: "2026-01-02", network: "testnet",
    prev: linkPrev ? prevRoot : "deadbeef".repeat(8), range: [leafB, leafB], count: 1, root: curRoot };
  const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
  const memo = { v: 1, p: "2026-01-02", n: "testnet", r: curRoot, h: manifestHash, c: 1,
    pv: linkPrev ? prevRoot : "deadbeef".repeat(8) };
  return {
    fakeTxResult: {
      Account: TRUSTED, validated: true, meta: { TransactionResult: "tesSUCCESS" },
      Memos: [{ Memo: { MemoType: strToHex("repomesh-anchor-v1"), MemoData: strToHex(JSON.stringify(memo)) } }],
    },
  };
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("CLI-007: prev-root chain is validated, not just printed", () => {
  it("reports chainVerified=true when prev resolves to a known prior anchor", async () => {
    const { fakeTxResult } = buildChained({ linkPrev: true });
    const { result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet" }, fakeTxResult);
    assert.equal(result?.ok, true);
    assert.equal(result?.chainVerified, true, "prev should resolve to the prior anchor");
  });

  it("reports chainVerified=false when prev points to an UNKNOWN root", async () => {
    const { fakeTxResult } = buildChained({ linkPrev: false });
    const { result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet" }, fakeTxResult);
    // The anchor itself still verifies (root + manifestHash match), but the chain link is unverified.
    assert.equal(result?.chainVerified, false, "dangling prev should be flagged unverified");
    assert.ok(result?.chainReason, "should carry a chain reason");
  });
});
