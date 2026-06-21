// CLI-A-001 — the byte-identical drift guard the key-window.mjs header CLAIMS exists.
//
// The shared key-lifecycle predicate is duplicated: verifiers/lib/key-window.mjs and
// packages/repomesh-cli/src/verify/key-window.mjs. The header of BOTH files asserts:
//   "A drift test asserts the two predicate halves stay identical."
// ...but no such test existed. This is that test. It strips each file's leading comment/import
// preamble (everything BEFORE the first top-level `export`) and asserts the remaining source —
// the actual predicate logic — is byte-identical across the two copies. If either copy diverges
// in its logic, this test goes RED. The preamble is allowed to differ (the published CLI is
// self-contained and may carry different import lines), but the security-bearing code may not.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const VERIFIERS_COPY = resolve(REPO_ROOT, "verifiers", "lib", "key-window.mjs");
const CLI_COPY = resolve(REPO_ROOT, "packages", "repomesh-cli", "src", "verify", "key-window.mjs");

// Everything from the FIRST top-level `export` onward is the predicate body that must match.
// The leading preamble (license/comment/import lines) is allowed to differ between the copies.
function predicateBody(src) {
  const idx = src.indexOf("\nexport ");
  // Handle a file that starts with `export` on line 1 (no leading newline) too.
  if (src.startsWith("export ")) return src;
  assert.notEqual(idx, -1, "key-window.mjs must contain at least one top-level export");
  return src.slice(idx + 1); // drop the leading newline so both sides start at `export`
}

describe("CLI-A-001 key-window predicate copies are byte-identical (drift guard)", () => {
  it("the predicate body (first export onward) is byte-identical across both copies", () => {
    const a = predicateBody(readFileSync(VERIFIERS_COPY, "utf8"));
    const b = predicateBody(readFileSync(CLI_COPY, "utf8"));
    assert.equal(
      a,
      b,
      "verifiers/lib/key-window.mjs and packages/repomesh-cli/src/verify/key-window.mjs have DIVERGED " +
        "below their first export — edit BOTH copies identically.",
    );
  });

  it("both copies actually export the load-bearing predicate symbols", () => {
    const a = readFileSync(VERIFIERS_COPY, "utf8");
    const b = readFileSync(CLI_COPY, "utf8");
    for (const sym of ["isKeyValidForSignature", "keyWindow", "mergeStricterWindow", "deriveKeyWindowConstraints"]) {
      assert.match(a, new RegExp(`export function ${sym}\\b`), `verifiers copy must export ${sym}`);
      assert.match(b, new RegExp(`export function ${sym}\\b`), `cli copy must export ${sym}`);
    }
  });
});
