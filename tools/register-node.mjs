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
import { execSync, execFileSync } from "node:child_process";

// Signal handler for temp directory cleanup
let tmpDir = null;
function cleanup() { if (tmpDir && fs.existsSync(tmpDir)) { fs.rmSync(tmpDir, { recursive: true, force: true }); } }
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

// SB-TOOLS-02: a real (non-spinning) sleep for the synchronous retry path. The previous
// backoff was a tight Date.now() polling loop that pinned a CPU core for the entire 2-6s
// wait. A setTimeout-based async sleep is the usual fix, but registerNode() is intentionally a
// SYNCHRONOUS function (its callers — init-node, repomesh.mjs, the CLI entrypoint, and the
// tests — consume its return value directly, not a Promise). Atomics.wait blocks the thread
// for the requested duration with ZERO CPU spin while preserving that sync contract.
function sleepSync(ms) {
  // SharedArrayBuffer is always available in modern Node; Atomics.wait on an unchanged
  // value simply times out after `ms`, yielding the core to the OS scheduler.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Retry wrapper for GitHub API calls (gh CLI)
function retryExec(cmd, args, opts, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return execFileSync(cmd, args, opts); } catch(e) {
      if (i === maxRetries - 1) throw e;
      console.error(`[${i+1}/${maxRetries}] Retrying after error: ${e.message}`);
      // Exponential-ish backoff, blocking without burning CPU (SB-TOOLS-02).
      sleepSync(2000 * (i + 1));
    }
  }
}

