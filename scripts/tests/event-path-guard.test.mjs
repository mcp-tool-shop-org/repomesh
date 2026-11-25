import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateEventPathGuard, MAX_PR_FILES } from "../ci/event-path-guard.mjs";

const GUARD_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "ci", "event-path-guard.mjs");

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

describe("event-path-guard (pull_request_target base-branch policy)", () => {
  it("rejects a script-edit PR from a non-admin author", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "anchor/xrpl/scripts/compute-root.mjs", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["anchor/xrpl/scripts/compute-root.mjs"]),
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
    });
    assert.equal(res.ok, false, `expected script-edit PR from write user to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => r.includes("anchor/xrpl/scripts/compute-root.mjs")));
  });

  it("allows a pure event PR (the three paths, modified, mode 100644) from a non-admin", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 3,
      files: THREE_EVENT_FILES,
      headTreeEntries: makeRegularTreeEntries(),
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
    });
    assert.equal(res.ok, true, `expected pure event PR to PASS, got ${JSON.stringify(res)}`);
    assert.equal(res.exempted, false);
  });

  it("rejects a mixed event + script PR from a non-admin", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 4,
      files: [...THREE_EVENT_FILES, { filename: "registry/scripts/build-trust.mjs", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries([
        ...THREE_EVENT_FILES.map((f) => f.filename),
        "registry/scripts/build-trust.mjs",
      ]),
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
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
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
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
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
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
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
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
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
    });
    assert.equal(res.ok, false, `expected executable mode 100755 to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => r.includes("100755")));
  });

  it("rejects removing an allowed file", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "registry/trust.json", status: "removed" }],
      headTreeEntries: makeRegularTreeEntries(["ledger/events/events.jsonl", "anchor/xrpl/manifests/all.json"]),
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
    });
    assert.equal(res.ok, false, `expected removing an allowed file to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => /removal/i.test(r)));
  });

  it("rejects a .github/workflows/ledger-ci.yml edit from a non-admin", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: ".github/workflows/ledger-ci.yml", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries([".github/workflows/ledger-ci.yml"]),
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
    });
    assert.equal(res.ok, false, `expected workflow edit from non-admin to FAIL, got ${JSON.stringify(res)}`);
    assert.ok(res.reasons.some((r) => r.includes(".github/workflows/ledger-ci.yml")));
  });

  it("rejects a file-list count mismatch or cap", () => {
    const mismatchRes = evaluateEventPathGuard({
      changedFilesCount: 4,
      files: THREE_EVENT_FILES,
      headTreeEntries: makeRegularTreeEntries(),
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
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
      authorLogin: "admin-user",
      authorRole: "admin",
      senderLogin: "admin-user",
      senderRole: "admin",
    });
    assert.equal(capRes.ok, false, `expected API file-list cap to FAIL closed even for admin, got ${JSON.stringify(capRes)}`);
  });

  it("rejects an admin-authored PR whose latest push came from a non-admin sender, with script edits", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "anchor/xrpl/scripts/compute-root.mjs", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["anchor/xrpl/scripts/compute-root.mjs"]),
      authorLogin: "repo-admin",
      authorRole: "admin",
      senderLogin: "adopter-bot",
      senderRole: "write",
    });
    assert.equal(
      res.ok,
      false,
      `expected admin-authored PR pushed by non-admin sender with script edits to FAIL, got ${JSON.stringify(res)}`,
    );
    assert.equal(res.exempted, false);
  });

  it("allows an admin author plus admin sender with script edits", () => {
    const res = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "anchor/xrpl/scripts/compute-root.mjs", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["anchor/xrpl/scripts/compute-root.mjs"]),
      authorLogin: "repo-admin",
      authorRole: "admin",
      senderLogin: "repo-admin",
      senderRole: "admin",
    });
    assert.equal(res.ok, true, `expected admin author + admin sender with script edits to PASS, got ${JSON.stringify(res)}`);
    assert.equal(res.exempted, true);
  });

  it("rejects a submodule entry (mode 160000) and supports CLI JSON execution", () => {
    const subRes = evaluateEventPathGuard({
      changedFilesCount: 1,
      files: [{ filename: "registry/trust.json", status: "modified" }],
      headTreeEntries: makeRegularTreeEntries(["registry/trust.json"], {
        "registry/trust.json": { mode: "160000", type: "commit" },
      }),
      authorLogin: "adopter-bot",
      authorRole: "write",
      senderLogin: "adopter-bot",
      senderRole: "write",
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
          authorLogin: "adopter-bot",
          authorRole: "write",
          senderLogin: "adopter-bot",
          senderRole: "write",
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
          authorLogin: "adopter-bot",
          authorRole: "write",
          senderLogin: "adopter-bot",
          senderRole: "write",
        }),
        "utf8",
      );
      const cliFail = spawnSync(process.execPath, [GUARD_SCRIPT, failFile], { encoding: "utf8" });
      assert.equal(cliFail.status, 1, `expected CLI fail to exit 1: ${cliFail.stdout}\n${cliFail.stderr}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
