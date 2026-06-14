// Anchor domain — Stage C/D humanization amend tests.
// Probes the legibility/degradation fixes that DON'T touch trust correctness:
//   ANC-B06  resolvePartition signals a `since:` fallback (fellBack:true) when the boundary anchor
//            marker is missing, so the caller can WARN instead of silently widening the partition.
//   ANC-B07  post-anchor.mjs documents the testnet->mainnet migration route in-code.
//   ANC-B05  post-anchor.mjs exits non-zero (process.exitCode) when an XRPL submission is not
//            tesSUCCESS (andon halt) — asserted at the source level (no live XRPL in tests).
//   ANC-B01  verify-anchor.mjs translates a purged/unreachable tx into operator guidance + the local
//            root, exiting cleanly — asserted at the source level (no live XRPL in tests).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePartition } from "../scripts/verify-anchor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFY_ANCHOR = path.join(HERE, "..", "scripts", "verify-anchor.mjs");
const POST_ANCHOR = path.join(HERE, "..", "scripts", "post-anchor.mjs");

function anchorEvent(ts) {
  return {
    type: "AttestationPublished",
    timestamp: ts,
    attestations: [{ type: "ledger.anchor", uri: "x" }],
    signature: { canonicalHash: "a".repeat(64) },
  };
}
function release(ts) {
  return { type: "ReleasePublished", timestamp: ts, signature: { canonicalHash: "b".repeat(64) } };
}

describe("ANC-B06 resolvePartition `since:` fallback signal", () => {
  it("does NOT flag a fallback when the boundary anchor marker is present", () => {
    const events = [anchorEvent("2026-03-01T00:00:00.000Z"), release("2026-03-02T00:00:00.000Z")];
    const r = resolvePartition(events, "since:2026-03-01T00:00:00.000Z");
    assert.equal(r.fellBack, false, "boundary present -> no fallback");
    assert.equal(r.events.length, 1, "partition starts AFTER the boundary anchor");
    assert.equal(r.events[0].type, "ReleasePublished");
  });

  it("FLAGS a fallback (fellBack:true) and widens to the full ledger when the boundary marker is MISSING", () => {
    // No anchor event at the requested timestamp -> the old code silently returned the full ledger.
    const events = [release("2026-03-02T00:00:00.000Z"), release("2026-03-03T00:00:00.000Z")];
    const r = resolvePartition(events, "since:2026-03-01T99:99:99.999Z");
    assert.equal(r.fellBack, true, "a missing boundary marker MUST be flagged, not silently widened");
    assert.equal(r.events.length, events.length, "fallback widens to the full ledger");
  });

  it("never flags a fallback for all/genesis/date partitions", () => {
    const events = [release("2026-03-02T00:00:00.000Z")];
    assert.equal(resolvePartition(events, "all").fellBack, false);
    assert.equal(resolvePartition(events, "genesis").fellBack, false);
    assert.equal(resolvePartition(events, "2026-03-02").fellBack, false);
  });
});

// Source-level assertions for the network/process fixes (no live XRPL connection in unit tests).
describe("ANC-B01 verify-anchor friendly tx-not-found / unreachable guidance", () => {
  const src = fs.readFileSync(VERIFY_ANCHOR, "utf8");
  it("catches a tx-fetch error and prints recovery guidance (purged/unreachable), not a raw stack", () => {
    assert.ok(/not found on/i.test(src), "must print 'not found on <network>' guidance");
    assert.ok(/purged after a testnet reset/i.test(src), "must mention the testnet-reset purge cause");
    assert.ok(/local manifest root is/i.test(src), "must surface the local manifest root for the operator");
    assert.ok(/localManifestRoot/.test(src), "must compute a local root for the message");
  });
  it("catches a connect failure separately from a tx-not-found failure", () => {
    assert.ok(/Could not connect to the XRPL network/i.test(src),
      "an unreachable rippled endpoint must get its own legible message");
  });
});

describe("ANC-B05 post-anchor andon halt on submission failure", () => {
  const src = fs.readFileSync(POST_ANCHOR, "utf8");
  it("sets a non-zero exit code when the XRPL submission is not tesSUCCESS", () => {
    assert.ok(/process\.exitCode\s*=\s*1/.test(src),
      "a non-tesSUCCESS submission must fail the step (non-zero exit)");
    assert.ok(/NOT anchored on-chain/i.test(src), "must explain that nothing landed on-chain");
  });
});

describe("ANC-B07 testnet->mainnet migration documented in post-anchor.mjs", () => {
  const src = fs.readFileSync(POST_ANCHOR, "utf8");
  it("documents the config switch (network + rippledUrl) and what changes", () => {
    assert.ok(/TESTNET\s*→\s*MAINNET MIGRATION/i.test(src), "must have a migration section");
    assert.ok(/"network":\s*"mainnet"/.test(src), "must show the network config switch");
    assert.ok(/trustedAnchorAccounts/.test(src), "must mention adding the mainnet wallet to the allowlist");
    assert.ok(/XRPL_SEED/.test(src), "must mention the funded mainnet wallet seed");
  });
});
