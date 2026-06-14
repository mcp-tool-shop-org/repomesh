#!/usr/bin/env node
// RepoMesh Pages Generator — Builds static HTML site from registry artifacts.
// Output: pages/out/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "registry");
const OUT_DIR = path.join(import.meta.dirname, "out");
const ASSETS_DIR = path.join(import.meta.dirname, "assets");

// Base path for GitHub Pages (matches repo name)
const BASE = "/repomesh";

// FC2 canonical command: the public verify path is `npx @mcptoolshop/repomesh ...` —
// NEVER a `git clone` + `node tools/repomesh.mjs`. All copy-blocks the Pages emit (home
// hero, per-repo, per-version) use this single source so the documented contract can't drift.
const NPX_PKG = "npx @mcptoolshop/repomesh";

// Public site origin for absolute links (badge → landing). The badges in README link here.
const SITE_ORIGIN = "https://mcp-tool-shop-org.github.io/repomesh";

// XRPL explorer base (testnet — matches anchor network in the ledger). A txHash deep-links
// to the on-chain transaction so a reader can independently confirm the anchor exists.
const XRPL_EXPLORER = "https://testnet.xrpl.org/transactions";

// SB-PAGES-01: a value is the WRONG SHAPE when it parses as valid JSON but its top-level
// type doesn't match what the generator expects (e.g. a truncated/half-written artifact
// that lands as `null`, `{}` where an array is wanted, or `[]` where an object is wanted).
// Returning such a value would crash the build downstream (`.map`/`.filter`/`for…of` on a
// non-iterable, property access on null). We compare the loaded value's coarse type to the
// fallback's and reject mismatches — turning a truncated write into a clean defaults-and-warn
// instead of a build crash.
function shapeMatches(value, fallback) {
  if (value === null || value === undefined) return false;
  const wantArray = Array.isArray(fallback);
  const gotArray = Array.isArray(value);
  if (wantArray !== gotArray) return false;
  if (!wantArray && typeof value !== "object") return false; // fallback is an object; value must be too
  return true;
}

// Safe JSON loader — returns fallback on missing file, parse error, OR wrong top-level
// shape (B-1, B-6, SB-PAGES-01).
function safeLoadJSON(filePath, fallback, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`[pages] Warning: ${label} not found at ${filePath}, using defaults`);
    return fallback;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`[pages] Warning: Failed to parse ${label} at ${filePath}: ${err.message}. Using defaults.`);
    return fallback;
  }
  if (!shapeMatches(parsed, fallback)) {
    console.error(`[pages] Warning: ${label} at ${filePath} has the wrong shape ` +
      `(expected ${Array.isArray(fallback) ? "array" : "object"}, got ${parsed === null ? "null" : (Array.isArray(parsed) ? "array" : typeof parsed)}). ` +
      `Possibly a truncated write — using defaults.`);
    return fallback;
  }
  return parsed;
}

// --- Helpers ---

function scoreClass(score) {
  if (score >= 80) return "score-green";
  if (score >= 50) return "score-yellow";
  return "score-red";
}

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortHash(h) {
  return h ? h.slice(0, 12) + "..." : "—";
}

// Stage D (ANC-B02 display legibility): a partition whose `txHash` is null is NOT "local" —
// it means the partition's Merkle root has been computed and committed, but the on-chain
// XRPL transaction has not been recorded yet. Render that state as a human-readable
// "not yet anchored" rather than a bare null / blank / misleading "local" token. When a
// txHash IS present, show the truncated on-chain tx id.
function anchorTxText(txHash, len = 12) {
  return txHash ? esc(txHash.slice(0, len)) + "..." : "not yet anchored on-chain";
}
function anchorTxBadge(txHash) {
  return txHash
    ? `<span class="score score-green" title="On-chain XRPL transaction recorded">On-chain</span>`
    : `<span class="score" style="background:rgba(139,148,158,0.15);color:var(--text-muted)" title="Merkle root committed locally; awaiting the next XRPL anchor cycle">Not yet anchored</span>`;
}

function copyBlock(cmd) {
  return `<div class="copy-wrap"><button class="copy-btn">Copy</button><pre>${esc(cmd)}</pre></div>`;
}

function layout(title, body, breadcrumbs) {
  const bc = breadcrumbs ? `<div style="margin-bottom:1rem;font-size:0.85rem;color:var(--text-muted)">${breadcrumbs}</div>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — RepoMesh</title>
<link rel="stylesheet" href="${BASE}/assets/style.css">
</head>
<body>
<div class="container">
<header>
  <h1>RepoMesh</h1>
  <p>Syntropic repo network — public trust index</p>
  <nav>
    <a href="${BASE}/">Home</a>
    <a href="${BASE}/repos/">Browse</a>
    <a href="${BASE}/anchors/">Anchors</a>
    <a href="${BASE}/health/">Dashboard</a>
    <a href="https://github.com/mcp-tool-shop-org/repomesh">GitHub</a>
    <a href="${BASE}/docs/verification.html">Docs</a>
  </nav>
</header>
${bc}
${body}
<footer>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></footer>
</div>
<script src="${BASE}/assets/main.js"></script>
</body>
</html>`;
}

// ============================================================================
// PURE RENDER FUNCTIONS (exported, side-effect-free, unit-tested)
// These read trust verdicts; they NEVER mutate them. Stage A invariant: every
// ledger-derived string flows through esc() before it lands in HTML.
// ============================================================================

// FC2 — the one canonical verify command. Pure string; no clone, no node form.
export function npxVerifyCommand(repo, version, anchored) {
  return `${NPX_PKG} verify-release --repo ${repo} --version ${version}${anchored ? " --anchored" : ""}`;
}

