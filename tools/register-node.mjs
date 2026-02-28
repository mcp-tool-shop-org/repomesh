#!/usr/bin/env node
// RepoMesh Node Registration — Opens a PR to register a node in the ledger.
//
// Usage:
//   node register-node.mjs --repo org/repo --node-json path/to/node.json [--profile-json path] [--overrides-json path] [--no-pr]
//
// This script:
//   1. Clones/uses the RepoMesh ledger repo
//   2. Creates a branch: register/<org>/<repo>
//   3. Writes node.json + profile + overrides to ledger/nodes/<org>/<repo>/
//   4. Opens a PR (unless --no-pr)

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export function registerNode({ repoId, nodeJsonPath, profileJsonPath, overridesJsonPath, ledgerRepo, noPr }) {
  const [org, repo] = repoId.split("/");
  const ledger = ledgerRepo || "mcp-tool-shop-org/repomesh";
  const ROOT = process.cwd();

  // Read the files
  const nodeJson = JSON.parse(fs.readFileSync(nodeJsonPath, "utf8"));

  let profileJson = null;
  if (profileJsonPath && fs.existsSync(profileJsonPath)) {
    profileJson = JSON.parse(fs.readFileSync(profileJsonPath, "utf8"));
  }

  let overridesJson = null;
  if (overridesJsonPath && fs.existsSync(overridesJsonPath)) {
    overridesJson = JSON.parse(fs.readFileSync(overridesJsonPath, "utf8"));
  }

  // Check if gh CLI is available
  let hasGh = false;
  try {
    execSync("gh auth status", { stdio: "pipe" });
    hasGh = true;
  } catch {
    hasGh = false;
  }

  if (noPr || !hasGh) {
    // Output patch instructions
    const destDir = `ledger/nodes/${org}/${repo}`;
    console.log("\n\u2139\uFE0F  Manual registration steps:");
    console.log(`  1. Fork/clone ${ledger}`);
    console.log(`  2. Create directory: ${destDir}/`);
    console.log(`  3. Copy node.json to ${destDir}/node.json`);
    if (profileJson) console.log(`  4. Copy repomesh.profile.json to ${destDir}/repomesh.profile.json`);
    if (overridesJson) console.log(`  5. Copy repomesh.overrides.json to ${destDir}/repomesh.overrides.json`);
    console.log(`  6. Commit, push, and open a PR to ${ledger}`);

    // Write files locally for convenience
    const localDest = path.join(ROOT, destDir);
    fs.mkdirSync(localDest, { recursive: true });
    fs.writeFileSync(path.join(localDest, "node.json"), JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
    if (profileJson) {
      fs.writeFileSync(path.join(localDest, "repomesh.profile.json"), JSON.stringify(profileJson, null, 2) + "\n", "utf8");
    }
    if (overridesJson) {
      fs.writeFileSync(path.join(localDest, "repomesh.overrides.json"), JSON.stringify(overridesJson, null, 2) + "\n", "utf8");
    }
    console.log(`\n  Files staged locally at ${localDest}/`);
    return { pr: null, localPath: localDest };
  }

  // PR automation via gh CLI
  const tmpDir = path.join(ROOT, ".repomesh-tmp");
  const branch = `register/${org}/${repo}`;

  try {
    // Clone ledger repo
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    console.log(`Cloning ${ledger}...`);
    execSync(`gh repo clone ${ledger} "${tmpDir}" -- --depth 1`, { stdio: "pipe" });

    // Create branch
    execSync(`git checkout -b "${branch}"`, { cwd: tmpDir, stdio: "pipe" });

    // Write files
    const destDir = path.join(tmpDir, "ledger", "nodes", org, repo);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "node.json"), JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
    if (profileJson) {
      fs.writeFileSync(path.join(destDir, "repomesh.profile.json"), JSON.stringify(profileJson, null, 2) + "\n", "utf8");
    }
    if (overridesJson) {
      fs.writeFileSync(path.join(destDir, "repomesh.overrides.json"), JSON.stringify(overridesJson, null, 2) + "\n", "utf8");
    }

    // Commit and push
    execSync("git config user.name repomesh-bot", { cwd: tmpDir, stdio: "pipe" });
    execSync("git config user.email repomesh-bot@users.noreply.github.com", { cwd: tmpDir, stdio: "pipe" });
    execSync(`git add ledger/nodes/${org}/${repo}/`, { cwd: tmpDir, stdio: "pipe" });

    const commitMsg = `register: ${repoId} as ${nodeJson.kind} node`;
    execSync(`git commit -m "${commitMsg}"`, { cwd: tmpDir, stdio: "pipe" });
    execSync(`git push origin "${branch}"`, { cwd: tmpDir, stdio: "pipe" });

    // Create PR
    const provides = (nodeJson.provides || []).join(", ");
    const profileInfo = profileJson ? `\n**Profile:** ${profileJson.profileId}` : "";
    const prBody = `## RepoMesh Node Registration

**Node:** ${repoId}
**Kind:** ${nodeJson.kind}
**Provides:** ${provides}${profileInfo}

### What to do next
1. Merge this PR to register the node
2. Add \`REPOMESH_SIGNING_KEY\` secret to your repo
3. Add \`REPOMESH_LEDGER_TOKEN\` secret (PAT with contents:write + pull-requests:write on ${ledger})
4. Cut a release \u2014 trust will converge automatically`;

    const prUrl = execSync(
      `gh pr create --repo "${ledger}" --head "${branch}" --title "register: ${repoId}" --body "${prBody.replace(/"/g, '\\"')}"`,
      { cwd: tmpDir, encoding: "utf8" }
    ).trim();

    console.log(`\u2705 Registration PR created: ${prUrl}`);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    return { pr: prUrl, localPath: null };
  } catch (e) {
    console.error(`\u274C Registration failed: ${e.message}`);
    // Cleanup on failure
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return { pr: null, error: e.message };
  }
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
  };

  const repoId = getArg("--repo");
  const nodeJsonPath = getArg("--node-json");
  const profileJsonPath = getArg("--profile-json");
  const overridesJsonPath = getArg("--overrides-json");
  const ledgerRepo = getArg("--ledger-repo");
  const noPr = args.includes("--no-pr");

  if (!repoId || !nodeJsonPath) {
    console.error("Usage: node register-node.mjs --repo org/repo --node-json path [--profile-json path] [--overrides-json path] [--no-pr]");
    process.exit(1);
  }

  registerNode({ repoId, nodeJsonPath, profileJsonPath, overridesJsonPath, ledgerRepo, noPr });
}
