#!/usr/bin/env node
// RepoMesh Snippet Generator — Generates markdown verification snippets per repo.
// Output: registry/snippets/<org>/<repo>.md
//
// FC2 (#1 F1): the verification block uses the canonical npx command —
//   `npx @mcptoolshop/repomesh verify-release --repo <org/repo> --version <v> [--anchored]`
// NOT `git clone` + `node tools/repomesh.mjs`. A consumer never needs to clone the ledger to verify.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY_DIR = path.join(ROOT, "registry");
const LEDGER_REPO = "mcp-tool-shop-org/repomesh";
const CLI_PKG = "@mcptoolshop/repomesh";

// Pure renderer — given a release entry, produce its markdown snippet. Kept side-effect-free so it is
// unit-testable (registry/tests/snippets.test.mjs). `opts.anchored` toggles --anchored on the verify
// command; `opts.anchorInfo` (with .txHash) adds the XRPL anchor verification block.
export function renderSnippet(repo, entry, opts = {}) {
  const [org, name] = repo.split("/");
  const isAnchored = !!opts.anchored;
  const anchorInfo = opts.anchorInfo || null;
  const anchoredFlag = isAnchored ? " --anchored" : "";
  const badgeBase = `https://raw.githubusercontent.com/${LEDGER_REPO}/main/registry/badges/${org}/${name}`;
  const repoPage = `https://${org}.github.io/repomesh/repos/${org}/${name}/`;

  let md = `## ${repo} — Verification\n\n`;

  // Badges
  md += `### Badges\n\n`;
  md += `[![Integrity](${badgeBase}/integrity.svg)](${repoPage})\n`;
  md += `[![Assurance](${badgeBase}/assurance.svg)](${repoPage})\n`;
  md += `[![Anchored](${badgeBase}/anchored.svg)](${repoPage})\n\n`;

  // Badge embed markdown
  md += `### Embed (copy/paste into your README)\n\n`;
  md += "```markdown\n";
  md += `[![Integrity](${badgeBase}/integrity.svg)](${repoPage})\n`;
  md += `[![Assurance](${badgeBase}/assurance.svg)](${repoPage})\n`;
  md += `[![Anchored](${badgeBase}/anchored.svg)](${repoPage})\n`;
  md += "```\n\n";

  // Verify release command — FC2: canonical npx form, no clone.
  md += `### Verify Release\n\n`;
  md += "```bash\n";
  md += `# Verify the latest release (no clone required)\n`;
  md += `npx ${CLI_PKG} verify-release --repo ${repo} --version ${entry.version}${anchoredFlag}\n`;
  md += "```\n\n";

  // JSON mode for CI — FC2: npx form with JSON output.
  md += `### CI Gate (JSON output)\n\n`;
  md += "```bash\n";
  md += `npx ${CLI_PKG} verify-release --repo ${repo} --version ${entry.version} --json${anchoredFlag}\n`;
  md += "```\n\n";

  // Anchor verification (only when anchored with a tx hash).
  if (isAnchored && anchorInfo?.txHash) {
    md += `### Verify XRPL Anchor\n\n`;
    md += "```bash\n";
    md += `node anchor/xrpl/scripts/verify-anchor.mjs --tx ${anchorInfo.txHash}\n`;
    md += "```\n";
  }

  return md;
}

// --- file-walking build (only runs when invoked as a script) -----------------------------------
function buildSnippets() {
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
    const dir = path.join(REGISTRY_DIR, "snippets", org);
    fs.mkdirSync(dir, { recursive: true });

    const anchorKey = `${repo}@${entry.version}`;
    const anchorInfo = anchors.releaseAnchors?.[anchorKey] || null;
    const isAnchored = !!anchorInfo;

    const md = renderSnippet(repo, entry, { anchored: isAnchored, anchorInfo });
    fs.writeFileSync(path.join(dir, `${name}.md`), md, "utf8");
    count++;
  }

  console.log(`Snippets built: ${count} repo(s).`);
}

const INVOKED_AS_SCRIPT =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, "build-snippets.mjs");
if (INVOKED_AS_SCRIPT) {
  buildSnippets();
}
