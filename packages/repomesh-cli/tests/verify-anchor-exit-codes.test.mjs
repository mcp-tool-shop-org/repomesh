// Stage C — verify-anchor exit-code classification (STGB-CLI-004).
//
// The exit-code contract for CI gating:
//   0 = anchor verified · 1 = a real trust FAIL (anchor mismatch / forged / not-trusted account)
//   2 = operator/environment ERROR (XRPL outage / timeout / unreachable / bad config)
//
// STGB-CLI-004: verify-anchor previously exited 1 for a TRANSIENT XRPL outage, conflating an
// outage with tamper. A network/unreachable/timeout condition must exit 2 (ERROR), matching how
// verify-release classifies a load/network failure as ERROR rather than a trust FAIL. A REAL
// anchor mismatch (root/manifestHash/account/algo failure) stays exit 1.
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
  tmpRoot = fs.mkdtempSync(join(os.tmpdir(), "repomesh-vaec-"));
  fs.mkdirSync(join(tmpRoot, "ledger", "events"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "registry"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "schemas"), { recursive: true });
  fs.mkdirSync(join(tmpRoot, "anchor", "xrpl"), { recursive: true });
  fs.writeFileSync(join(tmpRoot, "anchor", "xrpl", "config.json"), JSON.stringify({
    network: "testnet", rippledUrl: "wss://example", trustedAnchorAccounts: [TRUSTED],
  }));
}

// Build a ledger + a memo whose root either MATCHES (ok) or MISMATCHES (tamper) the local ledger.
function buildLedgerAndMemo({ account = TRUSTED, txResult = "tesSUCCESS", validated = true, tamperRoot = false } = {}) {
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
  const memoRoot = tamperRoot ? "f".repeat(64) : root;
  const memo = { v: 1, p: "all", n: "testnet", r: memoRoot, h: manifestHash, c: 1, pv: "0", rg: "0", algo: "sha256-merkle-v1" };
  const fakeTxResult = {
    Account: account, validated, meta: { TransactionResult: txResult },
    Memos: [{ Memo: { MemoType: strToHex("repomesh-anchor-v1"), MemoData: strToHex(JSON.stringify(memo)) } }],
  };
  return { fakeTxResult };
}
function fakeClientFactory(fakeTxResult) {
  return () => ({ async connect() {}, async disconnect() {}, async request() { return { result: fakeTxResult }; } });
}
function offlineClientFactory() {
  return () => ({
    async connect() { throw new Error("getaddrinfo ENOTFOUND s.altnet.rippletest.net"); },
    async disconnect() {}, async request() { throw new Error("not connected"); },
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

describe("STGB-CLI-004: XRPL outage is an ERROR (exit 2), not a trust FAIL (exit 1)", () => {
  it("transient outage => exit 2 (ERROR), distinct from tamper", async () => {
    const { exitCode, result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet", json: true }, offlineClientFactory());
    assert.equal(exitCode, 2, "an XRPL outage must classify as an environment ERROR -> exit 2");
    assert.equal(result?.ok, false);
    assert.match((result.error || "").toLowerCase(), /network|unreachable|could not reach|connect/, "error framed as network");
    assert.ok(typeof result.hint === "string" && result.hint.length > 0, "carries a recovery hint");
  });

  it("human outage path prints a Hint and exits 2", async () => {
    const { exitCode, err } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet", json: false }, offlineClientFactory());
    assert.equal(exitCode, 2, "outage -> exit 2 in human mode too");
    assert.match(err, /Hint:/, "friendly hint line present");
  });

  it("a REAL anchor root mismatch stays a trust FAIL => exit 1 (not downgraded)", async () => {
    const { fakeTxResult } = buildLedgerAndMemo({ tamperRoot: true });
    const { exitCode, result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet", json: true }, fakeClientFactory(fakeTxResult));
    assert.equal(exitCode, 1, "a root MISMATCH is a real trust FAIL -> exit 1, never 2");
    assert.equal(result?.ok, false);
  });

  it("a non-trusted Account stays a trust FAIL => exit 1", async () => {
    const { fakeTxResult } = buildLedgerAndMemo({ account: "rEVILACCOUNTxxxxxxxxxxxxxxxxxxxxxx" });
    const { exitCode } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet", json: true }, fakeClientFactory(fakeTxResult));
    assert.equal(exitCode, 1, "untrusted anchor account is a trust FAIL -> exit 1");
  });

  it("a clean matching anchor verifies => exit 0", async () => {
    const { fakeTxResult } = buildLedgerAndMemo({});
    const { exitCode, result } = await runVerifyAnchor({ tx: "T".repeat(64), network: "testnet", json: true }, fakeClientFactory(fakeTxResult));
    // The success path returns normally (no explicit process.exit), which is exit 0 in the real
    // process. In the harness a clean return leaves exitCode === null (process.exit never called).
    assert.ok(exitCode === 0 || exitCode === null, "a matching anchor verifies -> exit 0 (clean return)");
    assert.equal(result?.ok, true);
  });
});
