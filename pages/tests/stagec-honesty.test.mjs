// Stage C — HUMANIZATION: trust-honesty + legibility regressions.
//
// These tests pin the corrected behavior of the public trust DASHBOARD:
//   FIX 1 (STGB-SP-001) — a release is "Anchored on XRPL" ONLY when its mapped partition
//                         has a real on-chain txHash. A partition record with txHash:null is
//                         a distinct "Pending anchor" state, NOT the green on-chain badge.
//   FIX 2 (STGB-SP-002) — the canonical verify command is the npx form, and --anchored is
//                         only ever suggested when it is truthful (a real txHash exists).
//   FIX 4 (STGB-SP-005/006) — verdict legibility + a render path for DISPUTED / policy-violation
//                         (trust-negative) releases instead of a blank/misleading empty state.
//
// Ethos: honesty over flattery — never show more trust than earned. The load-bearing
// regression is "txHash:null ⇒ NOT 'Anchored on XRPL'".

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRepoRows,
  renderReposIndex,
  npxVerifyCommand,
  releaseAnchorState,
  anchorStateBadge,
  renderLatestReleaseCard,
  renderHealthHero,
} from "../build-pages.mjs";

// A partition record that EXISTS but has never been posted on-chain (txHash null) — the exact
// live-data shape that produced the false "Anchored on XRPL" badge.
const pendingRec = {
  repo: "mcp-tool-shop-org/shipcheck",
  version: "1.0.4",
  partitionId: "2026-02-28",
  root: "d9cc5dd2119c4fcee417e072c3594b86b9a206e4d03a7749cf1c35dde146c78b",
  txHash: null,
  network: "testnet",
};
// A partition record actually recorded on-chain.
const onChainRec = { ...pendingRec, txHash: "1A285823A2BECEC69C88A75595B1CC7A2E51FA68D5DACF37AB7E59A95E2A65D1" };

const trust = [
  {
    repo: "mcp-tool-shop-org/shipcheck",
    version: "1.0.4",
    commit: "12a73e4efe722510df604892631301a5d2b6ae87",
    timestamp: "2026-02-28T05:05:35.855Z",
    integrityScore: 100,
    assuranceScore: 100,
    verdict: "VERIFIED",
    attestations: [],
    disputes: [],
  },
];
const anchorsPending = {
  partitions: [],
  releaseAnchors: { "mcp-tool-shop-org/shipcheck@1.0.4": pendingRec },
};
const anchorsOnChain = {
  partitions: [],
  releaseAnchors: { "mcp-tool-shop-org/shipcheck@1.0.4": onChainRec },
};

// ============ FIX 1 — STGB-SP-001: the load-bearing honesty regression ============
describe("FIX 1 (STGB-SP-001) — txHash:null must NOT read as 'Anchored on XRPL'", () => {
  it("releaseAnchorState classifies the three honest states", () => {
    assert.equal(releaseAnchorState(null), "none", "no partition record → none");
    assert.equal(releaseAnchorState(undefined), "none");
    assert.equal(releaseAnchorState(pendingRec), "pending", "record but txHash null → pending");
    assert.equal(releaseAnchorState(onChainRec), "anchored", "record + real txHash → anchored");
  });

  it("buildRepoRows: a txHash:null partition record is NOT anchored (was the bug)", () => {
    const rows = buildRepoRows(trust, anchorsPending);
    const r = rows.find((x) => x.version === "1.0.4");
    assert.equal(r.anchored, false, "REGRESSION: membership without on-chain txHash is NOT anchored");
    assert.equal(r.anchorState, "pending", "distinct honest 'pending' state");
  });

  it("buildRepoRows: a real on-chain txHash IS anchored", () => {
    const rows = buildRepoRows(trust, anchorsOnChain);
    const r = rows.find((x) => x.version === "1.0.4");
    assert.equal(r.anchored, true);
    assert.equal(r.anchorState, "anchored");
  });

  it("/repos table: pending row does NOT render the green 'Anchored' on-chain badge", () => {
    const html = renderReposIndex(buildRepoRows(trust, anchorsPending));
    // The row's anchor cell must not claim on-chain anchoring.
    assert.doesNotMatch(html, /score-green[^>]*>\s*Anchored\s*</, "no false green Anchored badge");
    assert.match(html, /Pending|Not yet/i, "honest pending/not-yet state present");
    // The data attribute that drives the client filter must agree it is not anchored.
    assert.match(html, /data-anchored="0"/, "data-anchored reflects not-on-chain");
  });

  it("/repos table: on-chain row DOES render the green 'Anchored' badge", () => {
    const html = renderReposIndex(buildRepoRows(trust, anchorsOnChain));
    assert.match(html, /score-green[^>]*>\s*Anchored\s*</, "green Anchored badge for real tx");
    assert.match(html, /data-anchored="1"/);
  });

  it("anchorStateBadge: pending never emits the green on-chain badge; anchored does", () => {
    const pending = anchorStateBadge("pending");
    assert.doesNotMatch(pending, /score-green/, "pending is not green");
    assert.match(pending, /Pending|not yet/i);
    const anchored = anchorStateBadge("anchored");
    assert.match(anchored, /score-green/, "anchored is green");
    assert.match(anchored, /Anchored on XRPL|Anchored/);
  });

  it("home Latest-Release card: txHash:null release does NOT show 'Anchored on XRPL'", () => {
    const html = renderLatestReleaseCard(trust[0], anchorsPending);
    assert.doesNotMatch(html, /score-green[^>]*>[^<]*Anchored on XRPL/, "no false on-chain claim on home");
    assert.match(html, /Pending anchor|not yet anchored/i, "honest pending state on home");
  });

  it("home Latest-Release card: on-chain release DOES show the green anchored badge", () => {
    const html = renderLatestReleaseCard(trust[0], anchorsOnChain);
    assert.match(html, /score-green/, "green badge for a real on-chain tx");
  });

  it("health hero: txHash:null latest release does NOT show 'Anchored on XRPL' green", () => {
    const latestRelease = {
      repo: "mcp-tool-shop-org/shipcheck",
      version: "1.0.4",
      integrity: 100,
      assurance: 100,
      timestamp: "2026-02-28T05:05:35.855Z",
      commit: "12a73e4efe722510df604892631301a5d2b6ae87",
      anchorState: "pending",
    };
    const html = renderHealthHero(latestRelease);
    assert.doesNotMatch(html, /score-green[^>]*>[^<]*Anchored on XRPL/, "hero must not overstate trust");
    assert.match(html, /Pending anchor|not yet anchored/i, "honest pending state in hero");
  });
});

