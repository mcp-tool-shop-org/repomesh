import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_EVENT_PATHS, evaluateEventPathGuard, MAX_PR_FILES } from "../ci/event-path-guard.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const GUARD_SCRIPT = path.resolve(HERE, "..", "ci", "event-path-guard.mjs");
const CODEOWNERS_PATH = path.join(REPO_ROOT, ".github", "CODEOWNERS");
const BROADCAST_WORKFLOWS = [
  ".github/workflows/repomesh-broadcast.yml",
  "templates/repomesh-broadcast.yml",
  "packages/repomesh-cli/templates/repomesh-broadcast.yml",
];

const THREE_EVENT_FILES = [
  { filename: "ledger/events/events.jsonl", status: "modified" },
  { filename: "anchor/xrpl/manifests/all.json", status: "modified" },
  { filename: "registry/trust.json", status: "modified" },
];

function makeRegularTreeEntries(paths = THREE_EVENT_FILES.map((f) => f.filename), overrides = {}) {
  const entries = {};
  for (const p of paths) {
    entries[p] = { mode: "100644", type: "blob" };
  }
  return { ...entries, ...overrides };
}

function parseCodeowners(raw) {
  const rules = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    rules.push({ pattern: parts[0], owners: parts.slice(1) });
  }
  return rules;
}

function extractAppendGitAddPaths(workflowRelPath) {
  const raw = fs.readFileSync(path.join(REPO_ROOT, workflowRelPath), "utf8");
  const lines = raw.split(/\r?\n/);
  const stepIdx = lines.findIndex((l) => /^\s*-\s*name:\s*Append to ledger via PR\s*$/.test(l));
  assert.notEqual(stepIdx, -1, `${workflowRelPath} must contain step 'Append to ledger via PR'`);
  let runIdx = -1;
  for (let i = stepIdx + 1; i < lines.length; i++) {
    if (/^\s*-\s*(name|uses):/.test(lines[i])) break;
    if (/^\s*run:\s*\|/.test(lines[i])) {
      runIdx = i;
      break;
    }
  }
  assert.notEqual(runIdx, -1, `${workflowRelPath} must have run: | in 'Append to ledger via PR'`);
  let gitAddLine = null;
  for (let i = runIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== "" && /^\s*-\s*(name|uses):/.test(lines[i])) break;
    const m = lines[i].match(/^\s*git add\s+(.+)$/);
    if (m) {
      gitAddLine = m[1].trim();
      break;
    }
  }
  assert.ok(gitAddLine, `${workflowRelPath} 'Append to ledger via PR' must run 'git add ...'`);
  return gitAddLine.split(/\s+/);
}

