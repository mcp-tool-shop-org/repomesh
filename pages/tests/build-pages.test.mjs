// Pages domain — FC9 (/repos browse) + FC10 (per-version proof pages).
//
// These tests probe the PURE render functions exported by build-pages.mjs:
//   - buildRepoRows(trust, anchors)         → forward-compat row objects (the data shape #17 query API reuses)
//   - renderReposIndex(rows)                → /repos/index.html body (server-rendered table + client search/filter/sort)
//   - buildProofChain(entry, anchorRec)     → ordered, plain-language proof-chain steps
//   - renderVersionPage({entry, org, name, anchorRec, anchorTx}) → per-version deep page body
//
// Stage A invariant under test: every ledger-derived string is esc()'d (no unescaped
// interpolation), and these functions are ADDITIVE — they read trust verdicts, never change them.
//
// build-pages.mjs guards its disk-writing main behind a "run directly" check, so importing it
// here is side-effect-free.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRepoRows,
  renderReposIndex,
  buildProofChain,
  renderVersionPage,
  esc,
  npxVerifyCommand,
} from "../build-pages.mjs";

// --- Fixtures (mirror the real trust.json shapes) ---
const trust = [
  {
    repo: "mcp-tool-shop-org/shipcheck",
    version: "1.0.4",
    commit: "12a73e4efe722510df604892631301a5d2b6ae87",
    timestamp: "2026-02-28T05:05:35.855Z",
    integrityScore: 100,
    assuranceScore: 100,
    verdict: "VERIFIED",
    trustSummary: "VERIFIED (integrity 100/100) — all required checks satisfied",
    attestations: [
      { kind: "signature.chain", result: "pass", reason: "Signature verified against mcp-tool-shop (ci-shipcheck-2026)" },
      { kind: "sbom.present", result: "pass", reason: "Release includes SBOM attestation" },
      { kind: "license.audit", result: "pass", reason: "All 0 component licenses are in the allowlist" },
      { kind: "security.scan", result: "pass", reason: "No dependencies in SBOM; zero attack surface." },
    ],
    disputes: [],
  },
  {
    repo: "mcp-tool-shop-org/shipcheck",
    version: "1.0.3",
    commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    timestamp: "2026-02-27T00:00:00.000Z",
    integrityScore: 100,
    assuranceScore: 40,
    verdict: "PARTIAL",
    trustSummary: "PARTIAL — SBOM missing",
    attestations: [
      { kind: "signature.chain", result: "pass", reason: "Signature verified against mcp-tool-shop (ci-shipcheck-2026)" },
      { kind: "sbom.present", result: "fail", reason: "No SBOM attestation found in release event" },
      { kind: "license.audit", result: "warn", reason: "SBOM missing from ReleasePublished attestations; cannot audit licenses." },
    ],
    disputes: [],
  },
];
const anchors = {
  partitions: [],
  releaseAnchors: {
    "mcp-tool-shop-org/shipcheck@1.0.4": {
      repo: "mcp-tool-shop-org/shipcheck",
      version: "1.0.4",
      canonicalHash: "5643ef59ff7c8e65ee312573b92c9a32e75c91dfea791f8f5b1ddc2c7784f898",
      partitionId: "2026-02-28",
      root: "d9cc5dd2119c4fcee417e072c3594b86b9a206e4d03a7749cf1c35dde146c78b",
      manifestHash: "75823866313cf7c78ff5d57814f1c6c57629b086844a19c81cecd8e48ed643c1",
      txHash: null,
      network: "testnet",
    },
  },
};

// ============================ FC9 — /repos browse ============================
describe("FC9 — buildRepoRows (forward-compat data shape)", () => {
  it("emits one row per (repo,version) with the contract columns", () => {
    const rows = buildRepoRows(trust, anchors);
    assert.equal(rows.length, 2, "one row per trust entry");
    const r = rows.find((x) => x.version === "1.0.4");
    assert.ok(r, "1.0.4 row present");
    // FC9 columns: repo, integrity, assurance, anchored, last release
    assert.equal(r.repo, "mcp-tool-shop-org/shipcheck");
    assert.equal(r.version, "1.0.4");
    assert.equal(r.integrity, 100);
    assert.equal(r.assurance, 100);
    // STGB-SP-001 (Stage C honesty fix): "anchored" now means ON-CHAIN anchored — the
    // partition record exists AND carries a real txHash. The 1.0.4 fixture record has
    // txHash:null, so it is NOT anchored; it is in the distinct "pending" state. This
    // assertion previously baked in the bug (expected anchored:true for a txHash:null record).
    assert.equal(r.anchored, false, "1.0.4 record has txHash:null → NOT on-chain anchored");
    assert.equal(r.anchorState, "pending", "membership without on-chain tx is the honest 'pending' state");
    assert.equal(r.timestamp, "2026-02-28T05:05:35.855Z");
  });

  it("marks a release with no anchor record as not anchored (none state)", () => {
    const rows = buildRepoRows(trust, anchors);
    const r = rows.find((x) => x.version === "1.0.3");
    assert.equal(r.anchored, false);
    assert.equal(r.anchorState, "none", "no partition record at all → 'none', not 'pending'");
  });

  it("carries the verdict through unchanged (additive — never mutates trust verdicts)", () => {
    const rows = buildRepoRows(trust, anchors);
    assert.equal(rows.find((x) => x.version === "1.0.4").verdict, "VERIFIED");
    assert.equal(rows.find((x) => x.version === "1.0.3").verdict, "PARTIAL");
  });

  it("is forward-compatible: rows serialize to JSON the future query API can reuse", () => {
    const rows = buildRepoRows(trust, anchors);
    const json = JSON.parse(JSON.stringify(rows));
    assert.equal(json[0].repo, rows[0].repo);
    // No functions / circular refs — plain data.
    assert.deepEqual(Object.keys(json[0]).sort(), Object.keys(rows[0]).sort());
  });
});