// A release is "anchored" iff anchors.releaseAnchors has a record for repo@version.
function anchorRecordFor(anchors, repo, version) {
  const key = `${repo}@${version}`;
  return anchors?.releaseAnchors?.[key] ?? null;
}

// FC9 — forward-compat row shape. ONE object per (repo,version). This is the exact
// data the future query API (#17) reuses: plain JSON, stable keys, no derived markup.
// Columns the contract names: repo, integrity, assurance, anchored, last release.
export function buildRepoRows(trust, anchors) {
  const rows = [];
  for (const e of Array.isArray(trust) ? trust : []) {
    const rec = anchorRecordFor(anchors, e.repo, e.version);
    rows.push({
      repo: e.repo,
      version: e.version,
      integrity: e.integrityScore ?? 0,
      assurance: e.assuranceScore ?? 0,
      anchored: !!rec,
      verdict: e.verdict ?? "UNVERIFIED",
      timestamp: e.timestamp ?? null,
      commit: e.commit ?? null,
      // forward-compat: a stable canonical link the query API + clients can dereference.
      href: e.repo && e.version ? `${BASE}/repos/${e.repo}/${encodeURIComponent(e.version)}/` : null,
      txHash: rec?.txHash ?? null,
    });
  }
  return rows;
}

// Verdict → score class. UNVERIFIED/DISPUTED/FAIL read red; PARTIAL yellow; VERIFIED green.
// (Display only — does not influence the verdict.)
function verdictClass(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "VERIFIED" || v === "PASS") return "score-green";
  if (v === "PARTIAL") return "score-yellow";
  return "score-red"; // UNVERIFIED, DISPUTED, FAIL, unknown
}

// FC9 — /repos browse page body. Server-renders the full table (works with JS disabled)
// AND embeds the row data as a JSON island so the vanilla-JS search/filter/sort can operate
// client-side with no framework. esc() guards every ledger-derived cell.
export function renderReposIndex(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];

  // Server-rendered <tbody>. Each <tr> carries data-* attributes the client JS reads for
  // filtering/sorting without re-parsing cell text.
  const bodyRows = safeRows.map((r) => {
    const [org, name] = String(r.repo || "").split("/");
    const repoHref = org && name ? `${BASE}/repos/${esc(org)}/${esc(name)}/` : "#";
    const verHref = r.href ? esc(r.href) : repoHref;
    return `<tr class="repo-row"
  data-repo="${esc(r.repo)}"
  data-version="${esc(r.version)}"
  data-integrity="${esc(r.integrity)}"
  data-assurance="${esc(r.assurance)}"
  data-anchored="${r.anchored ? "1" : "0"}"
  data-verdict="${esc(r.verdict)}"
  data-timestamp="${esc(r.timestamp)}">
  <td><a href="${repoHref}">${esc(r.repo)}</a></td>
  <td><a href="${verHref}">${esc(r.version)}</a></td>
  <td><span class="score ${verdictClass(r.verdict)}" title="Trust verdict">${esc(r.verdict)}</span></td>
  <td><span class="score ${scoreClass(r.integrity)}">${esc(r.integrity)}/100</span></td>
  <td><span class="score ${scoreClass(r.assurance)}">${esc(r.assurance)}/100</span></td>
  <td>${r.anchored
        ? `<span class="score score-green" title="Included in an XRPL-anchored partition">Anchored</span>`
        : `<span class="score" style="background:rgba(139,148,158,0.15);color:var(--text-muted)" title="Not yet anchored on XRPL">Not yet</span>`}</td>
  <td class="card-meta">${esc(r.timestamp)}</td>
</tr>`;
  }).join("\n");

  // Forward-compat JSON island. The client JS reads this; a future query API (#17) can
  // serve the SAME array. esc() is NOT applied to the JSON text itself — JSON.stringify
  // produces a safe string, and we additionally neutralize the only HTML-breaking sequence
  // ("</") so the data can't terminate the <script> element early (XSS via JSON island).
  const dataJson = JSON.stringify(safeRows).replace(/</g, "\\u003c");

  let html = `<h2>Trust Index — Browse Repos</h2>
<p style="color:var(--text-muted);margin-bottom:1rem">Every release tracked by the network, with its trust verdict, integrity &amp; assurance scores, and anchor status. Search, filter, and sort below — the table works with JavaScript disabled.</p>

<div class="browse-controls">
  <input type="search" id="repo-search" placeholder="Search repo or version…" aria-label="Search repos">
  <label class="browse-filter">Anchored:
    <select id="repo-filter-anchored" data-filter="anchored">
      <option value="">all</option>
      <option value="1">anchored</option>
      <option value="0">not yet</option>
    </select>
  </label>
  <label class="browse-filter">Verdict:
    <select id="repo-filter-verdict" data-filter="verdict">
      <option value="">all</option>
      <option value="VERIFIED">VERIFIED</option>
      <option value="PARTIAL">PARTIAL</option>
      <option value="UNVERIFIED">UNVERIFIED</option>
      <option value="DISPUTED">DISPUTED</option>
    </select>
  </label>
</div>

<table id="repos-table">
  <thead>
    <tr>
      <th data-sort="repo" data-type="text" role="button" tabindex="0">Repo</th>
      <th data-sort="version" data-type="text" role="button" tabindex="0">Version</th>
      <th data-sort="verdict" data-type="text" role="button" tabindex="0">Verdict</th>
      <th data-sort="integrity" data-type="num" role="button" tabindex="0">Integrity</th>
      <th data-sort="assurance" data-type="num" role="button" tabindex="0">Assurance</th>
      <th data-sort="anchored" data-type="num" role="button" tabindex="0">Anchored</th>
      <th data-sort="timestamp" data-type="text" role="button" tabindex="0">Last Release</th>
    </tr>
  </thead>
  <tbody id="repos-tbody">
${bodyRows || `<tr><td colspan="7" class="card-meta">No releases tracked yet.</td></tr>`}
  </tbody>
</table>
<p id="repos-empty" class="card-meta" hidden>No repos match your search.</p>

<script type="application/json" id="repos-data">${dataJson}</script>`;

  return html;
}

