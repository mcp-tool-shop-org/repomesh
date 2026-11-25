// Regression guard for release-event PRs (PR #162 / #154):
// `repomesh-broadcast.yml` ("Append to ledger via PR") must regenerate `anchor/xrpl/manifests/all.json`
// and `registry/trust.json` in the same commit as the appended event so ledger-ci's drift guard,
// truncation check, and build-trust byte-identical gate stay green.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrust } from "../../registry/scripts/build-trust.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const REAL_LEDGER = path.join(REPO_ROOT, "ledger", "events", "events.jsonl");
const VALIDATOR = path.join(REPO_ROOT, "ledger", "scripts", "validate-ledger.mjs");
const BROADCAST_WORKFLOWS = [
  ".github/workflows/repomesh-broadcast.yml",
  "templates/repomesh-broadcast.yml",
  "packages/repomesh-cli/templates/repomesh-broadcast.yml",
];

function resolveBashBinary() {
  if (process.platform === "win32") {
    for (const c of [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    ]) {
      if (fs.existsSync(c)) return c;
    }
  }
  return "bash";
}

const BASH_BIN = resolveBashBinary();
const toPosix = (p) => p.replace(/\\/g, "/");

function extractAppendStepScript(workflowRelPath) {
  const raw = fs.readFileSync(path.join(REPO_ROOT, workflowRelPath), "utf8");
  const lines = raw.split(/\r?\n/);
  const stepIdx = lines.findIndex((l) => /^\s*-\s*name:\s*Append to ledger via PR\s*$/.test(l));
  assert.notEqual(stepIdx, -1, `${workflowRelPath} must contain step 'Append to ledger via PR'`);

  let runIdx = -1;
  for (let i = stepIdx + 1; i < lines.length; i++) {
    if (/^\s*-\s*(name|uses):/.test(lines[i])) break;
    if (/^\s*run:\s*\|\s*$/.test(lines[i])) {
      runIdx = i;
      break;
    }
  }
  assert.notEqual(runIdx, -1, `${workflowRelPath} step 'Append to ledger via PR' must have a 'run: |' block`);

  const bodyLines = [];
  let baseIndent = null;
  for (let i = runIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      bodyLines.push("");
      continue;
    }
    const indent = line.match(/^(\s*)/)[1].length;
    if (baseIndent === null) {
      baseIndent = indent;
    } else if (indent < baseIndent) {
      break;
    }
    bodyLines.push(line.slice(baseIndent));
  }
  return bodyLines.join("\n") + "\n";
}

function findUntrustedRunExpressions(workflowRelPath) {
  const lines = fs.readFileSync(path.join(REPO_ROOT, workflowRelPath), "utf8").split(/\r?\n/);
  const violations = [];
  const untrustedRe = /\$\{\{[^}]*(?:github\.ref_name|github\.head_ref|inputs\.|github\.event\.)/;
  let inRunBlock = false;
  let runIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.match(/^(\s*)/)[1].length;

    if (inRunBlock) {
      if (trimmed !== "" && indent <= runIndent) {
        inRunBlock = false;
      } else {
        if (untrustedRe.test(line)) {
          violations.push(`${workflowRelPath}:${i + 1}: ${trimmed}`);
        }
        continue;
      }
    }

    const runMatch = line.match(/^\s*(?:-\s*)?run:\s*(.*)$/);
    if (runMatch) {
      const rest = runMatch[1].trim();
      if (/^[|>][+-]?$/.test(rest)) {
        inRunBlock = true;
        runIndent = line.indexOf("run:");
      } else if (untrustedRe.test(rest)) {
        violations.push(`${workflowRelPath}:${i + 1}: ${trimmed}`);
      }
    }
  }
  return violations;
}

