#!/usr/bin/env node
// RepoMesh License Verifier — Scans SBOM components against license allowlist.
//
// Usage:
//   node verify-license.mjs --repo org/repo --version 1.2.3
//   node verify-license.mjs --scan-new
//   node verify-license.mjs --scan-new --sign --output /tmp/license.jsonl

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readEvents,
  findReleaseEvent,
  hasAttestationEvent,
  buildAttestationEvent,
  parseArgs,
  signEvent,
  writeJsonlLine,
  loadSigningKeyFromEnvOrFile
} from "../../lib/common.mjs";
import { findSbomAttestation, fetchCycloneDxComponentsBound } from "../../lib/fetch-sbom.mjs";
import { loadValidatedOverrides } from "../../lib/load-overrides.mjs";
import { classifySpdxExpression } from "../../lib/spdx.mjs";

const REPO_ID_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

// SEC-009: a repo cannot self-certify missing/unknown licenses as compliant. A self-applied
// treatUnknownAs override may only make the result STRICTER ({warn, fail}); "pass" for unknowns is
// reserved for governance/profile, not the repo's own overrides file.
const SELF_APPLICABLE_TREAT_UNKNOWN = new Set(["warn", "fail"]);

function loadConfig() {
  const p = path.join(process.cwd(), "verifiers/license/config.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Load + schema-validate per-repo overrides (SEC-003/SEC-009). Returns the `license` sub-block or
// null. A schema-invalid override file throws (rejected) — never silently swallowed.
function loadOverrides(repo) {
  const data = loadValidatedOverrides(repo);
  return data?.license || null;
}

// Merge base config with per-repo overrides.
function mergeConfig(cfg, overrides) {
  if (!overrides) return cfg;
  const merged = { ...cfg };

  // Merge allowlist additions
  if (Array.isArray(overrides.allowlistAdd)) {
    merged.allowlist = [...new Set([...merged.allowlist, ...overrides.allowlistAdd])];
  }

  // Merge allowlist removals
  if (Array.isArray(overrides.allowlistRemove)) {
    const remove = new Set(overrides.allowlistRemove);
    merged.allowlist = merged.allowlist.filter(l => !remove.has(l));
  }

  // SEC-009: a repo-level override may only TIGHTEN unknown handling. Reject a self-applied
  // treatUnknownAs:'pass' (missing license is absence of evidence, not compliance).
  if (overrides.treatUnknownAs) {
    if (SELF_APPLICABLE_TREAT_UNKNOWN.has(overrides.treatUnknownAs)) {
      merged.treatUnknownAs = overrides.treatUnknownAs;
    } else {
      console.warn(
        `[license] Ignoring self-applied treatUnknownAs='${overrides.treatUnknownAs}' ` +
        `(only ${[...SELF_APPLICABLE_TREAT_UNKNOWN].join("/")} permitted from repo overrides; ` +
        `'pass' requires governance/profile).`
      );
    }
  }

  return merged;
}

export function classifyLicenses(components, cfg) {
  const ctx = {
    allow: new Set(cfg.allowlist),
    coprefix: cfg.copyleftPrefixes || [],
    coexact: new Set(cfg.copyleftExact || []),
  };

  const findings = {
    copyleft: [],
    unknownOrMissing: [],
    allowed: 0
  };

  for (const c of components) {
    const ls = c.licenses || [];
    if (ls.length === 0) {
      findings.unknownOrMissing.push({ name: c.name, version: c.version, reason: "missing" });
      continue;
    }

    // SEC-006: parse each license entry as an SPDX expression (AND/OR/parens) before classifying.
    // Combine a component's entries conservatively: a copyleft entry poisons the component, an
    // unknown entry makes it unknown, otherwise allowed.
    let hasCopyleft = false;
    let hasUnknown = false;
    for (const lic of ls) {
      const cls = classifySpdxExpression(lic, ctx);
      if (cls === "copyleft") hasCopyleft = true;
      else if (cls === "unknown") hasUnknown = true;
    }

    if (hasCopyleft) findings.copyleft.push({ name: c.name, version: c.version, licenses: ls });
    else if (hasUnknown) findings.unknownOrMissing.push({ name: c.name, version: c.version, licenses: ls, reason: "unknown" });
    else findings.allowed++;
  }

  let result = "pass";
  if (findings.copyleft.length > 0) result = "fail";
  else if (findings.unknownOrMissing.length > 0) {
    // Respect treatUnknownAs (already restricted to {warn,fail} for self-applied overrides; profile
    // governance may set 'pass'). Default to warn.
    result = cfg.treatUnknownAs || "warn";
  }

  return { result, findings };
}

async function runOne({ repo, version, sign, keyId, signingKeyPath, out }) {
  if (!REPO_ID_RE.test(repo)) {
    throw new Error(`Invalid repo format: ${repo} (expected org/repo)`);
  }
  const events = readEvents();
  const rel = findReleaseEvent(events, repo, version);
  if (!rel) throw new Error(`No ReleasePublished found for ${repo}@${version}`);

  if (hasAttestationEvent(events, repo, version, "license.audit") && String(sign) !== "force") {
    return { skipped: true, reason: "already attested (license.audit)" };
  }

  const sbomAtt = findSbomAttestation(rel);
  const sbomUri = sbomAtt?.uri || null;
  if (!sbomUri) {
    const ev0 = buildAttestationEvent({
      repo,
      version,
      commit: rel.commit,
      artifacts: rel.artifacts,
      attestations: [{ type: "license.audit", uri: "repomesh:attestor:license.audit:warn" }],
      notes: "license.audit: warn \u2014 SBOM missing from ReleasePublished attestations; cannot audit licenses."
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    return { result: "warn", reason: "no sbom" };
  }

  const baseCfg = loadConfig();
  const overrides = loadOverrides(repo);
  const cfg = mergeConfig(baseCfg, overrides);

  // SEC-002 / D6 / D13: bind license auditing to the committed SBOM digest. A missing/mismatched
  // digest means the audit ran on un-trustable data \u2014 we CANNOT certify, so this is NON-SCORING
  // ('unscored'), not 'warn'. The scorer awards 0 assurance points and reports the check as missing
  // (D13: the 'unscored' token is the shared cross-domain contract value).
  const { components: comps, digestStatus } = await fetchCycloneDxComponentsBound(sbomUri, sbomAtt?.sha256);
  if (!digestStatus.bound) {
    const why = digestStatus.reason === "missing"
      ? "SBOM attestation carries no sha256 digest; cannot bind license audit to fetched SBOM bytes"
      : `SBOM bytes (${digestStatus.actual}) do not match committed sha256 (${digestStatus.expected})`;
    const ev0 = buildAttestationEvent({
      repo, version, commit: rel.commit,
      artifacts: rel.artifacts,
      attestations: [{ type: "license.audit", uri: "repomesh:attestor:license.audit:unscored" }],
      notes: `license.audit: unscored \u2014 ${why}. No assurance credit.`
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  \u26a0\ufe0f license.audit: ${why} (non-scoring)`);
    return { result: "unscored", reason: "sbom digest unbound", digestStatus };
  }

  const { result, findings } = classifyLicenses(comps, cfg);

  let reason;
  if (result === "pass") {
    reason = `All ${comps.length} component licenses are in the allowlist`;
  } else if (result === "warn") {
    reason = `${findings.unknownOrMissing.length} component(s) have unknown or missing licenses`;
  } else {
    reason = `${findings.copyleft.length} component(s) have copyleft licenses`;
  }

  const details = JSON.stringify({
    totalComponents: comps.length,
    allowed: findings.allowed,
    copyleft: findings.copyleft.slice(0, 5),
    unknownOrMissing: findings.unknownOrMissing.slice(0, 5)
  });

  const ev = buildAttestationEvent({
    repo,
    version,
    commit: rel.commit,
    artifacts: rel.artifacts,
    attestations: [{ type: "license.audit", uri: `repomesh:attestor:license.audit:${result}` }],
    notes: `license.audit: ${result} \u2014 ${reason}\n${details}`
  });

  const signed = sign ? signEvent(ev, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev;
  if (out) writeJsonlLine(out, signed);
  console.log(`  ${result === "pass" ? "\u2705" : result === "warn" ? "\u26A0\uFE0F" : "\u274C"} license.audit: ${reason}`);
  return { result, findings };
}

async function scanNew({ sign, keyId, signingKeyPath, out }) {
  const events = readEvents();
  const releases = events.filter(e => e?.type === "ReleasePublished");
  const targets = [];

  for (const rel of releases) {
    if (!hasAttestationEvent(events, rel.repo, rel.version, "license.audit")) {
      targets.push({ repo: rel.repo, version: rel.version });
    }
  }

  if (targets.length === 0) {
    console.log("No releases missing license.audit attestation.");
    return { scanned: 0, results: [] };
  }

  console.log(`Found ${targets.length} release(s) to audit.\n`);
  const results = [];
  for (const t of targets) {
    console.log(`Auditing: ${t.repo}@${t.version}`);
    results.push(await runOne({ ...t, sign, keyId, signingKeyPath, out }));
  }
  return { scanned: targets.length, results };
}

// Exports for tests (pure classification + config merge + override loading). runOne is exported so
// the unbound-SBOM -> 'unscored' I/O path (D13) is testable end-to-end with a temp ledger + mocked
// fetch.
export { mergeConfig, loadOverrides, loadConfig, runOne };

// --- main (only when invoked directly, not when imported by tests) ---
function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo;
  const version = args.version;
  const scanNewFlag = args["scan-new"];
  const out = args.output || null;
  const sign = Boolean(args.sign);
  const keyId = args.keyId || process.env.REPOMESH_KEY_ID || "ci-repomesh-2026";
  const signingKeyPath = args["signing-key"] || null;

  if (scanNewFlag) {
    scanNew({ sign, keyId, signingKeyPath, out })
      .then(r => {
        console.log(`\n${r.scanned} release(s) audited.`);
        if (out) console.log(`Output written to ${out}`);
      })
      .catch(e => { console.error(e); process.exit(1); });
  } else {
    if (!repo || !version) {
      console.error("Usage:");
      console.error("  node verify-license.mjs --repo <org/repo> --version <semver>");
      console.error("  node verify-license.mjs --scan-new [--sign --output <path>]");
      process.exit(2);
    }
    runOne({ repo, version, sign, keyId, signingKeyPath, out })
      .then(r => console.log(JSON.stringify(r, null, 2)))
      .catch(e => { console.error(e); process.exit(1); });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
