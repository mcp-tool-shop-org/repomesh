// FC1 + FC4: the single emit path + the exit-code contract for verify-release / verify-all.
//
// Exit codes (FC1) are derived from the tri-state gate.status the verifier already computes:
//   PASS        -> 0
//   FAIL        -> 1   (hard: forged/invalid signature, non-allowlisted attestor, required result=fail, tamper)
//   UNVERIFIED  -> 3   (soft: not-yet-anchored / no independent witness / required check missing-but-not-failed)
//   usage error / internal crash -> 2
// `--fail-on <fail|unverified>` (default `unverified`) is the ONLY knob: it decides whether UNVERIFIED is
// treated as success. With --fail-on=fail, UNVERIFIED returns 0 (the status stays UNVERIFIED in the output,
// and a warning is printed). PASS is always 0; FAIL is always 1.

export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, ERROR: 2, UNVERIFIED: 3 });

// Map a terminal status + the --fail-on mode to a process exit code.
// `status` is one of "PASS" | "FAIL" | "UNVERIFIED" | "ERROR".
export function exitCodeForStatus(status, failOn = "unverified") {
  switch (status) {
    case "PASS": return EXIT.PASS;
    case "FAIL": return EXIT.FAIL;
    case "ERROR": return EXIT.ERROR;
    case "UNVERIFIED":
      // --fail-on=fail relaxes UNVERIFIED to success (warn-mode adoption); default fails closed.
      return failOn === "fail" ? EXIT.PASS : EXIT.UNVERIFIED;
    default:
      return EXIT.ERROR;
  }
}

export function normalizeFailOn(value) {
  const v = (value || "unverified").toLowerCase();
  return v === "fail" ? "fail" : "unverified";
}

export function normalizeFormat({ format, json }) {
  // --json is an explicit alias for --format json and wins if both are given.
  if (json) return "json";
  const f = (format || "text").toLowerCase();
  return ["text", "json", "sarif", "markdown"].includes(f) ? f : "text";
}

// --- SARIF 2.1.0 ----------------------------------------------------------
// Each gate.failures[] {check, reason, hint} -> one SARIF result:
//   ruleId       = check
//   message.text = reason
//   help.text    = hint (carried on the rule descriptor)
//   level        = "error" when the overall gate is FAIL, "warning" when UNVERIFIED.
// A PASS release emits a valid envelope with zero results.
const SARIF_TOOL_NAME = "repomesh";
const SARIF_INFO_URI = "https://mcp-tool-shop-org.github.io/repomesh/";

function sarifLevelForStatus(status) {
  if (status === "FAIL") return "error";
  if (status === "UNVERIFIED") return "warning";
  return "note";
}

// Build a SARIF 2.1.0 run from one or more verify results. `runs` accepts either a single
// verify result or an array (verify-all merges every row into ONE run, FC5).
export function buildSarif(results) {
  const list = Array.isArray(results) ? results : [results];
  const rulesById = new Map();
  const sarifResults = [];

  for (const r of list) {
    const gate = r?.gate || {};
    const status = gate.status || (r?.ok ? "PASS" : "FAIL");
    const level = sarifLevelForStatus(status);
    const failures = Array.isArray(gate.failures) ? gate.failures : [];
    const locProps = r?.repo ? { repo: r.repo, version: r.version } : {};
    for (const f of failures) {
      const ruleId = f.check || "verification";
      if (!rulesById.has(ruleId)) {
        rulesById.set(ruleId, {
          id: ruleId,
          name: ruleId,
          shortDescription: { text: ruleId },
          ...(f.hint ? { help: { text: f.hint } } : {}),
        });
      }
      sarifResults.push({
        ruleId,
        level,
        message: { text: f.reason || ruleId },
        ...(r?.repo ? { properties: locProps } : {}),
      });
    }
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: SARIF_TOOL_NAME,
            informationUri: SARIF_INFO_URI,
            rules: [...rulesById.values()],
          },
        },
        results: sarifResults,
      },
    ],
  };
}

// --- Markdown job-summary table ------------------------------------------
// A table of (check / status / reason / hint) suitable for $GITHUB_STEP_SUMMARY + PR comments.
function mdEsc(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function buildMarkdown(result) {
  const gate = result?.gate || {};
  const status = gate.status || (result?.ok ? "PASS" : "FAIL");
  const title = result?.repo ? `${result.repo}@${result.version}` : "release";
  const lines = [];
  lines.push(`### RepoMesh verification: ${mdEsc(title)} — **${status}**`);
  lines.push("");
  lines.push("| Check | Status | Reason | Hint |");
  lines.push("|-------|--------|--------|------|");
  const failures = Array.isArray(gate.failures) ? gate.failures : [];
  if (status === "PASS" || failures.length === 0) {
    lines.push(`| (trust gate) | ${status} | ${status === "PASS" ? "all checks satisfied" : "—"} | — |`);
  }
  for (const f of failures) {
    lines.push(`| ${mdEsc(f.check || "")} | ${status} | ${mdEsc(f.reason || "")} | ${mdEsc(f.hint || "")} |`);
  }
  return lines.join("\n");
}

// A multi-row markdown table for verify-all: one row per release.
export function buildMarkdownBatch(rows, overall) {
  const lines = [];
  lines.push(`### RepoMesh verify-all — **${overall}**`);
  lines.push("");
  lines.push("| Release | Status | Reason |");
  lines.push("|---------|--------|--------|");
  for (const row of rows) {
    const status = row?.gate?.status || (row?.ok ? "PASS" : "FAIL");
    const first = (row?.gate?.failures || [])[0];
    const reason = status === "PASS" ? "all checks satisfied" : (first?.reason || row?.error || "—");
    lines.push(`| ${mdEsc(`${row.repo}@${row.version}`)} | ${status} | ${mdEsc(reason)} |`);
  }
  return lines.join("\n");
}
