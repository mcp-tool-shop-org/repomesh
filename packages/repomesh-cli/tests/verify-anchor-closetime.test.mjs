// Regression test for the rung-1 close-time source (contract §5.2): verifyAnchorTx must thread out
// the XRPL ledger close-time of the anchor tx, derived from txData.date (Ripple epoch seconds) via
// new Date((rippleEpochSeconds + 946684800) * 1000). This is the only TRUSTWORTHY clock for the
// key-lifecycle compromise decision; the CLI online resolver consumes it as the 'xrpl' source.
//
// TEST-FIRST: on the PRE-FIX verifyAnchorTx (which returned { ok, account, memo } with NO closeTime)
// these assertions are RED; GREEN after the closeTime addition.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }
const { canonicalize } = await import(toURL(resolve(srcDir, "verify", "canonicalize.mjs")));
const { merkleRootHex } = await import(toURL(resolve(srcDir, "verify", "merkle.mjs")));
const { verifyAnchorTx } = await import(toURL(resolve(srcDir, "verify", "verify-anchor.mjs")));

const TRUSTED = "rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W";
function strToHex(s) { return Buffer.from(s, "utf8").toString("hex").toUpperCase(); }

// Build a fake validated tx result with a given Ripple-epoch `date` and a matching anchor memo.
function fakeTx({ date }) {
  const leaf = crypto.createHash("sha256").update("leaf-a").digest("hex");
  const root = merkleRootHex([leaf]);
  const manifestBase = {
    v: 1, algo: "sha256-merkle-v1", partitionId: "all", network: "testnet",
    prev: null, range: [leaf, leaf], count: 1, root,
  };
  const manifestHash = crypto.createHash("sha256").update(canonicalize(manifestBase), "utf8").digest("hex");
  const memo = { v: 1, p: "all", n: "testnet", r: root, h: manifestHash, c: 1, pv: "0", rg: "0" };
  return {
    Account: TRUSTED,
    validated: true,
    date, // Ripple epoch seconds (or undefined to test the null fallback)
    meta: { TransactionResult: "tesSUCCESS" },
    Memos: [{ Memo: { MemoType: strToHex("repomesh-anchor-v1"), MemoData: strToHex(JSON.stringify(memo)) } }],
  };
}

function clientFactory(txResult) {
  return () => ({
    async connect() {}, async disconnect() {},
    async request() { return { result: txResult }; },
  });
}

describe("verify-anchor closeTime (contract §5.2 rung-1)", () => {
  it("returns the tx ledger close-time as a Date derived from the Ripple epoch", async () => {
    // 2026-06-17T00:00:00Z. Ripple epoch offset is 946684800s.
    const unixSec = Math.floor(Date.parse("2026-06-17T00:00:00Z") / 1000);
    const rippleSec = unixSec - 946684800;
    const r = await verifyAnchorTx({
      tx: "TX-1", network: "testnet",
      clientFactory: clientFactory(fakeTx({ date: rippleSec })),
    });
    assert.equal(r.ok, true, "validated trusted-account tx must verify");
    assert.ok(r.closeTime instanceof Date, "closeTime must be a Date");
    assert.equal(r.closeTime.toISOString(), "2026-06-17T00:00:00.000Z",
      "closeTime must equal new Date((rippleEpochSeconds + 946684800) * 1000)");
  });

  it("yields closeTime:null when the tx carries no usable date", async () => {
    const r = await verifyAnchorTx({
      tx: "TX-2", network: "testnet",
      clientFactory: clientFactory(fakeTx({ date: undefined })),
    });
    assert.equal(r.ok, true);
    assert.equal(r.closeTime, null, "a missing/non-numeric date must yield closeTime:null (fall back to offline ladder)");
  });
});