function createOfflineBroadcastFixture(tmpRoot) {
  const allLines = fs.readFileSync(REAL_LEDGER, "utf8").trim().split("\n").filter(Boolean);
  assert.ok(allLines.length >= 2, "live ledger must have at least 2 events");
  const baseLines = allLines.slice(0, -1);
  const appendedLine = allLines[allLines.length - 1];
  const appendedEvent = JSON.parse(appendedLine);

  const seedDir = path.join(tmpRoot, "seed");
  const bareDir = path.join(tmpRoot, "origin.git");
  const eventTmpDir = path.join(tmpRoot, "repomesh-tmp");
  const cloneDir = path.join(tmpRoot, "repomesh-ledger");
  const binDir = path.join(tmpRoot, "bin");
  fs.mkdirSync(seedDir, { recursive: true });
  fs.mkdirSync(eventTmpDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  for (const rel of [
    "anchor/xrpl/config.json",
    "anchor/xrpl/scripts/compute-root.mjs",
    "anchor/xrpl/scripts/merkle.mjs",
    "ledger/scripts/canonicalize.mjs",
    "registry/scripts/build-trust.mjs",
    "verifier.policy.json",
  ]) {
    const dest = path.join(seedDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
  }
  for (const relDir of ["ledger/nodes", "profiles", "schemas", "verifiers/lib"]) {
    fs.cpSync(path.join(REPO_ROOT, relDir), path.join(seedDir, relDir), { recursive: true });
  }

  fs.mkdirSync(path.join(seedDir, "ledger", "events"), { recursive: true });
  fs.writeFileSync(path.join(seedDir, "ledger", "events", "events.jsonl"), baseLines.join("\n") + "\n", "utf8");

  const computeRes = spawnSync(process.execPath, ["anchor/xrpl/scripts/compute-root.mjs", "--all"], {
    cwd: seedDir,
    encoding: "utf8",
  });
  assert.equal(computeRes.status, 0, `seed compute-root failed: ${computeRes.stderr}`);
  const trustRes = spawnSync(process.execPath, ["registry/scripts/build-trust.mjs"], {
    cwd: seedDir,
    encoding: "utf8",
  });
  assert.equal(trustRes.status, 0, `seed build-trust failed: ${trustRes.stderr}`);

  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  git(seedDir, "init", "-b", "main");
  git(seedDir, "config", "user.name", "test-seed");
  git(seedDir, "config", "user.email", "test-seed@example.invalid");
  git(seedDir, "config", "core.autocrlf", "false");
  git(seedDir, "add", "-A");
  git(seedDir, "commit", "-m", "seed main");

  git(tmpRoot, "init", "--bare", bareDir);
  git(bareDir, "symbolic-ref", "HEAD", "refs/heads/main");
  git(seedDir, "remote", "add", "origin", bareDir);
  git(seedDir, "push", "-u", "origin", "main");

  fs.writeFileSync(path.join(eventTmpDir, "event.json"), appendedLine, "utf8");

  return { baseLines, appendedEvent, bareDir, eventTmpDir, cloneDir };
}

describe("repomesh-broadcast event PR manifest & trust regeneration (PR #162)", () => {
  it("regenerates all.json and trust.json in the event PR commit (reproduces #162 failure when stale)", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rm-broadcast-pr-"));
    try {
      const fx = createOfflineBroadcastFixture(tmpRoot);
      const rawStep = extractAppendStepScript(".github/workflows/repomesh-broadcast.yml");

      const branchVersion = "v0.0.0-test";
      const ghPrArgsPath = path.join(tmpRoot, "gh-pr-create.args");
      const substituted = rawStep
        .replaceAll("/tmp/repomesh-ledger", toPosix(fx.cloneDir))
        .replaceAll("/tmp/repomesh", toPosix(fx.eventTmpDir))
        .replaceAll("${{ env.REPOMESH_LEDGER_REPO }}", "mcp-tool-shop-org/repomesh")
        .replaceAll("${{ github.repository }}", "mcp-tool-shop-org/repomesh")
        .replaceAll("${{ github.sha }}", "0000000000000000000000000000000000000000");

      const preamble = [
        "set -euo pipefail",
        'REAL_GIT="$(command -v git)"',
        "git() {",
        '  if [ "${1:-}" = "remote" ] && [ "${2:-}" = "set-url" ] && [ "${3:-}" = "origin" ]; then',
        "    return 0",
        "  fi",
        '  "$REAL_GIT" "$@"',
        "}",
        "gh() {",
        '  if [ "${1:-}" = "repo" ] && [ "${2:-}" = "clone" ]; then',
        '    "$REAL_GIT" clone -c core.autocrlf=false "$BARE_ORIGIN" "${4}"',
        "    return $?",
        "  fi",
        '  if [ "${1:-}" = "pr" ] && [ "${2:-}" = "create" ]; then',
        '    printf "%s\\0" "$@" > "$GH_PR_ARGS_FILE"',
        '    echo "https://github.com/mcp-tool-shop-org/repomesh/pull/999"',
        "    return 0",
        "  fi",
        '  if [ "${1:-}" = "pr" ] && [ "${2:-}" = "merge" ]; then',
        "    return 0",
        "  fi",
        '  echo "unexpected gh invocation: $*" >&2',
        "  return 1",
        "}",
        "",
      ].join("\n");

      const scriptPath = path.join(tmpRoot, "run-append.sh");
      fs.writeFileSync(scriptPath, preamble + substituted, "utf8");

      const res = spawnSync(BASH_BIN, [toPosix(scriptPath)], {
        cwd: tmpRoot,
        env: {
          ...process.env,
          GH_TOKEN: "stub-token",
          REPO_SLUG: "repomesh",
          VERSION: branchVersion,
          BARE_ORIGIN: toPosix(fx.bareDir),
          GH_PR_ARGS_FILE: toPosix(ghPrArgsPath),
        },
        encoding: "utf8",
      });
      assert.equal(res.status, 0, `broadcast append step failed (exit ${res.status}):\n${res.stderr}\n${res.stdout}`);

      const ghArgs = fs.readFileSync(ghPrArgsPath, "utf8").split("\0");
      const titleIdx = ghArgs.indexOf("--title");
      const bodyIdx = ghArgs.indexOf("--body");
      assert.notEqual(titleIdx, -1, "gh pr create must pass --title");
      assert.notEqual(bodyIdx, -1, "gh pr create must pass --body");
      assert.equal(ghArgs[titleIdx + 1], `event: mcp-tool-shop-org/repomesh@${branchVersion}`);
      assert.ok(ghArgs[bodyIdx + 1].includes(`**Version:** ${branchVersion}`), "PR body must include expanded VERSION");

      const verifyDir = path.join(tmpRoot, "verify-pr");
      execFileSync("git", ["clone", "--branch", `event/repomesh/${branchVersion}`, fx.bareDir, verifyDir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const prEvents = fs
        .readFileSync(path.join(verifyDir, "ledger", "events", "events.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      const prManifest = JSON.parse(
        fs.readFileSync(path.join(verifyDir, "anchor", "xrpl", "manifests", "all.json"), "utf8"),
      );

      assert.equal(
        prManifest.count,
        prEvents.length,
        `event PR left all.json stale: all.json pins count=${prManifest.count} but the ledger has ${prEvents.length} events`,
      );
      assert.equal(prManifest.algo, "sha256-merkle-v2");
      assert.equal(prManifest.range[1], fx.appendedEvent.signature.canonicalHash);

      const truncatedPath = path.join(tmpRoot, "truncated.jsonl");
      fs.writeFileSync(truncatedPath, prEvents.slice(0, -1).join("\n") + "\n", "utf8");
      const valRes = spawnSync(process.execPath, [VALIDATOR], {
        env: {
          ...process.env,
          HEAD_LEDGER: truncatedPath,
          BASE_LEDGER: "",
          REPOMESH_MANIFESTS_PATH: path.join(verifyDir, "anchor", "xrpl", "manifests"),
        },
        encoding: "utf8",
      });
      assert.notEqual(valRes.status, 0, "dropping the appended event must FAIL validate-ledger against PR manifests");
      assert.match((valRes.stdout || "") + (valRes.stderr || ""), /Immutability violation/);

      const expectedTrust = JSON.stringify(buildTrust({ root: verifyDir, write: false }), null, 2) + "\n";
      const actualTrust = fs.readFileSync(path.join(verifyDir, "registry", "trust.json"), "utf8").replace(/\r\n/g, "\n");
      assert.equal(actualTrust, expectedTrust, "event PR must regenerate registry/trust.json to match buildTrust()");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps .github/workflows/repomesh-broadcast.yml and templates in parity", () => {
    for (const rel of BROADCAST_WORKFLOWS) {
      const step = extractAppendStepScript(rel);
      assert.match(step, /compute-root\.mjs\s+--all/, `${rel} must regenerate all.json via compute-root.mjs --all`);
      assert.match(step, /build-trust\.mjs/, `${rel} must regenerate registry/trust.json via build-trust.mjs`);
      assert.match(step, /anchor\/xrpl\/manifests\/all\.json/, `${rel} must stage anchor/xrpl/manifests/all.json`);
      assert.match(step, /registry\/trust\.json/, `${rel} must stage registry/trust.json`);
      assert.doesNotMatch(step, /\$\{\{\s*github\.event/, `${rel} must not interpolate github.event inside run:`);
    }
  });

  it("forbids interpolating github.ref_name, github.head_ref, inputs.*, or github.event.* inside run: blocks", () => {
    const violations = BROADCAST_WORKFLOWS.flatMap(findUntrustedRunExpressions);
    assert.deepEqual(
      violations,
      [],
      `Untrusted GitHub expression interpolated in run: block: ${violations.join("; ")}`,
    );
  });
});