describe("FC9 — renderReposIndex (server-rendered table + client controls)", () => {
  it("server-renders a table row for every repo row (works with JS disabled)", () => {
    const rows = buildRepoRows(trust, anchors);
    const html = renderReposIndex(rows);
    assert.match(html, /<table/, "has a table");
    assert.match(html, /1\.0\.4/, "renders v1.0.4 server-side");
    assert.match(html, /1\.0\.3/, "renders v1.0.3 server-side");
    // Column headers per contract.
    assert.match(html, /Integrity/i);
    assert.match(html, /Assurance/i);
    assert.match(html, /Anchored/i);
  });

  it("includes a search input and sortable headers (client controls present)", () => {
    const html = renderReposIndex(buildRepoRows(trust, anchors));
    assert.match(html, /id="repo-search"/, "search box present");
    assert.match(html, /data-sort=/, "sortable column markers present");
    assert.match(html, /data-filter=/, "filter control present");
  });

  it("embeds the row data as a forward-compat JSON island for client JS / future query API", () => {
    const html = renderReposIndex(buildRepoRows(trust, anchors));
    assert.match(html, /id="repos-data"/, "JSON data island present");
    assert.match(html, /application\/json/, "typed as application/json");
  });

  it("escapes ledger-derived strings — a malicious repo name cannot inject markup", () => {
    const evil = [
      {
        repo: "evil/<script>alert(1)</script>",
        version: '"><img src=x onerror=alert(1)>',
        commit: "deadbeef",
        timestamp: "2026-01-01T00:00:00.000Z",
        integrityScore: 0,
        assuranceScore: 0,
        verdict: "UNVERIFIED",
        attestations: [],
        disputes: [],
      },
    ];
    const html = renderReposIndex(buildRepoRows(evil, { partitions: [], releaseAnchors: {} }));
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, "raw <script> must not appear");
    // The real injection vector is an UNESCAPED <img ...> tag. esc() turns < and > into
    // entities, so a raw img tag must not appear (the inert escaped text "onerror=alert"
    // surviving inside &lt;img&gt; is harmless).
    assert.doesNotMatch(html, /<img[^>]*onerror=/i, "raw <img onerror> tag must not appear");
    assert.match(html, /&lt;script&gt;/, "script tag is escaped");
  });
});

// ====================== FC10 — per-version proof pages ======================
describe("FC10 — buildProofChain (plain-language signature→anchor)", () => {
  it("orders the chain signature → attestations → anchor → XRPL tx", () => {
    const entry = trust[0];
    const rec = anchors.releaseAnchors["mcp-tool-shop-org/shipcheck@1.0.4"];
    const chain = buildProofChain(entry, rec);
    const labels = chain.map((s) => s.title.toLowerCase());
    const iSig = labels.findIndex((l) => l.includes("signature") || l.includes("signed"));
    const iAtt = labels.findIndex((l) => l.includes("attestation") || l.includes("check"));
    const iAnchor = labels.findIndex((l) => l.includes("anchor") || l.includes("merkle"));
    assert.ok(iSig >= 0 && iAtt >= 0 && iAnchor >= 0, "all three stages present");
    assert.ok(iSig < iAtt, "signature before attestations");
    assert.ok(iAtt < iAnchor, "attestations before anchor");
  });

  it("reflects the not-yet-on-chain state honestly (txHash null → 'not yet anchored')", () => {
    const entry = trust[0];
    const rec = anchors.releaseAnchors["mcp-tool-shop-org/shipcheck@1.0.4"]; // txHash null
    const chain = buildProofChain(entry, rec);
    const anchorStep = chain.find((s) => s.title.toLowerCase().includes("anchor"));
    assert.match(anchorStep.detail.toLowerCase(), /not yet anchored|awaiting/, "honest pending state");
  });

  it("does not invent an XRPL tx link when there is no txHash", () => {
    const rec = anchors.releaseAnchors["mcp-tool-shop-org/shipcheck@1.0.4"];
    const chain = buildProofChain(trust[0], rec);
    const anchorStep = chain.find((s) => s.title.toLowerCase().includes("anchor"));
    assert.equal(anchorStep.txLink, null, "no fabricated tx link");
  });

  it("emits an XRPL explorer link when a txHash exists", () => {
    const rec = { ...anchors.releaseAnchors["mcp-tool-shop-org/shipcheck@1.0.4"], txHash: "ABCDEF0123456789" };
    const chain = buildProofChain(trust[0], rec);
    const anchorStep = chain.find((s) => s.title.toLowerCase().includes("anchor"));
    assert.ok(anchorStep.txLink && anchorStep.txLink.includes("ABCDEF0123456789"), "tx link contains the hash");
  });
});