// FC10 — plain-language proof chain: signature → attestations → anchor → XRPL tx.
// Returns an ordered array of {title, detail, status, txLink}. ALL strings are esc()'d at
// render time (callers must esc); here we keep raw data + build the (safe) tx URL only when
// a real txHash exists — we never fabricate a link (FC7 honesty doctrine).
export function buildProofChain(entry, anchorRec) {
  const atts = Array.isArray(entry?.attestations) ? entry.attestations : [];
  const sig = atts.find((a) => a.kind === "signature.chain");
  const nonSig = atts.filter((a) => a.kind !== "signature.chain");

  const steps = [];

  // 1. Signature — who signed this release, and did it verify against the allowlisted key.
  steps.push({
    title: "1. Signature",
    detail: sig
      ? sig.reason || `Signature ${sig.result}.`
      : "No signature.chain attestation on this release.",
    status: sig ? sig.result : "missing",
    txLink: null,
  });

  // 2. Attestations — the independent checks (SBOM, provenance, license, security) and what
  // each one concluded. Plain-language: each is a separate, named claim about the release.
  const attDetail = nonSig.length
    ? nonSig.map((a) => `${a.kind}: ${a.result}${a.reason ? " — " + a.reason : ""}`).join("\n")
    : "No additional attestations recorded.";
  const attStatus = nonSig.some((a) => a.result === "fail")
    ? "fail"
    : nonSig.some((a) => a.result === "warn")
      ? "warn"
      : nonSig.length ? "pass" : "missing";
  steps.push({
    title: "2. Attestations",
    detail: attDetail,
    status: attStatus,
    txLink: null,
    items: nonSig.map((a) => ({ kind: a.kind, result: a.result, reason: a.reason || "" })),
  });

  // 3. Anchor / XRPL — the Merkle root that includes this release, and (only if recorded) the
  // on-chain transaction. txHash null is reported honestly as "not yet anchored on-chain".
  const tx = anchorRec?.txHash || null;
  const anchorDetail = !anchorRec
    ? "This release is not yet included in an anchored partition."
    : tx
      ? `Included in partition ${anchorRec.partitionId} (Merkle root ${String(anchorRec.root || "").slice(0, 16)}…), recorded on XRPL.`
      : `Included in partition ${anchorRec.partitionId} (Merkle root ${String(anchorRec.root || "").slice(0, 16)}…). Root committed; not yet anchored on-chain (awaiting the next XRPL anchor cycle).`;
  steps.push({
    title: "3. Anchor (XRPL)",
    detail: anchorDetail,
    status: tx ? "pass" : anchorRec ? "pending" : "missing",
    // Build the explorer URL ONLY for a real txHash. encodeURIComponent guards the path
    // segment; the caller still esc()'s the rendered href text.
    txLink: tx ? `${XRPL_EXPLORER}/${encodeURIComponent(tx)}` : null,
    txHash: tx,
    root: anchorRec?.root || null,
    partitionId: anchorRec?.partitionId || null,
  });

  return steps;
}

// Map a proof-chain step status to a score class for the badge.
function stepStatusClass(status) {
  if (status === "pass") return "score-green";
  if (status === "warn" || status === "pending") return "score-yellow";
  return "score-red"; // fail / missing
}