// ============ FIX 2 — STGB-SP-002: canonical command, truthful --anchored ============
describe("FIX 2 (STGB-SP-002) — health hero emits canonical npx, no false --anchored", () => {
  it("npxVerifyCommand never emits the deprecated node tools/repomesh.mjs form", () => {
    const cmd = npxVerifyCommand("mcp-tool-shop-org/shipcheck", "1.0.4", false);
    assert.match(cmd, /npx @mcptoolshop\/repomesh verify-release/);
    assert.doesNotMatch(cmd, /node tools\/repomesh\.mjs/);
  });

  it("health hero copy block uses npx, NOT node tools/repomesh.mjs, and omits --anchored when pending", () => {
    const latestRelease = {
      repo: "mcp-tool-shop-org/shipcheck",
      version: "1.0.4",
      integrity: 100,
      assurance: 100,
      timestamp: "2026-02-28T05:05:35.855Z",
      commit: "12a73e4efe722510df604892631301a5d2b6ae87",
      anchorState: "pending",
    };
    const html = renderHealthHero(latestRelease);
    assert.match(html, /npx @mcptoolshop\/repomesh verify-release/, "canonical npx command");
    assert.doesNotMatch(html, /node tools\/repomesh\.mjs/, "deprecated node form gone");
    assert.doesNotMatch(html, /--anchored/, "no false --anchored claim when txHash is null");
  });

  it("health hero suggests --anchored ONLY when the release is truly on-chain", () => {
    const latestRelease = {
      repo: "mcp-tool-shop-org/shipcheck",
      version: "1.0.4",
      integrity: 100,
      assurance: 100,
      timestamp: "2026-02-28T05:05:35.855Z",
      commit: "12a73e4efe722510df604892631301a5d2b6ae87",
      anchorState: "anchored",
    };
    const html = renderHealthHero(latestRelease);
    assert.match(html, /--anchored/, "truthful --anchored for an on-chain release");
  });
});

// ============ FIX 4 — STGB-SP-005/006: verdict legibility + DISPUTED render path ============
describe("FIX 4 (STGB-SP-005) — verdict badge on every home Latest-Release card", () => {
  it("renders a PARTIAL verdict badge so the trust state is legible", () => {
    const partial = {
      repo: "mcp-tool-shop-org/repomesh",
      version: "2.0.0",
      commit: "717b80218893b05610b9703951de9c75dc197495",
      timestamp: "2026-06-14T20:01:15.802Z",
      integrityScore: 45,
      assuranceScore: 0,
      verdict: "PARTIAL",
      attestations: [],
      disputes: [],
    };
    const html = renderLatestReleaseCard(partial, { partitions: [], releaseAnchors: {} });
    assert.match(html, /score-yellow[^>]*>\s*PARTIAL\s*</, "PARTIAL verdict badge present (yellow)");
  });

  it("renders a VERIFIED verdict badge", () => {
    const html = renderLatestReleaseCard(trust[0], anchorsOnChain);
    assert.match(html, /score-green[^>]*>\s*VERIFIED\s*</, "VERIFIED verdict badge present (green)");
  });
});

describe("FIX 4 (STGB-SP-006) — DISPUTED / policy-violation releases render a trust-negative state", () => {
  const disputed = {
    repo: "mcp-tool-shop-org/repomesh",
    version: "2.0.1",
    commit: "abc123",
    timestamp: "2026-06-15T00:00:00.000Z",
    integrityScore: 30,
    assuranceScore: 0,
    verdict: "DISPUTED",
    disputed: true,
    disputes: [{ reason: "Maintainer flagged a forged signature", by: "mcp-tool-shop-org/repomesh" }],
    policyViolations: [{ policy: "no-unsigned-release", detail: "Release published without a verified signature." }],
    attestations: [],
  };

  it("home card: DISPUTED verdict badge reads red (trust-negative legibility)", () => {
    const html = renderLatestReleaseCard(disputed, { partitions: [], releaseAnchors: {} });
    assert.match(html, /score-red[^>]*>\s*DISPUTED\s*</, "DISPUTED badge present and red");
  });

  it("home card: a dispute / policy violation is surfaced, not silently dropped", () => {
    const html = renderLatestReleaseCard(disputed, { partitions: [], releaseAnchors: {} });
    assert.match(html, /dispute|policy/i, "trust-negative state is visible to a human");
  });
});
