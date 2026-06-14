// Stage C — verify-anchor graceful degradation + legibility.
//   B-DEG-01 — an offline / websocket failure yields FRIENDLY network guidance
//              (mirroring verify-release's hint), NOT a raw rippled/websocket stack.
//   B-FP-01  — an unknown/future merkle algo reports 'unsupported ... upgrade CLI',
//              distinct from a 'MISMATCH' (which implies tampering).
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
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-vad-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "anchor", "xrpl"), { recursive: true });
  fs.writeFileSync(join(tmpRoot, "anchor", "xrpl", "config.json"), JSON.stringify({
    network: "testnet", rippledUrl: "wss://example", trustedAnchorAccounts: [TRUSTED],
  }));
}

function buildLedgerAndMemo(account, txResult, validated, algo = "sha256-merkle-v1") {
  const leaf = crypto.createHash("sha256").update("leaf-a").digest("hex");
  const ev = {
    type: "ReleasePublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
    timestamp: "2026-01-01T00:00:00Z", artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }],
    attestations: [], signature: { alg: "ed25519", keyId: "k", value: "AA==", canonicalHash: leaf },
  };
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"), JSON.stringify(ev) + "\n");
  const root = merkleRootHex([leaf]); // root always computed with v1 leaves
  const manifestBase = {
    v: 1, algo: "sha256-merkle-v1", partitionId: "all", network: "testnet",
    prev: null, range: [leaf, leaf], count: 1, root,
  };
  const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
  // memo.algo can CLAIM a future algorithm to exercise the unsupported-algo path.
  const memo = { v: 1, p: "all", n: "testnet", r: root, h: manifestHash, c: 1, pv: "0", rg: "0", algo };
  const fakeTxResult = {
    Account: account, validated, meta: { TransactionResult: txResult },
    Memos: [{ Memo: { MemoType: strToHex("repomesh-anchor-v1"), MemoData: strToHex(JSON.stringify(memo)) } }],
  };
  return { fakeTxResult };
}
function fakeClientFactory(fakeTxResult) {
  return () => ({
    async connect() {}, async disconnect() {},
    async request() { return { result: fakeTxResult }; },
  });
}
// A client factory that throws as if the websocket connection failed.
function offlineClientFactory() {
  return () => ({
    async connect() { throw new Error("getaddrinfo ENOTFOUND s.altnet.rippletest.net"); },
    async disconnect() {},
    async request() { throw new Error("not connected"); },
  });
}

async function runVerifyAnchor(args, clientFactory) {
  const { verifyAnchor } = await import(toURL(resolve(srcDir, "verify", "verify-anchor.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let exitCode = null, out = "", err = "";
  process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
  process.cwd = () => tmpRoot;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = (m) => { err += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  try { await verifyAnchor({ _clientFactory: clientFactory, ...args }); }
  catch (e) { if (e.message !== "__EXIT__") throw e; }
  finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch {} }
  return { exitCode, out, err, result };
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("B-DEG-01: verify-anchor offline => friendly guidance, not a raw websocket stack", () => {
  it("--json offline error carries a hint, no raw ENOTFOUND/websocket leak in the error", async () => {
    const { exitCode, result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet", json: true }, offlineClientFactory());
    assert.equal(result?.ok, false);
    assert.equal(exitCode, 1);
    assert.ok(typeof result.hint === "string" && result.hint.length > 0, "offline failure must carry a friendly hint");
    assert.match(result.error.toLowerCase(), /network|unreachable|offline|connect|could not reach/, "error must be framed as a network problem");
  });

  it("human offline error prints a friendly hint line, not a bare rippled error", async () => {
    const { err } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet", json: false }, offlineClientFactory());
    assert.match(err, /Hint:/, "human offline path must print a Hint line");
  });
});

describe("B-FP-01: verify-anchor unknown algo => 'unsupported merkle algo' (not MISMATCH)", () => {
  it("reports an unsupported-algo upgrade hint, distinct from a tamper MISMATCH", async () => {
    const { fakeTxResult } = buildLedgerAndMemo(TRUSTED, "tesSUCCESS", true, "sha256-merkle-v99");
    const { exitCode, result, out } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet", json: true }, fakeClientFactory(fakeTxResult));
    assert.equal(result?.ok, false, "an unverifiable algo must still fail closed");
    assert.equal(exitCode, 1);
    const blob = JSON.stringify(result).toLowerCase();
    assert.match(blob, /unsupported merkle algo/, "must name the unsupported algo");
    assert.ok(/upgrade/i.test(blob) || /upgrade/i.test(out), "must hint to upgrade the CLI");
    assert.doesNotMatch(blob, /mismatch/, "must NOT claim MISMATCH (would imply tampering)");
  });
});
