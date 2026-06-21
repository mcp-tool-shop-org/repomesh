// SEAM-PARSE-001 — byte-identical drift guard for the unified anchor-note parser.
//
// The canonical anchor-note parser is duplicated: verifiers/lib/anchor-notes.mjs and
// packages/repomesh-cli/src/verify/anchor-notes.mjs. The published CLI is self-contained and cannot
// import across the package boundary, so it carries its own copy. The PARSE-FUNCTION BODY (everything
// from the first top-level `export` onward) MUST be byte-identical across the two copies — that is the
// security-bearing logic that decides which JSON blob in an anchor's notes is trusted as metadata. The
// leading comment preamble is allowed to differ (the CLI copy documents its self-contained status).
// Mirrors packages/repomesh-cli/tests/key-window-drift.test.mjs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const VERIFIERS_COPY = resolve(REPO_ROOT, "verifiers", "lib", "anchor-notes.mjs");
const CLI_COPY = resolve(REPO_ROOT, "packages", "repomesh-cli", "src", "verify", "anchor-notes.mjs");

// Everything from the FIRST top-level `export` onward is the parser body that must match.
// The leading preamble (comment lines) is allowed to differ between the copies.
function parserBody(src) {
  if (src.startsWith("export ")) return src;
  const idx = src.indexOf("\nexport ");
  assert.notEqual(idx, -1, "anchor-notes.mjs must contain at least one top-level export");
  return src.slice(idx + 1); // drop the leading newline so both sides start at `export`
}

describe("SEAM-PARSE-001 anchor-note parser copies are byte-identical (drift guard)", () => {
  it("the parse-function body (first export onward) is byte-identical across both copies", () => {
    const a = parserBody(readFileSync(VERIFIERS_COPY, "utf8"));
    const b = parserBody(readFileSync(CLI_COPY, "utf8"));
    assert.equal(
      a,
      b,
      "verifiers/lib/anchor-notes.mjs and packages/repomesh-cli/src/verify/anchor-notes.mjs have " +
        "DIVERGED below their first export — edit BOTH copies identically.",
    );
  });

  it("both copies export parseAnchorPartitionMeta", () => {
    const a = readFileSync(VERIFIERS_COPY, "utf8");
    const b = readFileSync(CLI_COPY, "utf8");
    assert.match(a, /export function parseAnchorPartitionMeta\b/, "verifiers copy must export parseAnchorPartitionMeta");
    assert.match(b, /export function parseAnchorPartitionMeta\b/, "cli copy must export parseAnchorPartitionMeta");
  });

  it("both copies agree on parse results for representative inputs", async () => {
    const { parseAnchorPartitionMeta: vParse } = await import(pathToFileURL(VERIFIERS_COPY).href);
    const { parseAnchorPartitionMeta: cParse } = await import(pathToFileURL(CLI_COPY).href);
    const meta = { txHash: "X", network: "testnet", range: ["a", "b"], manifestPath: "p" };
    const cases = [
      `prose\n${JSON.stringify(meta)}`,
      `prose with { brace\n${JSON.stringify(meta)}`,
      JSON.stringify(meta),
      "no json here",
      "",
      "prose\n[1,2]",
    ];
    for (const c of cases) {
      assert.equal(JSON.stringify(vParse(c)), JSON.stringify(cParse(c)),
        `parse result diverged across copies for input ${JSON.stringify(c)}`);
    }
  });
});
