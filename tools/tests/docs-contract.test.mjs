// FC2 (#1 docs) + FC7 (#9 docs) — front-door honesty checks on the docs we own.
// FC2: the public verify/onboarding path uses `npx @mcptoolshop/repomesh ...` (no git clone in the
//      verify path; `node tools/...` is reserved for genuine operator/dev tasks).
// FC7: the 5 unimplemented event types are marked "reserved / planned (not yet emitted)" so docs
//      match the live ledger (ReleasePublished + AttestationPublished + ledger.anchor [+ dispute]).
// These are STATIC doc assertions (no behavior change), kept as a regression guard.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const README = path.resolve(REPO_ROOT, "README.md");
const VERIFICATION = path.resolve(REPO_ROOT, "docs", "verification.md");
const HANDBOOK = path.resolve(REPO_ROOT, "docs", "handbook.md");

const RESERVED_TYPES = [
  "BreakingChangeDetected",
  "HealthCheckFailed",
  "DependencyVulnFound",
  "InterfaceUpdated",
  "PolicyViolation",
];

function read(p) { return fs.readFileSync(p, "utf8"); }

// Capture every fenced code block, tagged with its language hint, plus its body.
function codeBlocks(src) {
  const blocks = [];
  const re = /```([a-zA-Z0-9-]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(src)) !== null) blocks.push({ lang: m[1], body: m[2] });
  return blocks;
}

describe("FC2 — public verify/onboarding path uses npx (no clone)", () => {
  for (const [name, p] of [["README.md", README], ["docs/verification.md", VERIFICATION], ["docs/handbook.md", HANDBOOK]]) {
    it(`${name}: no shell block runs verify-release/init via 'node tools/repomesh.mjs'`, () => {
      const offenders = [];
      for (const b of codeBlocks(read(p))) {
        if (!/^(bash|sh|shell|)$/.test(b.lang)) continue; // only shell-ish blocks
        for (const line of b.body.split("\n")) {
          const t = line.trim();
          if (/node\s+tools\/repomesh\.mjs\s+(verify-release|init)\b/.test(t)) {
            offenders.push(t);
          }
        }
      }
      assert.deepEqual(offenders, [],
        `verify-release/init must be invoked via 'npx @mcptoolshop/repomesh', found:\n${offenders.join("\n")}`);
    });

    it(`${name}: presents the canonical npx verify-release command`, () => {
      const src = read(p);
      assert.match(src, /npx\s+@mcptoolshop\/repomesh\s+verify-release/,
        "must document `npx @mcptoolshop/repomesh verify-release`");
    });
  }

  it("docs document the tri-state exit codes, --fail-on, --format, verify-all, and --local", () => {
    for (const p of [README, VERIFICATION, HANDBOOK]) {
      const src = read(p);
      assert.match(src, /--fail-on/, `${p}: must document --fail-on`);
      assert.match(src, /--format/, `${p}: must document --format`);
      assert.match(src, /verify-all/, `${p}: must document verify-all`);
      assert.match(src, /--local/, `${p}: must document --local`);
      // tri-state exit codes: the three non-trivial codes must appear together with their verdicts
      assert.match(src, /UNVERIFIED/, `${p}: must mention UNVERIFIED`);
    }
  });
});

describe("FC7 — reserved event types are honestly disclosed", () => {
  for (const [name, p] of [["README.md", README], ["docs/handbook.md", HANDBOOK]]) {
    const src = read(p);
    it(`${name}: marks unimplemented types under a 'reserved / planned (not yet emitted)' heading`, () => {
      assert.match(src, /reserved\s*\/\s*planned\s*\(not yet emitted\)/i,
        "must carry a 'Reserved / planned (not yet emitted)' disclosure heading");
    });
    for (const t of RESERVED_TYPES) {
      it(`${name}: '${t}' appears after the reserved-disclosure heading, not in a live table`, () => {
        const headingIdx = src.search(/reserved\s*\/\s*planned\s*\(not yet emitted\)/i);
        // Match the event-type as a backticked token (`Type`) so substrings like
        // `noPolicyViolations` (a policy-check name) don't cause false positives.
        const typeIdx = src.search(new RegExp("`" + t + "`"));
        assert.ok(typeIdx !== -1, `\`${t}\` should still be listed (as planned)`);
        assert.ok(typeIdx > headingIdx,
          `${t} must appear AFTER the reserved heading (i.e. in the planned section, not the live table)`);
      });
    }
    it(`${name}: live tables include ledger.anchor (an actually-emitted type)`, () => {
      assert.match(src, /ledger\.anchor/, "live event-type list must include ledger.anchor");
    });
  }
});
