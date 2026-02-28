#!/usr/bin/env node
// RepoMesh Badge Generator — Generates SVG badges for each node's latest release.
// Output: registry/badges/<org>/<repo>/integrity.svg, assurance.svg, anchored.svg

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY_DIR = path.join(ROOT, "registry");

function badge(label, value, color) {
  const labelWidth = label.length * 6.5 + 12;
  const valueWidth = value.length * 6.5 + 12;
  const totalWidth = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

function scoreColor(score) {
  if (score >= 80) return "#4c1";      // green
  if (score >= 50) return "#dfb317";   // yellow
  return "#e05d44";                     // red
}

// Load trust + anchors
const trust = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, "trust.json"), "utf8"));
const anchorsPath = path.join(REGISTRY_DIR, "anchors.json");
const anchors = fs.existsSync(anchorsPath) ? JSON.parse(fs.readFileSync(anchorsPath, "utf8")) : { releaseAnchors: {} };

// Group by repo, pick latest version
const byRepo = {};
for (const entry of trust) {
  if (!byRepo[entry.repo] || new Date(entry.timestamp) > new Date(byRepo[entry.repo].timestamp)) {
    byRepo[entry.repo] = entry;
  }
}

let count = 0;
for (const [repo, entry] of Object.entries(byRepo)) {
  const [org, name] = repo.split("/");
  const dir = path.join(REGISTRY_DIR, "badges", org, name);
  fs.mkdirSync(dir, { recursive: true });

  // Integrity badge
  fs.writeFileSync(
    path.join(dir, "integrity.svg"),
    badge("integrity", `${entry.integrityScore}/100`, scoreColor(entry.integrityScore)),
    "utf8"
  );

  // Assurance badge
  fs.writeFileSync(
    path.join(dir, "assurance.svg"),
    badge("assurance", `${entry.assuranceScore}/100`, scoreColor(entry.assuranceScore)),
    "utf8"
  );

  // Anchored badge
  const anchorKey = `${repo}@${entry.version}`;
  const isAnchored = !!anchors.releaseAnchors?.[anchorKey];
  fs.writeFileSync(
    path.join(dir, "anchored.svg"),
    badge("anchored", isAnchored ? "YES" : "NO", isAnchored ? "#4c1" : "#9f9f9f"),
    "utf8"
  );

  count++;
}

console.log(`Badges built: ${count} repo(s), 3 badges each.`);