// FC10 — per-version deep page body: the human "what this proves" landing a README badge
// click resolves to. Renders the verdict, the proof chain, and the copy-paste npx command.
// esc() on EVERY ledger-derived string (Stage A invariant).
export function renderVersionPage({ entry, org, name, anchorRec }) {
  const repo = entry.repo;
  const version = entry.version;
  const anchored = !!anchorRec;
  const chain = buildProofChain(entry, anchorRec);

  let body = `<h2>${esc(repo)} <span style="color:var(--text-muted)">@</span> ${esc(version)}</h2>`;

  // Verdict banner — surfaced verbatim from trust.json, never recomputed here.
  body += `<div class="card">
  <div class="badge-row">
    <span class="score ${verdictClass(entry.verdict)}" style="font-size:1rem">${esc(entry.verdict)}</span>
    <span class="score ${scoreClass(entry.integrityScore)}">Integrity ${esc(entry.integrityScore)}/100</span>
    <span class="score ${scoreClass(entry.assuranceScore)}">Assurance ${esc(entry.assuranceScore)}/100</span>
  </div>
  ${entry.trustSummary ? `<div class="card-meta" style="margin-top:0.5rem">${esc(entry.trustSummary)}</div>` : ""}
  <div class="card-meta" style="margin-top:0.35rem">${esc(entry.timestamp)} &middot; commit ${esc(String(entry.commit || "").slice(0, 12))}</div>
</div>`;

  // What this proves — the plain-language chain.
  body += `<h3>What this proves</h3>`;
  body += `<p style="color:var(--text-muted);margin-bottom:0.75rem">This release was checked along a chain of independent steps. Each step below is a separate, verifiable claim — you can re-run the whole chain yourself with the command at the bottom.</p>`;
  body += `<div class="proof-chain">`;
  for (const step of chain) {
    body += `<div class="proof-step">
  <div class="proof-step-head">
    <span class="score ${stepStatusClass(step.status)}">${esc(step.status)}</span>
    <strong>${esc(step.title)}</strong>
  </div>
  <div class="proof-step-detail">${esc(step.detail)}</div>`;
    // Attestation sub-rows (legible, escaped).
    if (Array.isArray(step.items) && step.items.length) {
      body += `<table style="margin-top:0.5rem"><tr><th>Check</th><th>Result</th><th>Reason</th></tr>`;
      for (const it of step.items) {
        const cls = it.result === "pass" ? "score-green" : it.result === "warn" ? "score-yellow" : "score-red";
        body += `<tr><td>${esc(it.kind)}</td><td><span class="score ${cls}">${esc(it.result)}</span></td><td class="card-meta">${esc(it.reason)}</td></tr>`;
      }
      body += `</table>`;
    }
    // XRPL tx deep link — ONLY when a real txHash exists.
    if (step.txLink) {
      body += `<div style="margin-top:0.5rem"><a href="${esc(step.txLink)}" rel="noopener noreferrer">View on XRPL explorer →</a> <span class="hash">tx ${esc(String(step.txHash).slice(0, 24))}…</span></div>`;
    }
    if (step.root) {
      body += `<div class="hash" style="margin-top:0.35rem">Merkle root: ${esc(step.root)}</div>`;
    }
    body += `</div>`;
  }
  body += `</div>`;

  // Verify it yourself — FC2 npx command.
  body += `<h3>Verify it yourself</h3>`;
  body += `<p style="color:var(--text-muted);margin-bottom:0.5rem">No clone required. Run:</p>`;
  body += copyBlock(npxVerifyCommand(repo, version, anchored));

  // Back link to the repo page.
  body += `<p style="margin-top:1rem"><a href="${BASE}/repos/${esc(org)}/${esc(name)}/">← All ${esc(repo)} releases</a></p>`;

  return body;
}

// ============================================================================
// SIDE-EFFECTING BUILD — runs only when invoked directly (node build-pages.mjs).
// When imported (e.g. by the test suite) this whole block is skipped: no disk
// reads/writes happen and the pure render functions above are exercised in isolation.
// ============================================================================
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {

// Load data
console.error("[pages] Loading registry artifacts...");
const nodes = safeLoadJSON(path.join(REGISTRY_DIR, "nodes.json"), [], "nodes.json");
const trust = safeLoadJSON(path.join(REGISTRY_DIR, "trust.json"), [], "trust.json");
const verifiers = safeLoadJSON(path.join(REGISTRY_DIR, "verifiers.json"), { verifiers: [] }, "verifiers.json");
const anchors = safeLoadJSON(path.join(REGISTRY_DIR, "anchors.json"), { partitions: [], releaseAnchors: {} }, "anchors.json");
const metrics = safeLoadJSON(path.join(REGISTRY_DIR, "metrics.json"), { history: [], current: {}, deltas: {}, latestRelease: null }, "metrics.json");
const timeline = safeLoadJSON(path.join(REGISTRY_DIR, "timeline.json"), { events: [] }, "timeline.json");

// SB-PAGES-01: even when the top-level shape is right, a partially-written object can be
// missing the nested arrays the page iterates over. Coerce them to safe defaults so an
// `{}` anchors.json (top-level object, but no `.partitions`) can't crash `[...partitions]`
// / `for…of` later. (No behavior change when the artifacts are well-formed.)
if (!Array.isArray(anchors.partitions)) anchors.partitions = [];
if (anchors.releaseAnchors == null || typeof anchors.releaseAnchors !== "object") anchors.releaseAnchors = {};
if (!Array.isArray(verifiers.verifiers)) verifiers.verifiers = [];
if (!Array.isArray(metrics.history)) metrics.history = [];
if (!Array.isArray(timeline.events)) timeline.events = [];

// --- Build output dir --- (B-2: progress logging)
console.error("[pages] Building output directory...");
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// Copy assets
const outAssets = path.join(OUT_DIR, "assets");
fs.mkdirSync(outAssets, { recursive: true });
for (const f of fs.readdirSync(ASSETS_DIR)) {
  fs.copyFileSync(path.join(ASSETS_DIR, f), path.join(outAssets, f));
}

// .nojekyll
fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "", "utf8");

// --- Home page --- (B-2)
console.error("[pages] Building home page...");
let homeBody = "";

// FC9: hero CTA → the /repos browse page (was a 404 before this build wave).
homeBody += `<div class="hero-cta-row">
  <a class="cta-primary" href="${BASE}/repos/">Browse Trust Index →</a>
  <a class="cta-secondary" href="${BASE}/health/">Network Dashboard</a>
</div>`;

// Latest releases
homeBody += `<h2>Latest Verified Releases</h2>`;
const byRepo = {};
for (const entry of trust) {
  if (!byRepo[entry.repo] || new Date(entry.timestamp) > new Date(byRepo[entry.repo].timestamp)) {
    byRepo[entry.repo] = entry;
  }
}
for (const [repo, entry] of Object.entries(byRepo)) {
  const [org, name] = repo.split("/");
  const anchorKey = `${repo}@${entry.version}`;
  const isAnchored = !!anchors.releaseAnchors?.[anchorKey];
  const anchorLabel = isAnchored ? `<span class="score score-green">Anchored</span>` : `<span class="score" style="background:rgba(139,148,158,0.15);color:var(--text-muted)">Not anchored</span>`;

  homeBody += `<div class="card">
  <div class="card-title"><a href="${BASE}/repos/${org}/${name}/">${esc(repo)}</a> @ ${esc(entry.version)}</div>
  <div class="card-meta">${esc(entry.timestamp)} &middot; commit ${esc(entry.commit?.slice(0, 7))}</div>
  <div class="badge-row" style="margin-top:0.5rem">
    <span class="score ${scoreClass(entry.integrityScore)}">Integrity ${entry.integrityScore}/100</span>
    <span class="score ${scoreClass(entry.assuranceScore)}">Assurance ${entry.assuranceScore}/100</span>
    ${anchorLabel}
  </div>
</div>`;
}

