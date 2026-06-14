#!/usr/bin/env node
// RepoMesh Badge Generator — Generates SVG badges for each node's latest release.
// Output: registry/badges/<org>/<repo>/integrity.svg, assurance.svg, anchored.svg

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY_DIR = path.join(ROOT, "registry");

// REG-003: XML-escape any value interpolated into the SVG. trust.json is generated from
// ledger-derived strings (repo ids, scores); escaping is defense-in-depth so a crafted repo id
// or note can never break out of an attribute/text node into markup.
export function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// REG-003: badge() escapes label + value, and (when assertNumericScore is set) refuses to render a
// value that is not a "<number>/100"-shaped score — a NaN/non-numeric score is a generator bug.
export function badge(label, value, color, opts = {}) {
  const rawLabel = String(label);
  const rawValue = String(value);
  if (opts.assertNumericScore) {
    const m = rawValue.match(/^(-?\d+(?:\.\d+)?)\/100$/);
    if (!m || !Number.isFinite(Number(m[1]))) {
      throw new Error(`badge: non-numeric score "${rawValue}" (expected "<number>/100")`);
    }
  }
  const label_ = escapeXml(rawLabel);
  const value_ = escapeXml(rawValue);
  const labelWidth = rawLabel.length * 6.5 + 12;
  const valueWidth = rawValue.length * 6.5 + 12;
  const totalWidth = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label_}: ${value_}">
  <title>${label_}: ${value_}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${escapeXml(color)}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label_}</text>
    <text x="${labelWidth / 2}" y="14">${label_}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value_}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value_}</text>
  </g>
</svg>`;
}

function scoreColor(score) {
  if (score >= 80) return "#4c1";      // green
  if (score >= 50) return "#dfb317";   // yellow
  return "#e05d44";                     // red
}

function main() {
  // Load trust + anchors
  let trust;
  try {
    trust = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, "trust.json"), "utf8"));
  } catch (e) {
    console.error(`Failed to parse ${path.join(REGISTRY_DIR, "trust.json")}: ${e.message}`);
    process.exit(1);
  }

  const anchorsPath = path.join(REGISTRY_DIR, "anchors.json");
  let anchors = { releaseAnchors: {} };
  if (fs.existsSync(anchorsPath)) {
    try {
      anchors = JSON.parse(fs.readFileSync(anchorsPath, "utf8"));
    } catch (e) {
      console.error(`Failed to parse ${anchorsPath}: ${e.message}`);
      process.exit(1);
    }
  }

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

    // Integrity badge — assert the score is numeric (REG-003).
    fs.writeFileSync(
      path.join(dir, "integrity.svg"),
      badge("integrity", `${entry.integrityScore}/100`, scoreColor(entry.integrityScore), { assertNumericScore: true }),
      "utf8"
    );

    // Assurance badge — assert the score is numeric (REG-003).
    fs.writeFileSync(
      path.join(dir, "assurance.svg"),
      badge("assurance", `${entry.assuranceScore}/100`, scoreColor(entry.assuranceScore), { assertNumericScore: true }),
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
}

// Only run when invoked as a script (not when imported by tests).
const INVOKED_AS_SCRIPT =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, "build-badges.mjs");
if (INVOKED_AS_SCRIPT) {
  main();
}
