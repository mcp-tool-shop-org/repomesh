#!/usr/bin/env node
// RepoMesh Pages Generator — Builds static HTML site from registry artifacts.
// Output: pages/out/

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "registry");
const OUT_DIR = path.join(import.meta.dirname, "out");
const ASSETS_DIR = path.join(import.meta.dirname, "assets");

// Base path for GitHub Pages (matches repo name)
const BASE = "/repomesh";

// Load data
const nodes = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, "nodes.json"), "utf8"));
const trust = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, "trust.json"), "utf8"));
const verifiers = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, "verifiers.json"), "utf8"));
const anchorsPath = path.join(REGISTRY_DIR, "anchors.json");
const anchors = fs.existsSync(anchorsPath) ? JSON.parse(fs.readFileSync(anchorsPath, "utf8")) : { partitions: [], releaseAnchors: {} };
const metricsPath = path.join(REGISTRY_DIR, "metrics.json");
const metrics = fs.existsSync(metricsPath) ? JSON.parse(fs.readFileSync(metricsPath, "utf8")) : { history: [], current: {}, deltas: {}, latestRelease: null };
const timelinePath = path.join(REGISTRY_DIR, "timeline.json");
const timeline = fs.existsSync(timelinePath) ? JSON.parse(fs.readFileSync(timelinePath, "utf8")) : { events: [] };

// --- Helpers ---

