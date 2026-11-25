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

function extractWorkflowStep(workflowRelPath, stepName) {
  const raw = fs.readFileSync(path.join(REPO_ROOT, workflowRelPath), "utf8");
  const lines = raw.split(/\r?\n/);
  let stepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s*name:\s*(.+?)\s*$/);
    if (m && m[2] === stepName) {
      stepIdx = i;
      break;
    }
  }
  assert.notEqual(stepIdx, -1, `${workflowRelPath} must contain step '${stepName}'`);

  const stepDashIndent = lines[stepIdx].match(/^(\s*)/)[1].length;
  const env = {};
  let inEnv = false;
  let envIndent = 0;
  let runIdx = -1;

  for (let i = stepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= stepDashIndent) break;

    if (inEnv) {
      if (indent > envIndent) {
        const kv = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (kv) {
          env[kv[1]] = kv[2].trim();
        }
        continue;
      }
      inEnv = false;
    }

    if (/^env:\s*$/.test(trimmed)) {
      inEnv = true;
      envIndent = indent;
      continue;
    }

    if (/^run:\s*\|\s*$/.test(trimmed)) {
      runIdx = i;
      break;
    }
  }
  assert.notEqual(runIdx, -1, `${workflowRelPath} step '${stepName}' must have a 'run: |' block`);

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
  return { env, run: bodyLines.join("\n") + "\n" };
}

function resolveStepVersionEnv(step, workflowRelPath, stepName, { inputVersion = "", refName = "" }) {
  assert.ok(
    Object.hasOwn(step.env, "VERSION") && step.env.VERSION.length > 0,
    `${workflowRelPath} step '${stepName}' must define VERSION in step env:`,
  );
  const expr = step.env.VERSION;
  if (/^\$\{\{\s*inputs\.version\s*\|\|\s*github\.ref_name\s*\}\}$/.test(expr)) {
    return inputVersion || refName;
  }
  if (/^\$\{\{\s*github\.ref_name\s*\}\}$/.test(expr)) {
    return refName;
  }
  assert.fail(`${workflowRelPath} step '${stepName}' has unsupported VERSION env expression: ${expr}`);
}

function extractMustacheSpans(text) {
  const spans = [];
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf("${{", pos);
    if (start === -1) break;
    let i = start + 3;
    let inSingleQuote = false;
    let end = text.length;
    while (i < text.length) {
      const ch = text[i];
      if (inSingleQuote) {
        if (ch === "'") {
          if (text[i + 1] === "'") {
            i += 2;
            continue;
          }
          inSingleQuote = false;
        }
        i += 1;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = true;
        i += 1;
        continue;
      }
      if (ch === "}" && text[i + 1] === "}") {
        end = i + 2;
        break;
      }
      i += 1;
    }
    spans.push({ start, expr: text.slice(start, end) });
    pos = end;
  }
  return spans;
}