export function registerNode({ repoId, nodeJsonPath, profileJsonPath, overridesJsonPath, ledgerRepo, noPr, targetDir }) {
  const TOTAL_STEPS = 5;
  let step = 0;
  const progress = (msg) => console.error(`[${++step}/${TOTAL_STEPS}] ${msg}`);

  const [org, repo] = repoId.split("/");
  const SAFE_NAME = /^[a-zA-Z0-9_.-]+$/;
  if (!SAFE_NAME.test(org) || !SAFE_NAME.test(repo)) {
    throw new Error(`Invalid repoId: org and repo must match ${SAFE_NAME}`);
  }
  const ledger = ledgerRepo || "mcp-tool-shop-org/repomesh";
  const SAFE_LEDGER = /^[a-zA-Z0-9_.\/-]+$/;
  if (!SAFE_LEDGER.test(ledger)) {
    throw new Error(`Invalid ledgerRepo: must match ${SAFE_LEDGER}`);
  }
  // Manual-mode (no-PR) writes land under ROOT. Honor an explicit targetDir (or
  // REPOMESH_TARGET_DIR) so callers — and tests in particular — can isolate the
  // generated ledger/nodes/<org>/<repo>/ tree into a tmpdir instead of polluting
  // the current repo's real ledger. Defaults to process.cwd() (back-compat).
  const ROOT = targetDir || process.env.REPOMESH_TARGET_DIR || process.cwd();

  // Read the files
  progress("Reading node files...");
  let nodeJson;
  try {
    nodeJson = JSON.parse(fs.readFileSync(nodeJsonPath, "utf8"));
  } catch (e) {
    console.error("Invalid JSON in " + nodeJsonPath + ": " + e.message);
    process.exit(1);
  }

  let profileJson = null;
  if (profileJsonPath && fs.existsSync(profileJsonPath)) {
    try {
      profileJson = JSON.parse(fs.readFileSync(profileJsonPath, "utf8"));
    } catch (e) {
      console.error("Invalid JSON in " + profileJsonPath + ": " + e.message);
      process.exit(1);
    }
  }

  let overridesJson = null;
  if (overridesJsonPath && fs.existsSync(overridesJsonPath)) {
    try {
      overridesJson = JSON.parse(fs.readFileSync(overridesJsonPath, "utf8"));
    } catch (e) {
      console.error("Invalid JSON in " + overridesJsonPath + ": " + e.message);
      process.exit(1);
    }
  }

  // Check prerequisites
  progress("Checking prerequisites...");
  try {
    execFileSync("git", ["--version"], { stdio: "pipe" });
  } catch {
    console.error("\u274C git not found. Install Git: https://git-scm.com/downloads");
    process.exit(1);
  }

  let hasGh = false;
  try {
    execSync("gh auth status", { stdio: "pipe" });
    hasGh = true;
  } catch {
    hasGh = false;
  }

  if (noPr || !hasGh) {
    progress("Writing local files (manual mode)...");
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
    if (profileJson != null) {
      fs.writeFileSync(path.join(localDest, "repomesh.profile.json"), JSON.stringify(profileJson, null, 2) + "\n", "utf8");
    }
    if (overridesJson != null) {
      fs.writeFileSync(path.join(localDest, "repomesh.overrides.json"), JSON.stringify(overridesJson, null, 2) + "\n", "utf8");
    }
    console.log(`\n  Files staged locally at ${localDest}/`);
    progress("Done (manual mode).");
    return { pr: null, localPath: localDest };
  }

  // PR automation via gh CLI
  progress("Cloning ledger repo...");
  tmpDir = path.join(ROOT, ".repomesh-tmp");
  const branch = `register/${org}/${repo}`;

  try {
    // Clone ledger repo
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    console.log(`Cloning ${ledger}...`);
    try {
      retryExec('gh', ['repo', 'clone', ledger, tmpDir, '--', '--depth', '1'], { stdio: "pipe", timeout: 30000 });
    } catch (cloneErr) {
      const isTimeout = cloneErr.killed || (cloneErr.signal === "SIGTERM");
      if (isTimeout) {
        console.error(`\u274C Clone timed out after 30s. Check network connectivity and try again.`);
      } else {
        console.error(`\u274C Clone failed: ${cloneErr.message}`);
      }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return { pr: null, error: isTimeout ? "clone timeout" : cloneErr.message };
    }

    // Create branch
    progress("Creating branch and writing files...");
    execFileSync('git', ['checkout', '-b', branch], { cwd: tmpDir, stdio: "pipe" });

    // Write files
    const destDir = path.join(tmpDir, "ledger", "nodes", org, repo);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "node.json"), JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
    if (profileJson != null) {
      fs.writeFileSync(path.join(destDir, "repomesh.profile.json"), JSON.stringify(profileJson, null, 2) + "\n", "utf8");
    }
    if (overridesJson != null) {
      fs.writeFileSync(path.join(destDir, "repomesh.overrides.json"), JSON.stringify(overridesJson, null, 2) + "\n", "utf8");
    }

    // Commit and push
    progress("Committing and pushing...");
    execFileSync('git', ['config', 'user.name', 'repomesh-bot'], { cwd: tmpDir, stdio: "pipe" });
    execFileSync('git', ['config', 'user.email', 'repomesh-bot@users.noreply.github.com'], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["add", `ledger/nodes/${org}/${repo}/`], { cwd: tmpDir, stdio: "pipe" });

    const SAFE_KIND = /^[a-zA-Z0-9_.-]+$/;
    const kind = SAFE_KIND.test(nodeJson.kind) ? nodeJson.kind : "unknown";
    const commitMsg = `register: ${org}/${repo} as ${kind} node`;
    execFileSync("git", ["commit", "-m", commitMsg], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["push", "origin", branch], { cwd: tmpDir, stdio: "pipe" });

    // Create PR
    progress("Creating PR...");
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

    // SB-TOOLS-03: bound the gh pr create call with a timeout so a hung GitHub API call
    // (or a network stall) can't block registration indefinitely. Mirrors the 30s clone
    // timeout above. On timeout, execFileSync throws with .killed/.signal set, which the
    // surrounding catch turns into a structured { pr:null, error } result (REASON+HINT).
    const prUrl = retryExec("gh", [
      "pr", "create",
      "--repo", ledger,
      "--head", branch,
      "--title", `register: ${org}/${repo}`,
      "--body", prBody,
    ], { cwd: tmpDir, encoding: "utf8", timeout: 30000 }).toString().trim();

    console.log(`\u2705 Registration PR created: ${prUrl}`);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;

    return { pr: prUrl, localPath: null };
  } catch (e) {
    const context = { repoId, ledger, branch, tmpDir, action: "register-pr" };
    // SB-TOOLS-03: distinguish a timeout (hung gh call we bounded) from other failures so
    // the operator gets a recovery hint instead of a bare error.
    const isTimeout = e.killed || e.signal === "SIGTERM";
    const reason = isTimeout ? "gh pr create timed out after 30s" : e.message;
    console.error(`\u274C Registration failed: ${reason}`);
    if (isTimeout) console.error(`   hint: check network connectivity and gh auth status, then re-run; or pass --no-pr for manual registration steps.`);
    if (process.argv.includes("--debug")) console.error("Context:", JSON.stringify(context));
    // Cleanup on failure
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    tmpDir = null;
    return { pr: null, error: reason };
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
  const targetDir = getArg("--target-dir");
  const noPr = args.includes("--no-pr");

  if (!repoId || !nodeJsonPath) {
    console.error("Usage: node register-node.mjs --repo org/repo --node-json path [--profile-json path] [--overrides-json path] [--target-dir path] [--no-pr]");
    process.exit(1);
  }

  registerNode({ repoId, nodeJsonPath, profileJsonPath, overridesJsonPath, ledgerRepo, noPr, targetDir });
}