// Verifier status
homeBody += `<h2>Verifiers</h2>`;
for (const v of verifiers.verifiers) {
  const checks = v.checks.length > 0 ? v.checks.map(c => `<span class="tag">${esc(c)}</span>`).join("") : '<span class="tag">anchor</span>';
  homeBody += `<div class="card">
  <div class="card-title">${esc(v.id)}</div>
  <div class="card-meta">${esc(v.description)}</div>
  <div style="margin-top:0.25rem">${checks}</div>
  <div class="card-meta">Last run: ${esc(v.lastRun || "never")}</div>
</div>`;
}

// Latest anchors (top 3)
homeBody += `<h2>Latest Anchors</h2>`;
const sortedPartitions = [...anchors.partitions].reverse();
for (const p of sortedPartitions.slice(0, 3)) {
  homeBody += `<div class="card">
  <div class="card-title">Partition: ${esc(p.partitionId)}</div>
  <div class="card-meta">Network: ${esc(p.network)} &middot; Events: ${p.count} &middot; ${anchorTxBadge(p.txHash)} ${p.txHash ? `<span class="hash" style="display:inline">TX ${anchorTxText(p.txHash, 16)}</span>` : ""}</div>
  <div class="hash">Root: ${esc(p.root)}</div>
  <div class="hash">ManifestHash: ${esc(p.manifestHash)}</div>
</div>`;
}
homeBody += `<p style="margin-top:0.5rem"><a href="${BASE}/anchors/">View full anchor chain &rarr;</a></p>`;

fs.writeFileSync(path.join(OUT_DIR, "index.html"), layout("Home", homeBody), "utf8");

// --- Anchors page --- (B-2)
console.error("[pages] Building anchor page...");
let anchorsBody = `<h2>Anchor Chain</h2>
<p style="color:var(--text-muted);margin-bottom:1rem">Each anchor binds a ledger partition's Merkle root to the XRP Ledger. Anchors form a linked list via the <code>prev</code> field.</p>`;

anchorsBody += `<table>
<tr><th>Partition</th><th>Count</th><th>Root</th><th>ManifestHash</th><th>Prev</th><th>XRPL Anchor</th></tr>`;
for (const p of anchors.partitions) {
  // Stage D: show an explicit "On-chain / Not yet anchored" badge instead of a bare
  // "local" token so an operator can tell a recorded anchor from a pending one at a glance.
  anchorsBody += `<tr>
  <td>${esc(p.partitionId)}</td>
  <td>${p.count}</td>
  <td class="hash">${shortHash(p.root)}</td>
  <td class="hash">${shortHash(p.manifestHash)}</td>
  <td class="hash">${shortHash(p.prev)}</td>
  <td>${anchorTxBadge(p.txHash)}${p.txHash ? `<br><span class="hash">${anchorTxText(p.txHash, 12)}</span>` : ""}</td>
</tr>`;
}
anchorsBody += `</table>`;

anchorsBody += `<h3>Verify an Anchor</h3>`;
anchorsBody += copyBlock(`git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh\nnode anchor/xrpl/scripts/verify-anchor.mjs --tx <TX_HASH>`);

const anchorsDir = path.join(OUT_DIR, "anchors");
fs.mkdirSync(anchorsDir, { recursive: true });
fs.writeFileSync(path.join(anchorsDir, "index.html"), layout("Anchors", anchorsBody, `<a href="${BASE}/">Home</a> / Anchors`), "utf8");

// --- Dashboard (Health) page --- (B-2)
console.error("[pages] Building health dashboard...");

function trustRingSvg(label, score, color, size = 120) {
  const r = (size - 8) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return `<svg class="trust-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--border)" stroke-width="6"/>
  <circle class="ring-fill" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="6"
    stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${circ.toFixed(1)}"
    stroke-linecap="round" transform="rotate(-90 ${c} ${c})"
    style="--ring-target:${offset.toFixed(1)}"/>
  <text x="${c}" y="${c - 6}" text-anchor="middle" fill="var(--text)" font-size="22" font-weight="700">${score}</text>
  <text x="${c}" y="${c + 14}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${esc(label)}</text>
</svg>`;
}