const UNTRUSTED_EXPR_PATTERNS = [
  /\bgithub\s*\.\s*(?:ref_name|head_ref|ref|event)\b/i,
  /\bgithub\s*\[\s*['"](?:ref_name|head_ref|ref|event)['"]\s*\]/i,
  /\binputs\s*(?:\.|\[)/i,
];

function findUntrustedRunExpressionsInYaml(rawYaml, sourceLabel = "workflow.yml") {
  const lines = rawYaml.split(/\r?\n/);
  const violations = [];
  const blockHeaderRe = /^[|>](?:[1-9]?[+-]?|[+-]?[1-9]?)(?:\s+#.*)?$/;

  let inScalar = false;
  let isBlockScalar = false;
  let ownerIndent = 0;
  let blockBodyIndent = null;
  let segments = [];

  const flushScalar = () => {
    if (segments.length === 0) return;
    let joined = "";
    const ranges = [];
    for (const seg of segments) {
      const offset = joined.length;
      joined += (joined.length > 0 ? "\n" : "") + seg.text;
      ranges.push({ offset: joined.length > seg.text.length ? offset + 1 : offset, lineNo: seg.lineNo });
    }
    for (const span of extractMustacheSpans(joined)) {
      if (UNTRUSTED_EXPR_PATTERNS.some((re) => re.test(span.expr))) {
        let lineNo = ranges[0].lineNo;
        for (const r of ranges) {
          if (r.offset <= span.start) lineNo = r.lineNo;
          else break;
        }
        const compact = span.expr.replace(/\s+/g, " ").trim();
        violations.push(`${sourceLabel}:${lineNo}: ${compact}`);
      }
    }
    segments = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.match(/^(\s*)/)[1].length;

    if (inScalar) {
      if (trimmed === "") {
        segments.push({ lineNo: i + 1, text: "" });
        continue;
      }
      if (isBlockScalar) {
        if (blockBodyIndent === null) {
          if (indent > ownerIndent) {
            blockBodyIndent = indent;
            segments.push({ lineNo: i + 1, text: trimmed });
            continue;
          }
          flushScalar();
          inScalar = false;
        } else if (indent >= blockBodyIndent) {
          segments.push({ lineNo: i + 1, text: trimmed });
          continue;
        } else {
          flushScalar();
          inScalar = false;
        }
      } else if (indent > ownerIndent) {
        segments.push({ lineNo: i + 1, text: trimmed });
        continue;
      } else {
        flushScalar();
        inScalar = false;
      }
    }

    if (trimmed === "" || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("{") || /^-\s*\{/.test(trimmed)) {
      violations.push(`${sourceLabel}:${i + 1}: flow-mapping step is not allowed: ${trimmed}`);
      continue;
    }

    const keyMatch = line.match(/^\s*(?:-\s*)?(run|script):\s*(.*)$/);
    if (keyMatch) {
      const rest = keyMatch[2].trim();
      ownerIndent = indent;
      blockBodyIndent = null;
      segments = [];
      if (blockHeaderRe.test(rest)) {
        inScalar = true;
        isBlockScalar = true;
      } else {
        inScalar = true;
        isBlockScalar = false;
        if (rest.length > 0) {
          segments.push({ lineNo: i + 1, text: rest });
        }
      }
    }
  }

  if (inScalar) {
    flushScalar();
  }
  return violations;
}

function findUntrustedRunExpressions(workflowRelPath) {
  const rawYaml = fs.readFileSync(path.join(REPO_ROOT, workflowRelPath), "utf8");
  return findUntrustedRunExpressionsInYaml(rawYaml, workflowRelPath);
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
      const workflowRel = ".github/workflows/repomesh-broadcast.yml";
      const stepName = "Append to ledger via PR";
      const step = extractWorkflowStep(workflowRel, stepName);

      const branchVersion = "v0.0.0-test";
      const resolvedVersion = resolveStepVersionEnv(step, workflowRel, stepName, {
        inputVersion: branchVersion,
        refName: branchVersion,
      });
      const ghPrArgsPath = path.join(tmpRoot, "gh-pr-create.args");
      const substituted = step.run
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
          VERSION: resolvedVersion,
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
      const uploadStep = extractWorkflowStep(rel, "Upload attestation assets");
      assert.ok(Object.hasOwn(uploadStep.env, "VERSION"), `${rel} Upload attestation assets must set VERSION env`);
      assert.match(uploadStep.run, /Invalid semver version/, `${rel} Upload attestation assets must validate semver`);
      assert.match(
        uploadStep.run,
        /gh release upload --clobber -- "\$VERSION" \/tmp\/repomesh\/sbom\.json/,
        `${rel} Upload attestation assets must put -- before "$VERSION" for sbom upload`,
      );
      assert.match(
        uploadStep.run,
        /gh release upload --clobber -- "\$VERSION" \/tmp\/repomesh\/provenance\.json/,
        `${rel} Upload attestation assets must put -- before "$VERSION" for provenance upload`,
      );

      const step = extractWorkflowStep(rel, "Append to ledger via PR");
      assert.ok(Object.hasOwn(step.env, "VERSION"), `${rel} Append to ledger via PR must set VERSION env`);
      assert.match(step.run, /Invalid semver version/, `${rel} Append to ledger via PR must validate semver`);
      assert.match(step.run, /compute-root\.mjs\s+--all/, `${rel} must regenerate all.json via compute-root.mjs --all`);
      assert.match(step.run, /build-trust\.mjs/, `${rel} must regenerate registry/trust.json via build-trust.mjs`);
      assert.match(step.run, /anchor\/xrpl\/manifests\/all\.json/, `${rel} must stage anchor/xrpl/manifests/all.json`);
      assert.match(step.run, /registry\/trust\.json/, `${rel} must stage registry/trust.json`);
      assert.doesNotMatch(step.run, /\$\{\{\s*github\.event/, `${rel} must not interpolate github.event inside run:`);
    }
    const ghAppend = extractWorkflowStep(".github/workflows/repomesh-broadcast.yml", "Append to ledger via PR");
    assert.match(
      ghAppend.run,
      /gh pr merge --auto --merge --repo "\$\{\{ env\.REPOMESH_LEDGER_REPO \}\}" -- "\$PR_URL"/,
      ".github/workflows/repomesh-broadcast.yml must put -- before \"$PR_URL\" in gh pr merge",
    );
  });

  it("rejects option-like VERSION (--repo=x) in Upload attestation assets", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rm-semver-upload-"));
    try {
      const workflowRel = ".github/workflows/repomesh-broadcast.yml";
      const stepName = "Upload attestation assets";
      const step = extractWorkflowStep(workflowRel, stepName);
      const badVersion = resolveStepVersionEnv(step, workflowRel, stepName, {
        inputVersion: "--repo=x",
        refName: "v1.0.0",
      });
      const markerPath = path.join(tmpRoot, "gh-called");
      const scriptPath = path.join(tmpRoot, "upload.sh");
      const preamble = [
        "set -euo pipefail",
        "gh() {",
        '  : > "$GH_CALLED_MARKER"',
        '  echo "gh should not have been called: $*" >&2',
        "  return 99",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(scriptPath, preamble + step.run, "utf8");
      const res = spawnSync(BASH_BIN, [toPosix(scriptPath)], {
        cwd: tmpRoot,
        env: {
          ...process.env,
          GH_TOKEN: "stub-token",
          VERSION: badVersion,
          GH_CALLED_MARKER: toPosix(markerPath),
        },
        encoding: "utf8",
      });
      assert.notEqual(res.status, 0, "option-like VERSION must fail Upload attestation assets");
      assert.match(res.stderr, /Invalid semver version: --repo=x/);
      assert.equal(fs.existsSync(markerPath), false, "gh must not execute when VERSION is not semver");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("rejects option-like VERSION (--repo=x) in Append to ledger via PR", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rm-semver-append-"));
    try {
      const workflowRel = ".github/workflows/repomesh-broadcast.yml";
      const stepName = "Append to ledger via PR";
      const step = extractWorkflowStep(workflowRel, stepName);
      const badVersion = resolveStepVersionEnv(step, workflowRel, stepName, {
        inputVersion: "--repo=x",
        refName: "v1.0.0",
      });
      const markerPath = path.join(tmpRoot, "gh-called");
      const scriptPath = path.join(tmpRoot, "append.sh");
      const substituted = step.run
        .replaceAll("${{ env.REPOMESH_LEDGER_REPO }}", "mcp-tool-shop-org/repomesh")
        .replaceAll("${{ github.repository }}", "mcp-tool-shop-org/repomesh")
        .replaceAll("${{ github.sha }}", "0000000000000000000000000000000000000000");
      const preamble = [
        "set -euo pipefail",
        "gh() {",
        '  : > "$GH_CALLED_MARKER"',
        '  echo "gh should not have been called: $*" >&2',
        "  return 99",
        "}",
        "",
      ].join("\n");
      fs.writeFileSync(scriptPath, preamble + substituted, "utf8");
      const res = spawnSync(BASH_BIN, [toPosix(scriptPath)], {
        cwd: tmpRoot,
        env: {
          ...process.env,
          GH_TOKEN: "stub-token",
          REPO_SLUG: "repomesh",
          VERSION: badVersion,
          GH_CALLED_MARKER: toPosix(markerPath),
        },
        encoding: "utf8",
      });
      assert.notEqual(res.status, 0, "option-like VERSION must fail Append to ledger via PR");
      assert.match(res.stderr, /Invalid semver version: --repo=x/);
      assert.equal(fs.existsSync(markerPath), false, "gh must not execute when VERSION is not semver");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
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

  it("detector catches expression containing '}' before its end", () => {
    const yaml = [
      "steps:",
      "  - name: Braces before end",
      "    run: echo \"${{ format('{0}', github.ref_name) }}\"",
    ].join("\n");
    const violations = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(violations.length >= 1, `expected violation for embedded '}'; got ${JSON.stringify(violations)}`);
  });

  it("detector catches uppercase/mixed-case expressions (GITHUB.REF_NAME)", () => {
    const yaml = [
      "steps:",
      "  - name: Uppercase",
      "    run: echo \"${{ GITHUB.REF_NAME }}\"",
    ].join("\n");
    const violations = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(violations.length >= 1, `expected violation for uppercase GITHUB.REF_NAME; got ${JSON.stringify(violations)}`);
  });

  it("detector catches github.ref", () => {
    const yaml = [
      "steps:",
      "  - name: GitHub ref",
      "    run: echo \"${{ github.ref }}\"",
    ].join("\n");
    const violations = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(violations.length >= 1, `expected violation for github.ref; got ${JSON.stringify(violations)}`);
  });

  it("detector catches dotless github.event (e.g. toJSON(github.event))", () => {
    const yaml = [
      "steps:",
      "  - name: Dotless github.event",
      "    run: echo '${{ toJSON(github.event) }}'",
    ].join("\n");
    const violations = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(violations.length >= 1, `expected violation for dotless github.event; got ${JSON.stringify(violations)}`);
  });

  it("detector catches bracket syntax on github (github['head_ref'])", () => {
    const yaml = [
      "steps:",
      "  - name: Bracket github",
      "    run: echo \"${{ github['head_ref'] }}\"",
    ].join("\n");
    const v = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(v.length >= 1, `expected violation for github['head_ref']; got ${JSON.stringify(v)}`);
  });

  it("detector catches bracket syntax on inputs (inputs['version'])", () => {
    const yaml = [
      "steps:",
      "  - name: Bracket inputs",
      "    run: echo \"${{ inputs['version'] }}\"",
    ].join("\n");
    const v = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(v.length >= 1, `expected violation for inputs['version']; got ${JSON.stringify(v)}`);
  });

  it("detector catches block scalar header run: |2", () => {
    const yaml = "steps:\n  - run: |2\n      echo \"${{ github.ref_name }}\"";
    const v = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(v.length >= 1, `expected violation for block header '|2'; got ${JSON.stringify(v)}`);
  });

  it("detector catches block scalar header run: >-", () => {
    const yaml = "steps:\n  - run: >-\n      echo \"${{ github.ref_name }}\"";
    const v = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(v.length >= 1, `expected violation for block header '>-'; got ${JSON.stringify(v)}`);
  });

  it("detector catches block scalar header run: | # comment", () => {
    const yaml = "steps:\n  - run: | # comment\n      echo \"${{ github.ref_name }}\"";
    const v = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(v.length >= 1, `expected violation for block header '| # comment'; got ${JSON.stringify(v)}`);
  });

  it("detector catches expressions split across two lines", () => {
    const yaml = [
      "steps:",
      "  - name: Multiline expr",
      "    run: |",
      "      echo \"${{",
      "        github.ref_name",
      "      }}\"",
    ].join("\n");
    const violations = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(violations.length >= 1, `expected violation for multi-line expression; got ${JSON.stringify(violations)}`);
  });

  it("detector catches actions/github-script script: blocks", () => {
    const yaml = [
      "steps:",
      "  - uses: actions/github-script@v7",
      "    with:",
      "      script: |",
      "        console.log('${{ github.event.issue.title }}')",
    ].join("\n");
    const violations = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(violations.length >= 1, `expected violation for actions/github-script script:; got ${JSON.stringify(violations)}`);
  });

  it("detector refuses flow-mapping steps (- { run: ... })", () => {
    const yaml = [
      "steps:",
      "  - { run: 'echo ${{ github.ref_name }}' }",
    ].join("\n");
    const violations = findUntrustedRunExpressionsInYaml(yaml, "fixture.yml");
    assert.ok(violations.length >= 1, `expected flow-mapping step refusal; got ${JSON.stringify(violations)}`);
  });

  it("detector allows safe expressions in run:/script: and untrusted expressions in step env:", () => {
    const yaml = [
      "steps:",
      "  - name: Safe step",
      "    env:",
      "      VERSION: ${{ inputs.version || github.ref_name }}",
      "    run: |",
      "      echo \"${{ github.repository }} ${{ github.sha }} ${{ github.run_id }} ${{ env.REPOMESH_LEDGER_REPO }}\"",
      "      echo \"$VERSION\"",
      "  - uses: actions/github-script@v7",
      "    with:",
      "      script: |",
      "        console.log('${{ github.repository }}')",
    ].join("\n");
    assert.deepEqual(findUntrustedRunExpressionsInYaml(yaml, "safe.yml"), []);
  });
});