describe("event-path-guard (offline lint helper)", () => {
  it("rejects a script-edit change set", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "anchor/xrpl/scripts/compute-root.mjs", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["anchor/xrpl/scripts/compute-root.mjs"]),
    });
    assert.equal(res.ok, false, `expected script-edit PR to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => r.includes("anchor/xrpl/scripts/compute-root.mjs")));
  });

  it("allows a pure event change set (the three paths, modified, mode 100644)", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 3,
      files: THREE_EVENT_FILES,
      headTreeEntries: makeRegularTreeEntries(),
    });
    assert.equal(res.ok, true, `expected pure event PR to PASS, got ${JSON.stringify(res)}`);
  });

  it("rejects a mixed event + script change set", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 4,
      files: [...THREE_EVENT_FILES, { filename: "registry/scripts/build-trust.mjs", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries([
        ...THREE_EVENT_FILES.map((f) => f.filename),
        "registry/scripts/build-trust.mjs",
      ]),
    });
    assert.equal(res.ok, false, `expected mixed event + script PR to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => r.includes("registry/scripts/build-trust.mjs")));
  });

  it("rejects a rename from ledger/events/x to registry/scripts/x", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [
        {
          filename: "registry/scripts/x",
          previous_filename: "ledger/events/x",
          status: "renamed",
        },
      ],
      headTreeEntries: makeRegularTreeEntries(["registry/scripts/x"]),
    });
    assert.equal(res.ok, false, `expected rename from ledger/events/x to registry/scripts/x to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => /rename/i.test(r)));
  });

  it("rejects a rename onto an allowed path", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [
        {
          filename: "registry/trust.json",
          previous_filename: "scripts/evil-payload.json",
          status: "renamed",
        },
      ],
      headTreeEntries: makeRegularTreeEntries(["registry/trust.json"]),
    });
    assert.equal(res.ok, false, `expected rename onto allowed path to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => /rename/i.test(r)));
  });

  it("rejects a symlink at ledger/events/events.jsonl (mode 120000)", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "ledger/events/events.jsonl", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["ledger/events/events.jsonl"], {
        "ledger/events/events.jsonl": { mode: "120000", type: "blob" },
      }),
    });
    assert.equal(res.ok, false, `expected symlink mode 120000 to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => r.includes("120000")));
  });

  it("rejects a mode change to 100755 on an allowed path", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "anchor/xrpl/manifests/all.json", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["anchor/xrpl/manifests/all.json"], {
        "anchor/xrpl/manifests/all.json": { mode: "100755", type: "blob" },
      }),
    });
    assert.equal(res.ok, false, `expected executable mode 100755 to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => r.includes("100755")));
  });

  it("rejects removing an allowed file", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "registry/trust.json", status: "removed" }],
      headTreeEntries: makeRegularTreeEntries(["ledger/events/events.jsonl", "anchor/xrpl/manifests/all.json"]),
    });
    assert.equal(res.ok, false, `expected removing an allowed file to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => /removal/i.test(r)));
  });

  it("rejects a .github/workflows/ledger-ci.yml edit", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: ".github/workflows/ledger-ci.yml", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries([".github/workflows/ledger-ci.yml"]),
    });
    assert.equal(res.ok, false, `expected workflow edit to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => r.includes(".github/workflows/ledger-ci.yml")));
  });

  it("rejects a file-list count mismatch or cap", () => {
    const mismatchRes = evaluateEventPathGuard({
      changedFilesCount: 4,
      files: THREE_EVENT_FILES,
      headTreeEntries: makeRegularTreeEntries(),
    });
    assert.equal(mismatchRes.ok, false, `expected count mismatch to FAIL, got ${JSON.stringify(mismatchRes)}`);

    const capFiles = Array.from({ length: MAX_PR_FILES }, (_, i) => ({
      filename: `ledger/events/events-${i}.jsonl`,
      status: "modified",
    }));
    const capRes = evaluateEventPathGuard({
      changedFilesCount: MAX_PR_FILES,
      files: capFiles,
      headTreeEntries: makeRegularTreeEntries(),
    });
    assert.equal(capRes.ok, false, `expected file-list cap to FAIL closed, got ${JSON.stringify(capRes)}`);
  });

  it("always rejects script edits even when admin author/sender metadata is supplied (no exemption)", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "anchor/xrpl/scripts/compute-root.mjs", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["anchor/xrpl/scripts/compute-root.mjs"]),
      authorLogin: "repo-admin",
      authorRole: "admin",
      senderLogin: "repo-admin",
      senderRole: "admin",
    });
    assert.equal(
      res.ok,
      false,
      `expected script edit with admin metadata to FAIL lint (no exemption), got ${JSON.stringify(res)}`,
    );
    assert.equal(Object.hasOwn(res, "exempted"), false);
  });

  it("rejects a submodule entry (mode 160000) and supports CLI JSON execution", () => {
    const subRes = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "registry/trust.json", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["registry/trust.json"], {
        "registry/trust.json": { mode: "160000", type: "commit" },
      }),
    });
    assert.equal(subRes.ok, false, `expected submodule mode 160000 to FAIL, got ${JSON.stringify(subRes)}`);
    assert.ok(subRes.reasons.some((r) => r.includes("160000")));

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-guard-cli-"));
    try {
      const passFile = path.join(tmpDir, "pass.json");
      fs.writeFileSync(
        passFile,
        JSON.stringify({
          changedFilesCount: 3,
          files: THREE_EVENT_FILES,
          headTreeEntries: makeRegularTreeEntries(),
        }),
        "utf8",
      );
      const cliPass = spawnSync(process.execPath, [GUARD_SCRIPT, passFile], { encoding: "utf8" });
      assert.equal(cliPass.status, 0, `expected CLI pass to exit 0: ${cliPass.stdout}\n${cliPass.stderr}`);

      const failFile = path.join(tmpDir, "fail.json");
      fs.writeFileSync(
        failFile,
        JSON.stringify({
          changedFilesCount: 1,
          files: [{ filename: "scripts/ci/event-path-guard.mjs", status: "modified" }],
          headTreeEntries: makeRegularTreeEntries(["scripts/ci/event-path-guard.mjs"]),
        }),
        "utf8",
      );
      const cliFail = spawnSync(process.execPath, [GUARD_SCRIPT, failFile], { encoding: "utf8" });
      assert.equal(cliFail.status, 1, `expected CLI fail to exit 1: ${cliFail.stdout}\n${cliFail.stderr}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("CODEOWNERS owns * via @mcp-tool-shop and leaves unowned exactly the three broadcast git-add event files", () => {
    const rules = parseCodeowners(fs.readFileSync(CODEOWNERS_PATH, "utf8"));
    assert.equal(rules.length, 4, `expected 4 CODEOWNERS rules (* plus 3 unowned event paths); got ${JSON.stringify(rules)}`);
    assert.deepEqual(rules[0], { pattern: "*", owners: ["@mcp-tool-shop"] });

    const unownedPaths = [];
    for (const rule of rules.slice(1)) {
      assert.deepEqual(rule.owners, [], `CODEOWNERS event rule ${rule.pattern} must have no owner`);
      assert.ok(rule.pattern.startsWith("/"), `CODEOWNERS event rule ${rule.pattern} must be root-anchored with leading '/'`);
      unownedPaths.push(rule.pattern.slice(1));
    }

    assert.deepEqual(unownedPaths, [...ALLOWED_EVENT_PATHS]);
    for (const workflowRel of BROADCAST_WORKFLOWS) {
      const stagedPaths = extractAppendGitAddPaths(workflowRel);
      assert.deepEqual(
        stagedPaths,
        unownedPaths,
        `${workflowRel} 'Append to ledger via PR' git add paths must match unowned CODEOWNERS paths`,
      );
    }
  });
});
