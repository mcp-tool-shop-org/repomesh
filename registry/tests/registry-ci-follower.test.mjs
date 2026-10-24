import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const REGISTRY_CI_PATH = path.join(WORKFLOWS_DIR, "registry-ci.yml");

function resolveBashBinary() {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return "bash";
}

const BASH_BIN = resolveBashBinary();

// Extract the shell body of step `Check registry-relevant path changes` from `.github/workflows/registry-ci.yml`
function extractRegistryPathGateScript() {
  const raw = fs.readFileSync(REGISTRY_CI_PATH, "utf8");
  const lines = raw.split(/\r?\n/);
  const stepIdx = lines.findIndex((l) => /^\s*-\s*name:\s*Check registry-relevant path changes\s*$/.test(l));
  assert.notEqual(stepIdx, -1, "registry-ci.yml must contain step 'Check registry-relevant path changes'");

  let runIdx = -1;
  for (let i = stepIdx + 1; i < lines.length; i++) {
    if (/^\s*-\s*(name|uses):/.test(lines[i])) break;
    if (/^\s*run:\s*\|\s*$/.test(lines[i])) {
      runIdx = i;
      break;
    }
  }
  assert.notEqual(runIdx, -1, "step 'Check registry-relevant path changes' must have a 'run: |' block");

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

function createTempRepoWithCommits(commitSpecs) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-reg-follower-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: tmpDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  git("init", "-b", "main");
  git("config", "user.name", "test-bot");
  git("config", "user.email", "test-bot@example.invalid");

  const shas = [];
  for (let i = 0; i < commitSpecs.length; i++) {
    const spec = commitSpecs[i];
    for (const [relFile, content] of Object.entries(spec.files)) {
      const fullPath = path.join(tmpDir, relFile);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }
    git("add", "-A");
    git("commit", "-m", spec.message || `commit-${i}`);
    shas.push(git("rev-parse", "HEAD"));
  }
  return { tmpDir, shas };
}

function runPathGateOffline({ repoDir, headSha, stubGhSha = "", stubGhExit = 0, eventName = "workflow_run" }) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-stub-gh-"));
  const outputFile = path.join(binDir, "github-output.txt");
  fs.writeFileSync(outputFile, "", "utf8");

  // Write a portable stub `gh` script for bash + a `.cmd` wrapper on Windows
  const ghSh = path.join(binDir, "gh");
  fs.writeFileSync(
    ghSh,
    `#!/usr/bin/env bash\nif [ "${stubGhExit}" != "0" ]; then\n  echo "stub gh api error" >&2\n  exit ${stubGhExit}\nfi\necho "${stubGhSha}"\n`,
    { encoding: "utf8", mode: 0o755 }
  );

  const scriptFile = path.join(binDir, "path-gate.sh");
  fs.writeFileSync(scriptFile, extractRegistryPathGateScript(), "utf8");

  try {
    const pathSep = process.platform === "win32" ? ";" : ":";
    const env = {
      ...process.env,
      PATH: `${binDir}${pathSep}${process.env.PATH || ""}`,
      GITHUB_OUTPUT: outputFile,
      GH_TOKEN: "stub-token",
      WF_REPO: "mcp-tool-shop-org/repomesh",
      WF_EVENT_NAME: eventName,
      WF_HEAD_SHA: headSha,
    };
    const res = spawnSync(BASH_BIN, [scriptFile], {
      cwd: repoDir,
      env,
      encoding: "utf8",
    });
    const ghOutput = fs.readFileSync(outputFile, "utf8").trim();
    return {
      status: res.status ?? 1,
      stdout: res.stdout || "",
      stderr: res.stderr || "",
      ghOutput,
    };
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

describe("FIX 1 — registry-ci path gate diffs from last successful registry-ci head_sha (offline)", () => {
  it("a 3-commit push with the registry change in the first commit runs (changed=true)", () => {
    const { tmpDir, shas } = createTempRepoWithCommits([
      { message: "c0: base", files: { "README.md": "base\n", "ledger/events/events.jsonl": "{}\n" } },
      { message: "c1: registry change in first commit of push", files: { "ledger/events/events.jsonl": "{}\n{\"seq\":2}\n" } },
      { message: "c2: docs edit", files: { "README.md": "base v2\n" } },
      { message: "c3: tip non-registry edit", files: { "docs/notes.md": "notes\n" } },
    ]);
    try {
      const res = runPathGateOffline({
        repoDir: tmpDir,
        headSha: shas[3],
        stubGhSha: shas[0],
        stubGhExit: 0,
      });
      assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
      assert.match(res.ghOutput, /^changed=true$/m, `expected changed=true for 3-commit push, got: ${res.ghOutput}\nstdout: ${res.stdout}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("a push touching no registry path exits early (changed=false)", () => {
    const { tmpDir, shas } = createTempRepoWithCommits([
      { message: "c0: base", files: { "README.md": "base\n", "ledger/events/events.jsonl": "{}\n" } },
      { message: "c1: docs edit 1", files: { "README.md": "base v2\n" } },
      { message: "c2: docs edit 2", files: { "docs/notes.md": "notes\n" } },
    ]);
    try {
      const res = runPathGateOffline({
        repoDir: tmpDir,
        headSha: shas[2],
        stubGhSha: shas[0],
        stubGhExit: 0,
      });
      assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
      assert.match(res.ghOutput, /^changed=false$/m, `expected changed=false when no registry path changed, got: ${res.ghOutput}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("an API failure runs unconditionally (changed=true)", () => {
    const { tmpDir, shas } = createTempRepoWithCommits([
      { message: "c0: base", files: { "README.md": "base\n", "ledger/events/events.jsonl": "{}\n" } },
      { message: "c1: docs edit only", files: { "README.md": "base v2\n" } },
    ]);
    try {
      const res = runPathGateOffline({
        repoDir: tmpDir,
        headSha: shas[1],
        stubGhSha: "",
        stubGhExit: 1,
      });
      assert.equal(res.status, 0, `expected exit 0 on API failure fallback, got ${res.status}: ${res.stderr}`);
      assert.match(res.ghOutput, /^changed=true$/m, `expected changed=true on API failure, got: ${res.ghOutput}\nstdout: ${res.stdout}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("FIX 2 — no ${{ github.event... }} interpolation inside any workflow run: block", () => {
  it("no workflow file in .github/workflows/ interpolates github.event inside a run: script", () => {
    const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    const violations = [];

    for (const file of files) {
      const fullPath = path.join(WORKFLOWS_DIR, file);
      const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
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
            if (/\$\{\{\s*github\.event/.test(line)) {
              violations.push(`${file}:${i + 1}: ${trimmed}`);
            }
            continue;
          }
        }

        const runMatch = line.match(/^(\s*(?:-\s*)?)run:\s*(.*)$/);
        if (runMatch) {
          const rest = runMatch[2].trim();
          if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
            inRunBlock = true;
            runIndent = line.indexOf("run:");
          } else if (/\$\{\{\s*github\.event/.test(rest)) {
            violations.push(`${file}:${i + 1}: ${trimmed}`);
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found \${{ github.event... }} interpolation inside run: blocks:\n${violations.join("\n")}`
    );
  });
});
