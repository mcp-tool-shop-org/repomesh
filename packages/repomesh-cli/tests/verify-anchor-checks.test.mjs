// D4 + CLI-007 + CLI-008 tests for verify-anchor.mjs (standalone command).
// We inject a fake XRPL client so we can drive validated / TransactionResult /
// Account into specific values WITHOUT a live ledger connection.
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
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-va-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "anchor", "xrpl"), { recursive: true });
  fs.writeFileSync(join(tmpRoot, "anchor", "xrpl", "config.json"), JSON.stringify({
    network: "testnet", rippledUrl: "wss://example", trustedAnchorAccounts: [TRUSTED],
  }));
}

// Build a single-leaf partition + matching memo. leaf is an arbitrary 64-hex.
function buildLedgerAndMemo(account, txResult, validated) {
  const leaf = crypto.createHash("sha256").update("leaf-a").digest("hex");
  const ev = {
    type: "ReleasePublished", repo: "org/app", version: "1.0.0", commit: "abcdef0",
    timestamp: "2026-01-01T00:00:00Z", artifacts: [{ name: "a", sha256: "a".repeat(64), uri: "x" }],
    attestations: [], signature: { alg: "ed25519", keyId: "k", value: "AA==", canonicalHash: leaf },
  };
  fs.writeFileSync(join(tmpRoot, "ledger", "events", "events.jsonl"), JSON.stringify(ev) + "\n");
  const root = merkleRootHex([leaf]);
  const manifestBase = {
    v: 1, algo: "sha256-merkle-v1", partitionId: "all", network: "testnet",
    prev: null, range: [leaf, leaf], count: 1, root,
  };
  const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
  const memo = { v: 1, p: "all", n: "testnet", r: root, h: manifestHash, c: 1, pv: "0", rg: "0" };
  const fakeTxResult = {
    Account: account,
    validated,
    meta: { TransactionResult: txResult },
    Memos: [{ Memo: { MemoType: strToHex("repomesh-anchor-v1"), MemoData: strToHex(JSON.stringify(memo)) } }],
  };
  return { fakeTxResult };
}

// Fake xrpl client factory honoring the injected tx result.
function fakeClientFactory(fakeTxResult) {
  return () => ({
    async connect() {},
    async disconnect() {},
    async request() { return { result: fakeTxResult }; },
  });
}

async function runVerifyAnchor(args, fakeTxResult) {
  const { verifyAnchor } = await import(toURL(resolve(srcDir, "verify", "verify-anchor.mjs")) + `?t=${Date.now()}${Math.random()}`);
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let exitCode = null, out = "";
  process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
  process.cwd = () => tmpRoot;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  try { await verifyAnchor({ json: true, _clientFactory: fakeClientFactory(fakeTxResult), ...args }); }
  catch (e) { if (e.message !== "__EXIT__") throw e; }
  finally { process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr; }
  let result = null;
  const blobs = out.match(/\{[\s\S]*\}/g);
  if (blobs) { try { result = JSON.parse(blobs[blobs.length - 1]); } catch {} }
  return { exitCode, out, result };
}

beforeEach(() => setupRoot());
afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

describe("verify-anchor: XRPL soundness checks (ANC-001/002 + CLI-008)", () => {
  it("rejects a tx whose Account is NOT in trustedAnchorAccounts", async () => {
    const { fakeTxResult } = buildLedgerAndMemo("rATTACKERwallet000000000000000000", "tesSUCCESS", true);
    const { exitCode, result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet" }, fakeTxResult);
    assert.equal(result?.ok, false, "untrusted Account must be rejected");
    assert.equal(exitCode, 1);
  });

  it("rejects a tx that is not validated", async () => {
    const { fakeTxResult } = buildLedgerAndMemo(TRUSTED, "tesSUCCESS", false);
    const { result, exitCode } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet" }, fakeTxResult);
    assert.equal(result?.ok, false, "unvalidated tx must be rejected");
    assert.equal(exitCode, 1);
  });

  it("rejects a tx whose TransactionResult is not tesSUCCESS", async () => {
    const { fakeTxResult } = buildLedgerAndMemo(TRUSTED, "tecPATH_PARTIAL", true);
    const { result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet" }, fakeTxResult);
    assert.equal(result?.ok, false, "failed tx must be rejected");
  });

  it("accepts a fully valid anchor from a trusted account", async () => {
    const { fakeTxResult } = buildLedgerAndMemo(TRUSTED, "tesSUCCESS", true);
    const { result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet" }, fakeTxResult);
    assert.equal(result?.ok, true, `valid anchor should pass; got ${JSON.stringify(result)}`);
  });
});