function sparklineSvg(history, key, w = 80, h = 24) {
  const vals = history.map(s => s[key] ?? 0);
  if (vals.length < 2) return "";
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const pts = vals.map((v, i) =>
    `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
  ).join(" ");
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`;
}

function deltaLabel(d) {
  if (d > 0) return `<span class="delta delta-up">+${d}</span>`;
  if (d < 0) return `<span class="delta delta-down">${d}</span>`;
  return `<span class="delta">&mdash;</span>`;
}

const cur = metrics.current || {};
const del = metrics.deltas || {};
const hist = metrics.history || [];
const latestRelease = metrics.latestRelease;

let healthBody = `<div class="dash-subtitle">Updated on every push. Cryptographically anchored on XRPL.</div>`;

// Hero: Latest Release with trust rings
if (latestRelease) {
  const intColor = latestRelease.integrity >= 80 ? "var(--green)" : latestRelease.integrity >= 50 ? "var(--yellow)" : "var(--red)";
  const assColor = latestRelease.assurance >= 80 ? "var(--green)" : latestRelease.assurance >= 50 ? "var(--yellow)" : "var(--red)";
  // Stage D: an unanchored latest release reads "Not yet anchored on XRPL" rather than a
  // vaguer "Pending anchor", and carries a tooltip explaining what that state means.
  const anchoredBadge = latestRelease.anchored
    ? `<span class="score score-green" title="This release is included in an XRPL-anchored partition">Anchored on XRPL</span>`
    : `<span class="score" style="background:rgba(139,148,158,0.15);color:var(--text-muted)" title="Trust scores are computed; the partition will be anchored on XRPL on the next anchor cycle">Not yet anchored on XRPL</span>`;

  healthBody += `<div class="dash-hero">
  <div class="hero-rings">
    ${trustRingSvg("Integrity", latestRelease.integrity, intColor)}
    ${trustRingSvg("Assurance", latestRelease.assurance, assColor)}
  </div>
  <div class="hero-meta">
    <div class="hero-title">${esc(latestRelease.repo)}@${esc(latestRelease.version)}</div>
    <div class="card-meta">${esc(latestRelease.timestamp)} &middot; commit ${esc(latestRelease.commit?.slice(0, 7))}</div>
    <div class="badge-row" style="margin-top:0.5rem">
      <span class="score ${scoreClass(latestRelease.integrity)}">Integrity ${latestRelease.integrity}/100</span>
      <span class="score ${scoreClass(latestRelease.assurance)}">Assurance ${latestRelease.assurance}/100</span>
      ${anchoredBadge}
    </div>
    <div class="card-meta" style="margin-top:0.35rem">Integrity = is this release authentic? &middot; Assurance = is it safe? (license + vulnerability scans)</div>
    <div class="hero-cta">
      ${copyBlock(`node tools/repomesh.mjs verify-release --repo ${latestRelease.repo} --version ${latestRelease.version}${latestRelease.anchored ? " --anchored" : ""}`)}
    </div>
  </div>
</div>`;
}

// Stat Cards
const statDefs = [
  { label: "Nodes", value: cur.nodes ?? 0, delta: del.nodes, key: "nodes" },
  { label: "Repos", value: cur.repos ?? 0, delta: del.repos, key: "repos" },
  { label: "Releases", value: cur.releases ?? 0, delta: del.releases, key: "releases" },
  { label: "Verifiers", value: cur.verifiers ?? 0, delta: del.verifiers, key: "verifiers" },
  { label: "Partitions", value: cur.partitions ?? 0, delta: del.partitions, key: "partitions" },
  { label: "Anchored", value: cur.anchored ?? 0, delta: del.anchored, key: "anchored" },
  { label: "Avg Integrity", value: cur.avgIntegrity ?? 0, delta: del.avgIntegrity, key: "avgIntegrity" },
  { label: "Avg Assurance", value: cur.avgAssurance ?? 0, delta: del.avgAssurance, key: "avgAssurance" },
];

healthBody += `<div class="stat-grid">`;
for (const s of statDefs) {
  healthBody += `<div class="stat-card">
  <div class="stat-label">${s.label}</div>
  <div class="stat-value">${s.value}</div>
  <div class="stat-footer">${deltaLabel(s.delta)}${sparklineSvg(hist, s.key)}</div>
</div>`;
}
healthBody += `</div>`;

// Timeline Strip
const timelineEvents = timeline.events || [];
if (timelineEvents.length > 0) {
  healthBody += `<h3 style="margin-top:2rem">Network Timeline</h3>`;
  healthBody += `<div class="timeline-strip">`;
  for (const ev of timelineEvents) {
    const pillClass = ev.type === "anchor" ? "pill-anchor" : "pill-release";
    const shortLabel = ev.type === "anchor"
      ? "Anchor"
      : `${(ev.repo || "").split("/")[1] || ev.repo || "?"}@${ev.version}`;
    const detail = ev.type === "anchor"
      ? `data-detail="Partition: ${esc(ev.partitionId)}&#10;Root: ${esc(ev.root)}&#10;ManifestHash: ${esc(ev.manifestHash)}&#10;Events: ${esc(ev.count)}&#10;XRPL anchor: ${ev.txHash ? esc(ev.txHash.slice(0, 16)) + "..." : "not yet anchored on-chain"}&#10;Network: ${esc(ev.network)}"`
      : `data-detail="Repo: ${esc(ev.repo)}&#10;Version: ${esc(ev.version)}&#10;Commit: ${esc(ev.commit?.slice(0, 12))}&#10;Integrity: ${esc(ev.integrity)}/100&#10;Assurance: ${esc(ev.assurance)}/100&#10;Anchored: ${ev.anchored ? "Yes" : "No"}"`;
    healthBody += `<button class="timeline-pill ${pillClass}" ${detail}><span class="pill-dot"></span>${esc(shortLabel)}</button>`;
  }
  healthBody += `</div>`;
  healthBody += `<div id="timeline-detail" class="timeline-detail" hidden></div>`;
}

// Explore Tiles
healthBody += `<h3 style="margin-top:2rem">Explore</h3>`;
healthBody += `<div class="explore-grid">
  <a class="explore-tile" href="${BASE}/repos/">
    <div class="tile-icon">T</div>
    <div class="tile-label">Trust Index</div>
    <div class="tile-desc">Browse all repos and trust scores</div>
  </a>
  <a class="explore-tile" href="${BASE}/anchors/">
    <div class="tile-icon">A</div>
    <div class="tile-label">Anchor Explorer</div>
    <div class="tile-desc">Full anchor chain and XRPL verification</div>
  </a>
  <a class="explore-tile" href="${BASE}/docs/verification.html">
    <div class="tile-icon">D</div>
    <div class="tile-label">Docs</div>
    <div class="tile-desc">Verification guide and CLI reference</div>
  </a>
  <a class="explore-tile" href="https://github.com/mcp-tool-shop-org/repomesh">
    <div class="tile-icon">G</div>
    <div class="tile-label">GitHub</div>
    <div class="tile-desc">Source code, issues, and contributions</div>
  </a>
</div>`;

// Verifier Status (compact grid)
healthBody += `<h3 style="margin-top:2rem">Verifier Status</h3>`;
healthBody += `<div class="verifier-grid">`;
for (const v of verifiers.verifiers) {
  const lastRun = v.lastRun ? new Date(v.lastRun) : null;
  const ageHours = lastRun ? Math.round((Date.now() - lastRun.getTime()) / (1000 * 60 * 60)) : null;
  let status, statusClass;
  if (!lastRun) { status = "Never"; statusClass = "score-red"; }
  else if (ageHours <= 24) { status = `${ageHours}h ago`; statusClass = "score-green"; }
  else if (ageHours <= 168) { status = `${Math.round(ageHours / 24)}d ago`; statusClass = "score-yellow"; }
  else { status = `${Math.round(ageHours / 24)}d ago`; statusClass = "score-red"; }
  const checks = v.checks.length > 0 ? v.checks.map(c => `<span class="tag">${esc(c)}</span>`).join("") : '<span class="tag">anchor</span>';
  healthBody += `<div class="verifier-card">
  <div class="card-title" style="font-size:0.85rem">${esc(v.id.split("/").pop())}</div>
  <div style="margin:0.25rem 0">${checks}</div>
  <span class="score ${statusClass}" style="font-size:0.75rem">${status}</span>
</div>`;
}
healthBody += `</div>`;

// Pending Attestations
const pending = trust.filter(e => e.missingChecks && e.missingChecks.length > 0);
if (pending.length > 0) {
  healthBody += `<h3 style="margin-top:2rem">Pending Attestations</h3>`;
  for (const e of pending) {
    healthBody += `<div class="card" style="padding:0.5rem 0.75rem">
  <span style="font-weight:600;font-size:0.85rem">${esc(e.repo)}@${esc(e.version)}</span>
  ${e.missingChecks.map(c => `<span class="tag" style="background:rgba(248,81,73,0.1);color:var(--red)">${esc(c)}</span>`).join("")}
</div>`;
  }
} else {
  healthBody += `<div style="margin-top:1rem;color:var(--green);font-size:0.85rem">All releases have complete attestations.</div>`;
}

const healthDir = path.join(OUT_DIR, "health");
fs.mkdirSync(healthDir, { recursive: true });
fs.writeFileSync(path.join(healthDir, "index.html"), layout("Network Dashboard", healthBody, `<a href="${BASE}/">Home</a> / Dashboard`), "utf8");

// --- Repo pages --- (B-2)
console.error(`[pages] Building ${nodes.length} repo page(s)...`);
for (const node of nodes) {
  const [org, name] = node.id.split("/");
  const repoDir = path.join(OUT_DIR, "repos", org, name);
  fs.mkdirSync(repoDir, { recursive: true });

  let body = "";
  body += `<h2>${esc(node.id)}</h2>`;
  body += `<div class="card">
  <div class="card-meta">Kind: <strong>${esc(node.kind)}</strong></div>
  <div class="card-meta">${esc(node.description)}</div>
  <div style="margin-top:0.5rem">${(node.provides || []).map(c => `<span class="tag">${esc(c)}</span>`).join("")}</div>
  ${(node.tags || []).length > 0 ? `<div style="margin-top:0.25rem">${node.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
</div>`;

  // Releases for this repo
  const repoReleases = trust.filter(e => e.repo === node.id);
  if (repoReleases.length > 0) {
    body += `<h3>Releases</h3>`;
    for (const entry of repoReleases) {
      const anchorKey = `${entry.repo}@${entry.version}`;
      const isAnchored = !!anchors.releaseAnchors?.[anchorKey];
      const anchorLabel = isAnchored ? `<span class="score score-green">Anchored</span>` : `<span class="score" style="background:rgba(139,148,158,0.15);color:var(--text-muted)">Pending</span>`;

      // FC10: each release links to its per-version deep "what this proves" page.
      const verHref = `${BASE}/repos/${esc(org)}/${esc(name)}/${esc(encodeURIComponent(entry.version))}/`;
      body += `<div class="card">
  <div class="card-title"><a href="${verHref}">v${esc(entry.version)}</a> <span class="score ${verdictClass(entry.verdict)}" style="font-size:0.75rem">${esc(entry.verdict)}</span></div>
  <div class="card-meta">${esc(entry.timestamp)} &middot; commit ${esc(entry.commit?.slice(0, 7))}</div>
  <div class="badge-row" style="margin-top:0.5rem">
    <span class="score ${scoreClass(entry.integrityScore)}">Integrity ${entry.integrityScore}/100</span>
    <span class="score ${scoreClass(entry.assuranceScore)}">Assurance ${entry.assuranceScore}/100</span>
    ${anchorLabel}
  </div>`;

      // Attestation breakdown
      if (entry.attestations.length > 0) {
        body += `<table style="margin-top:0.5rem"><tr><th>Check</th><th>Result</th></tr>`;
        for (const att of entry.attestations) {
          const cls = att.result === "pass" ? "score-green" : att.result === "warn" ? "score-yellow" : "score-red";
          body += `<tr><td>${esc(att.kind)}</td><td><span class="score ${cls}">${esc(att.result)}</span></td></tr>`;
        }
        body += `</table>`;
      }

      body += `<div style="margin-top:0.5rem"><a href="${verHref}">What does this prove? →</a></div>`;
      body += `</div>`;

      // FC10: emit the per-version deep page.
      const verAnchorRec = anchors.releaseAnchors?.[`${entry.repo}@${entry.version}`] ?? null;
      const verDir = path.join(repoDir, encodeURIComponent(entry.version));
      fs.mkdirSync(verDir, { recursive: true });
      const verBody = renderVersionPage({ entry, org, name, anchorRec: verAnchorRec });
      const verCrumb = `<a href="${BASE}/">Home</a> / <a href="${BASE}/repos/">Browse</a> / <a href="${BASE}/repos/${esc(org)}/${esc(name)}/">${esc(node.id)}</a> / ${esc(entry.version)}`;
      fs.writeFileSync(path.join(verDir, "index.html"), layout(`${node.id}@${entry.version}`, verBody, verCrumb), "utf8");
    }

    // Verify commands
    const latest = repoReleases[0];
    const latestAnchorKey = `${latest.repo}@${latest.version}`;
    const latestAnchored = !!anchors.releaseAnchors?.[latestAnchorKey];

    body += `<h3>Verify</h3>`;
    // FC2: npx form, no clone, no `node tools/repomesh.mjs`.
    body += copyBlock(npxVerifyCommand(node.id, latest.version, latestAnchored));

    // Badge embed — FC10: a badge click lands on the per-VERSION "what this proves" page.
    const badgeBase = `https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/${org}/${name}`;
    const latestVerLanding = `${SITE_ORIGIN}/repos/${org}/${name}/${encodeURIComponent(latest.version)}/`;
    body += `<h3>Badges</h3>`;
    body += `<p class="card-meta">Each badge links to the latest release's proof page.</p>`;
    body += `<div class="badge-row">
  <a href="${latestVerLanding}"><img src="${badgeBase}/integrity.svg" alt="Integrity"></a>
  <a href="${latestVerLanding}"><img src="${badgeBase}/assurance.svg" alt="Assurance"></a>
  <a href="${latestVerLanding}"><img src="${badgeBase}/anchored.svg" alt="Anchored"></a>
</div>`;
    body += copyBlock(`[![Integrity](${badgeBase}/integrity.svg)](${latestVerLanding})\n[![Assurance](${badgeBase}/assurance.svg)](${latestVerLanding})\n[![Anchored](${badgeBase}/anchored.svg)](${latestVerLanding})`);
  }

  fs.writeFileSync(path.join(repoDir, "index.html"), layout(node.id, body, `<a href="${BASE}/">Home</a> / <a href="${BASE}/repos/">Browse</a> / <a href="${BASE}/repos/${org}/${name}/">${esc(node.id)}</a>`), "utf8");
}

// --- /repos browse page (FC9) --- (B-2)
console.error("[pages] Building /repos browse index...");
const reposIndexBody = renderReposIndex(buildRepoRows(trust, anchors));
const reposDir = path.join(OUT_DIR, "repos");
fs.mkdirSync(reposDir, { recursive: true });
fs.writeFileSync(
  path.join(reposDir, "index.html"),
  layout("Browse Trust Index", reposIndexBody, `<a href="${BASE}/">Home</a> / Browse`),
  "utf8",
);

// --- Docs page (verification) --- (B-2)
console.error("[pages] Building docs page...");
const docsDir = path.join(OUT_DIR, "docs");
fs.mkdirSync(docsDir, { recursive: true });
const verDocSrc = path.join(ROOT, "docs", "verification.md");
if (fs.existsSync(verDocSrc)) {
  // Simple markdown-to-HTML (headings, code blocks, paragraphs, lists)
  const md = fs.readFileSync(verDocSrc, "utf8");
  let html = "";
  let inCode = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      html += inCode ? "</pre>" : "<pre>";
      inCode = !inCode;
    } else if (inCode) {
      html += esc(line) + "\n";
    } else if (line.startsWith("# ")) {
      html += `<h2>${esc(line.slice(2))}</h2>\n`;
    } else if (line.startsWith("## ")) {
      html += `<h3>${esc(line.slice(3))}</h3>\n`;
    } else if (line.startsWith("### ")) {
      html += `<h3 style="font-size:0.9rem">${esc(line.slice(4))}</h3>\n`;
    } else if (line.startsWith("- ")) {
      html += `<li>${esc(line.slice(2))}</li>\n`;
    } else if (line.trim() === "") {
      html += `<br>\n`;
    } else {
      // Inline code
      const processed = esc(line).replace(/`([^`]+)`/g, '<code>$1</code>');
      html += `<p>${processed}</p>\n`;
    }
  }
  fs.writeFileSync(path.join(docsDir, "verification.html"), layout("Verification", html, `<a href="${BASE}/">Home</a> / Docs`), "utf8");
}

console.log(`Pages built: ${fs.readdirSync(OUT_DIR).length} top-level entries.`);
console.log(`  Home: index.html`);
console.log(`  Browse: repos/index.html`);
console.log(`  Anchors: anchors/index.html`);
console.log(`  Repos: ${nodes.length} repo page(s) + per-version proof pages`);

} // end if (isMain)
