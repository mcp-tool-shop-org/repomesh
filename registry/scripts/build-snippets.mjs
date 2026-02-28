#!/usr/bin/env node
// RepoMesh Snippet Generator — Generates markdown verification snippets per repo.
// Output: registry/snippets/<org>/<repo>.md

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY_DIR = path.join(ROOT, "registry");
const LEDGER_REPO = "mcp-tool-shop-org/repomesh";

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
  const dir = path.join(REGISTRY_DIR, "snippets", org);
  fs.mkdirSync(dir, { recursive: true });

  const anchorKey = `${repo}@${entry.version}`;
  const isAnchored = !!anchors.releaseAnchors?.[anchorKey];
  const anchorInfo = anchors.releaseAnchors?.[anchorKey];

  const badgeBase = `https://raw.githubusercontent.com/${LEDGER_REPO}/main/registry/badges/${org}/${name}`;

  let md = `## ${repo} — Verification\n\n`;

  // Badges
  md += `### Badges\n\n`;
  md += `[![Integrity](${badgeBase}/integrity.svg)](https://${org}.github.io/repomesh/repos/${org}/${name}/)\n`;
  md += `[![Assurance](${badgeBase}/assurance.svg)](https://${org}.github.io/repomesh/repos/${org}/${name}/)\n`;
  md += `[![Anchored](${badgeBase}/anchored.svg)](https://${org}.github.io/repomesh/repos/${org}/${name}/)\n\n`;

  // Badge embed markdown
  md += `### Embed (copy/paste into your README)\n\n`;
  md += "```markdown\n";
  md += `[![Integrity](${badgeBase}/integrity.svg)](https://${org}.github.io/repomesh/repos/${org}/${name}/)\n`;
  md += `[![Assurance](${badgeBase}/assurance.svg)](https://${org}.github.io/repomesh/repos/${org}/${name}/)\n`;
  md += `[![Anchored](${badgeBase}/anchored.svg)](https://${org}.github.io/repomesh/repos/${org}/${name}/)\n`;
  md += "```\n\n";

  // Verify release command
  md += `### Verify Release\n\n`;
  md += "```bash\n";
  md += `# Clone the RepoMesh ledger\n`;
  md += `git clone https://github.com/${LEDGER_REPO}.git && cd repomesh\n\n`;
  md += `# Verify the latest release\n`;
  md += `node tools/repomesh.mjs verify-release --repo ${repo} --version ${entry.version}`;
  if (isAnchored) md += ` --anchored`;
  md += `\n`;
  md += "```\n\n";

  // JSON mode for CI
  md += `### CI Gate (JSON output)\n\n`;
  md += "```bash\n";
  md += `node tools/repomesh.mjs verify-release --repo ${repo} --version ${entry.version} --json`;
  if (isAnchored) md += ` --anchored`;
  md += `\n`;
  md += "```\n\n";

  // Anchor verification
  if (isAnchored && anchorInfo?.txHash) {
    md += `### Verify XRPL Anchor\n\n`;
    md += "```bash\n";
    md += `node anchor/xrpl/scripts/verify-anchor.mjs --tx ${anchorInfo.txHash}\n`;
    md += "```\n";
  }

  fs.writeFileSync(path.join(dir, `${name}.md`), md, "utf8");
  count++;
}

console.log(`Snippets built: ${count} repo(s).`);