function scoreClass(score) {
  if (score >= 80) return "score-green";
  if (score >= 50) return "score-yellow";
  return "score-red";
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortHash(h) {
  return h ? h.slice(0, 12) + "..." : "—";
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

// --- Build output dir ---
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

// --- Home page ---
let homeBody = "";

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
  <div class="card-meta">${entry.timestamp} &middot; commit ${esc(entry.commit?.slice(0, 7))}</div>
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
  <div class="card-meta">Last run: ${v.lastRun || "never"}</div>
</div>`;
}

// Latest anchors (top 3)
homeBody += `<h2>Latest Anchors</h2>`;
const sortedPartitions = [...anchors.partitions].reverse();
for (const p of sortedPartitions.slice(0, 3)) {
  homeBody += `<div class="card">
  <div class="card-title">Partition: ${esc(p.partitionId)}</div>
  <div class="card-meta">Network: ${esc(p.network)} &middot; Events: ${p.count} &middot; TX: ${p.txHash ? esc(p.txHash.slice(0, 16)) + "..." : "local"}</div>
  <div class="hash">Root: ${esc(p.root)}</div>
  <div class="hash">ManifestHash: ${esc(p.manifestHash)}</div>
</div>`;
}
homeBody += `<p style="margin-top:0.5rem"><a href="${BASE}/anchors/">View full anchor chain &rarr;</a></p>`;

fs.writeFileSync(path.join(OUT_DIR, "index.html"), layout("Home", homeBody), "utf8");

// --- Anchors page ---
let anchorsBody = `<h2>Anchor Chain</h2>
<p style="color:var(--text-muted);margin-bottom:1rem">Each anchor binds a ledger partition's Merkle root to the XRP Ledger. Anchors form a linked list via the <code>prev</code> field.</p>`;

anchorsBody += `<table>
<tr><th>Partition</th><th>Count</th><th>Root</th><th>ManifestHash</th><th>Prev</th><th>TX</th></tr>`;
for (const p of anchors.partitions) {
  anchorsBody += `<tr>
  <td>${esc(p.partitionId)}</td>
  <td>${p.count}</td>
  <td class="hash">${shortHash(p.root)}</td>
  <td class="hash">${shortHash(p.manifestHash)}</td>
  <td class="hash">${shortHash(p.prev)}</td>
  <td>${p.txHash ? esc(p.txHash.slice(0, 12)) + "..." : "local"}</td>
</tr>`;
}
anchorsBody += `</table>`;

anchorsBody += `<h3>Verify an Anchor</h3>`;
anchorsBody += copyBlock(`git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh\nnode anchor/xrpl/scripts/verify-anchor.mjs --tx <TX_HASH>`);

const anchorsDir = path.join(OUT_DIR, "anchors");
fs.mkdirSync(anchorsDir, { recursive: true });
fs.writeFileSync(path.join(anchorsDir, "index.html"), layout("Anchors", anchorsBody, `<a href="${BASE}/">Home</a> / Anchors`), "utf8");

// --- Dashboard (Health) page ---

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
  const anchoredBadge = latestRelease.anchored
    ? `<span class="score score-green">Anchored on XRPL</span>`
    : `<span class="score" style="background:rgba(139,148,158,0.15);color:var(--text-muted)">Pending anchor</span>`;

  healthBody += `<div class="dash-hero">
  <div class="hero-rings">
    ${trustRingSvg("Integrity", latestRelease.integrity, intColor)}
    ${trustRingSvg("Assurance", latestRelease.assurance, assColor)}
  </div>
  <div class="hero-meta">
    <div class="hero-title">${esc(latestRelease.repo)}@${esc(latestRelease.version)}</div>
    <div class="card-meta">${latestRelease.timestamp} &middot; ${esc(latestRelease.commit?.slice(0, 7))}</div>
    <div class="badge-row" style="margin-top:0.5rem">${anchoredBadge}</div>
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
      : `${ev.repo.split("/")[1]}@${ev.version}`;
    const detail = ev.type === "anchor"
      ? `data-detail="Partition: ${esc(ev.partitionId)}&#10;Root: ${esc(ev.root)}&#10;ManifestHash: ${esc(ev.manifestHash)}&#10;Events: ${ev.count}&#10;TX: ${ev.txHash || "local"}&#10;Network: ${ev.network}"`
      : `data-detail="Repo: ${esc(ev.repo)}&#10;Version: ${esc(ev.version)}&#10;Commit: ${esc(ev.commit?.slice(0, 12))}&#10;Integrity: ${ev.integrity}/100&#10;Assurance: ${ev.assurance}/100&#10;Anchored: ${ev.anchored ? "Yes" : "No"}"`;
    healthBody += `<button class="timeline-pill ${pillClass}" ${detail}><span class="pill-dot"></span>${esc(shortLabel)}</button>`;
  }
  healthBody += `</div>`;
  healthBody += `<div id="timeline-detail" class="timeline-detail" hidden></div>`;
}

// Explore Tiles
healthBody += `<h3 style="margin-top:2rem">Explore</h3>`;
healthBody += `<div class="explore-grid">
  <a class="explore-tile" href="${BASE}/">
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

// --- Repo pages ---
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

      body += `<div class="card">
  <div class="card-title">v${esc(entry.version)}</div>
  <div class="card-meta">${entry.timestamp} &middot; commit ${esc(entry.commit?.slice(0, 7))}</div>
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

      body += `</div>`;
    }

    // Verify commands
    const latest = repoReleases[0];
    const latestAnchorKey = `${latest.repo}@${latest.version}`;
    const latestAnchored = !!anchors.releaseAnchors?.[latestAnchorKey];

    body += `<h3>Verify</h3>`;
    const cmd = `node tools/repomesh.mjs verify-release --repo ${node.id} --version ${latest.version}${latestAnchored ? " --anchored" : ""}`;
    body += copyBlock(cmd);

    // Badge embed
    const badgeBase = `https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/${org}/${name}`;
    body += `<h3>Badges</h3>`;
    body += `<div class="badge-row">
  <img src="${badgeBase}/integrity.svg" alt="Integrity">
  <img src="${badgeBase}/assurance.svg" alt="Assurance">
  <img src="${badgeBase}/anchored.svg" alt="Anchored">
</div>`;
    body += copyBlock(`[![Integrity](${badgeBase}/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/${org}/${name}/)\n[![Assurance](${badgeBase}/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/${org}/${name}/)\n[![Anchored](${badgeBase}/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/${org}/${name}/)`);
  }

  fs.writeFileSync(path.join(repoDir, "index.html"), layout(node.id, body, `<a href="${BASE}/">Home</a> / <a href="${BASE}/repos/${org}/${name}/">${esc(node.id)}</a>`), "utf8");
}

// --- Docs page (verification) ---
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
console.log(`  Anchors: anchors/index.html`);
console.log(`  Repos: ${nodes.length} repo page(s)`);
