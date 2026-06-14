// Registry domain — FC2 (#1 F1): build-snippets.mjs must emit the canonical npx command.
//
// Contract (featureB-build-contract.md FC2): the verification snippet MUST use
//   `npx @mcptoolshop/repomesh verify-release --repo <org/repo> --version <v> --anchored`
// and MUST NOT use `git clone` + `node tools/repomesh.mjs`. --anchored is appended only when the
// release is actually anchored.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderSnippet } from "../scripts/build-snippets.mjs";

const REPO = "mcp-tool-shop-org/shipcheck";
const ENTRY = { repo: REPO, version: "1.2.3", timestamp: "2026-03-01T00:00:00.000Z" };

describe("FC2 snippet uses npx canonical command (#1 F1)", () => {
  it("emits `npx @mcptoolshop/repomesh verify-release` with --repo/--version", () => {
    const md = renderSnippet(REPO, ENTRY, { anchored: false });
    assert.match(md, /npx @mcptoolshop\/repomesh verify-release/,
      "snippet must use the npx canonical command\n" + md);
    assert.match(md, /--repo mcp-tool-shop-org\/shipcheck/, "snippet must pass --repo");
    assert.match(md, /--version 1\.2\.3/, "snippet must pass --version");
  });

  it("does NOT use `git clone` or `node tools/repomesh.mjs`", () => {
    const md = renderSnippet(REPO, ENTRY, { anchored: false });
    assert.doesNotMatch(md, /git clone/, "snippet must NOT instruct a git clone\n" + md);
    assert.doesNotMatch(md, /node tools\/repomesh\.mjs/, "snippet must NOT call node tools/repomesh.mjs\n" + md);
  });

  it("appends --anchored only when the release is anchored", () => {
    const unanchored = renderSnippet(REPO, ENTRY, { anchored: false });
    assert.doesNotMatch(unanchored, /verify-release[^\n]*--anchored/,
      "an unanchored release must NOT get --anchored on the verify-release line\n" + unanchored);

    const anchored = renderSnippet(REPO, ENTRY, { anchored: true, anchorInfo: { txHash: "DEADBEEF" } });
    assert.match(anchored, /npx @mcptoolshop\/repomesh verify-release[^\n]*--anchored/,
      "an anchored release MUST get --anchored on the verify-release line\n" + anchored);
  });

  it("the CI/JSON gate block also uses the npx command with --format json (or --json)", () => {
    const md = renderSnippet(REPO, ENTRY, { anchored: false });
    // The CI block must be the npx form too (not node tools/repomesh.mjs).
    const ciUsesNpx = /npx @mcptoolshop\/repomesh verify-release[^\n]*(--json|--format json)/.test(md);
    assert.ok(ciUsesNpx, "the CI/JSON block must use the npx command with JSON output\n" + md);
  });
});
