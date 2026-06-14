// FC8 (#5 CLI-F01) — the composite GitHub Action that shells `npx @mcptoolshop/repomesh@<pinned>
// verify-release`. This is a GATE WRAPPER, not a re-implementation of verification: the test asserts
// the action.yml is a valid composite action with the contracted inputs/outputs, that it shells the
// documented npx command (FC2) against a PINNED CLI version, maps the FC1 tri-state exit code, writes
// the markdown to $GITHUB_STEP_SUMMARY, and optionally uploads SARIF. RED before action.yml exists,
// GREEN after. We parse the YAML with a tiny embedded subset-parser (no new dependency) plus literal
// contract assertions on the run script.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ACTION_PATH = path.resolve(REPO_ROOT, ".github", "actions", "verify", "action.yml");

// --- Tiny YAML subset parser ---------------------------------------------------------------
// Handles the constructs an action.yml uses: nested maps by indentation, scalar values,
// quoted strings, and block scalars (`|`). NOT a general YAML parser — just enough to assert
// the action's structure. Block scalars (`run: |`) are captured as a single multiline string.
function parseYaml(src) {
  const lines = src.split(/\r?\n/);
  const root = {};
  // stack of { indent, container }
  const stack = [{ indent: -1, container: root }];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    // skip blank lines and full-line comments
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) { i++; continue; }
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    // pop stack to current indent
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].container;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1].trim();
    let val = m[2];
    if (val === "|" || val === "|-" || val === ">" || val === ">-") {
      // block scalar: gather subsequent more-indented lines verbatim
      const blockLines = [];
      let j = i + 1;
      let blockIndent = null;
      while (j < lines.length) {
        const bl = lines[j];
        if (/^\s*$/.test(bl)) { blockLines.push(""); j++; continue; }
        const bIndent = bl.length - bl.trimStart().length;
        if (bIndent <= indent) break;
        if (blockIndent === null) blockIndent = bIndent;
        blockLines.push(bl.slice(blockIndent));
        j++;
      }
      // trim trailing blank lines
      while (blockLines.length && blockLines[blockLines.length - 1] === "") blockLines.pop();
      parent[key] = blockLines.join("\n");
      i = j;
      continue;
    }
    if (val === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, container: child });
      i++;
      continue;
    }
    // scalar value — strip surrounding quotes if present
    val = val.replace(/^#.*$/, "").trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    parent[key] = val;
    i++;
  }
  return root;
}

describe("FC8 — composite verify Action", () => {
  it("action.yml exists at .github/actions/verify/", () => {
    assert.ok(fs.existsSync(ACTION_PATH), `expected composite action at ${ACTION_PATH}`);
  });

  it("is a valid composite action (name, description, runs.using=composite)", () => {
    const doc = parseYaml(fs.readFileSync(ACTION_PATH, "utf8"));
    assert.ok(doc.name, "action must declare a name");
    assert.ok(doc.description, "action must declare a description");
    assert.ok(doc.runs, "action must declare runs");
    assert.equal(doc.runs.using, "composite", "runs.using must be 'composite'");
    assert.ok(Array.isArray(doc.runs.steps) || doc.runs.steps, "composite action must declare steps");
  });

  it("declares the FC8 inputs {repo, version, anchored, fail-on, format}", () => {
    const doc = parseYaml(fs.readFileSync(ACTION_PATH, "utf8"));
    assert.ok(doc.inputs, "action must declare inputs");
    for (const k of ["repo", "version", "anchored", "fail-on", "format"]) {
      assert.ok(doc.inputs[k], `missing input: ${k}`);
    }
    assert.equal(doc.inputs.repo.required, "true", "repo input must be required");
    assert.equal(doc.inputs.version.required, "true", "version input must be required");
  });

  it("declares the FC8 outputs {status, ok}", () => {
    const doc = parseYaml(fs.readFileSync(ACTION_PATH, "utf8"));
    assert.ok(doc.outputs, "action must declare outputs");
    for (const k of ["status", "ok"]) {
      assert.ok(doc.outputs[k], `missing output: ${k}`);
    }
  });

  it("shells the documented npx contract (FC2) against a PINNED CLI version", () => {
    const src = fs.readFileSync(ACTION_PATH, "utf8");
    const doc = parseYaml(src);
    // FC2: npx @mcptoolshop/repomesh@<pinned> verify-release — never `node tools/...` and never an
    // unpinned `npx @mcptoolshop/repomesh` for the verify path. The pin is expressed as a
    // cli-version input whose DEFAULT is a concrete X.Y.Z (PIN_PER_STEP — replayable by default).
    assert.match(src, /npx\s+(?:--yes\s+|-y\s+)?["']?@mcptoolshop\/repomesh@\$\{RM_CLI_VERSION\}["']?\s+verify-release/,
      "run script must shell npx @mcptoolshop/repomesh@<cli-version> verify-release");
    assert.ok(doc.inputs && doc.inputs["cli-version"], "must declare a cli-version input");
    assert.match(String(doc.inputs["cli-version"].default), /^\d+\.\d+\.\d+$/,
      "cli-version default must be a concrete pinned X.Y.Z");
    assert.doesNotMatch(src, /node\s+tools\/repomesh\.mjs/, "must NOT re-implement via node tools/");
  });

  it("threads the inputs into CLI flags (--repo --version --fail-on --format, conditional --anchored)", () => {
    const src = fs.readFileSync(ACTION_PATH, "utf8");
    assert.match(src, /--repo/, "must pass --repo");
    assert.match(src, /--version/, "must pass --version");
    assert.match(src, /--fail-on/, "must pass --fail-on");
    assert.match(src, /--format/, "must pass --format");
    assert.match(src, /--anchored/, "must conditionally pass --anchored");
    // FC1: the action must map the tri-state exit code (0 PASS / 1 FAIL / 3 UNVERIFIED / 2 error).
    assert.match(src, /\$\?|exit[_-]?code|GITHUB_OUTPUT/i, "must capture/map the process exit code");
  });

  it("writes the markdown summary to $GITHUB_STEP_SUMMARY", () => {
    const src = fs.readFileSync(ACTION_PATH, "utf8");
    assert.match(src, /GITHUB_STEP_SUMMARY/, "must write the job summary");
    // job summary should come from --format markdown
    assert.match(src, /--format\s+markdown|format[=:]?\s*markdown|markdown/i, "summary should use the markdown format");
  });

  it("supports SARIF upload (optional) for the GitHub Security tab", () => {
    const src = fs.readFileSync(ACTION_PATH, "utf8");
    assert.match(src, /sarif/i, "must reference SARIF for optional upload");
  });
});