describe("FC10 — npxVerifyCommand (FC2 canonical command)", () => {
  it("emits the npx form, not node tools/repomesh.mjs", () => {
    const cmd = npxVerifyCommand("mcp-tool-shop-org/shipcheck", "1.0.4", true);
    assert.match(cmd, /npx @mcptoolshop\/repomesh verify-release/);
    assert.match(cmd, /--repo mcp-tool-shop-org\/shipcheck/);
    assert.match(cmd, /--version 1\.0\.4/);
    assert.match(cmd, /--anchored/);
    assert.doesNotMatch(cmd, /node tools\/repomesh\.mjs/, "must NOT use the old node form");
  });

  it("omits --anchored for an un-anchored release", () => {
    const cmd = npxVerifyCommand("mcp-tool-shop-org/shipcheck", "1.0.3", false);
    assert.doesNotMatch(cmd, /--anchored/);
  });
});

describe("FC10 — renderVersionPage (badge landing 'what this proves')", () => {
  const entry = trust[0];
  const rec = anchors.releaseAnchors["mcp-tool-shop-org/shipcheck@1.0.4"];
  const opts = { entry, org: "mcp-tool-shop-org", name: "shipcheck", anchorRec: rec };

  it("renders a human 'what this proves' page with the verdict and proof chain", () => {
    const html = renderVersionPage(opts);
    assert.match(html, /1\.0\.4/, "version present");
    assert.match(html, /VERIFIED/, "verdict surfaced");
    assert.match(html, /signature/i, "proof chain signature step present");
    assert.match(html, /anchor/i, "proof chain anchor step present");
  });

  it("includes the copy-paste npx verify command (FC2)", () => {
    const html = renderVersionPage(opts);
    assert.match(html, /npx @mcptoolshop\/repomesh verify-release/);
    assert.match(html, /copy-wrap/, "rendered as a copy block");
  });

  it("escapes ALL ledger-derived strings (Stage A invariant — no regression)", () => {
    const evilEntry = {
      ...entry,
      version: '1.0.4"><script>alert(1)</script>',
      commit: "<img src=x onerror=alert(1)>",
      trustSummary: "VERIFIED <script>steal()</script>",
      attestations: [
        { kind: "signature.chain", result: "pass", reason: "signed by <script>evil</script>" },
      ],
    };
    const evilRec = { ...rec, txHash: '"><script>alert(2)</script>', root: "<b>x</b>" };
    const html = renderVersionPage({ entry: evilEntry, org: "mcp-tool-shop-org", name: "shipcheck", anchorRec: evilRec });
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<script>alert\(2\)<\/script>/);
    assert.doesNotMatch(html, /<script>steal\(\)<\/script>/);
    assert.doesNotMatch(html, /onerror=alert/);
    assert.match(html, /&lt;script&gt;/, "ledger strings are HTML-escaped");
  });

  it("does not change the trust verdict (additive): UNVERIFIED stays UNVERIFIED", () => {
    const unv = {
      ...entry,
      verdict: "UNVERIFIED",
      integrityScore: 0,
      assuranceScore: 0,
      trustSummary: "UNVERIFIED — required check missing",
      // an unverified release would not carry a passing signature step
      attestations: [{ kind: "signature.chain", result: "fail", reason: "no independent witness" }],
    };
    const html = renderVersionPage({ entry: unv, org: "mcp-tool-shop-org", name: "shipcheck", anchorRec: null });
    assert.match(html, /UNVERIFIED/, "renders the UNVERIFIED verdict");
    // The verdict badge must carry the verbatim verdict — the page never recomputes/upgrades it.
    assert.match(html, /class="score score-red"[^>]*>UNVERIFIED</, "verdict badge shows UNVERIFIED (red), not upgraded");
  });
});
