#!/usr/bin/env node
// RepoMesh Security Verifier — Queries OSV.dev for known vulnerabilities in SBOM components.
//
// Usage:
//   node verify-security.mjs --repo org/repo --version 1.2.3
//   node verify-security.mjs --scan-new
//   node verify-security.mjs --scan-new --sign --output /tmp/security.jsonl

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
import { osvQueryAll, severityBucket, severityBucketWithReason, isIgnored } from "../../lib/osv.mjs";
import { loadValidatedOverrides } from "../../lib/load-overrides.mjs";

// Severity buckets, worst → least. "unknown" is appended LAST and is treated as FAILING by default
// (SEC-001): a vuln OSV cannot score is not evidence of safety.
const SEVERITY_ORDER = ["critical", "high", "moderate", "low"];

function loadConfig() {
  const p = path.join(process.cwd(), "verifiers/security/config.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Merge base config with per-repo overrides. Overrides are the SCHEMA-VALIDATED `security` block
// (SEC-003) — ignoreVulns entries are objects {id, justification}, never bare strings.
function mergeSecurityConfig(cfg, overrides) {
  if (!overrides) return cfg;
  const merged = { ...cfg };

  if (overrides.severityThreshold) merged.severityThreshold = overrides.severityThreshold;
  if (Array.isArray(overrides.ignoreVulns)) {
    // Carry the full {id, justification} objects so honored ignores can be recorded in notes.
    merged.ignoreVulns = [...(merged.ignoreVulns || []), ...overrides.ignoreVulns];
  }

  return merged;
}

// Determine which severities trigger a fail based on the threshold.
// "unknown" ALWAYS triggers fail (SEC-001): we never give assurance credit to a vuln we cannot score.
function failSeveritiesFromThreshold(threshold) {
  const idx = SEVERITY_ORDER.indexOf(threshold || "moderate");
  const base = idx < 0 ? ["critical", "high"] : SEVERITY_ORDER.slice(0, idx + 1);
  return new Set([...base, "unknown"]);
}

// D15 (HIGH #4): the repo-supplied `failOnSeverities` is a UNION with the threshold-derived floor
// (which always includes critical+high) plus "unknown" — an override can ADD severities but can
// NEVER remove critical/high/unknown. Mirrors the strictness floor on treatUnknownAs (license) and
// keeps the SEC-001 guarantee intact regardless of what a repo writes in its overrides file.
export function computeFailSeverities(severityThreshold, overrides) {
  const floor = failSeveritiesFromThreshold(severityThreshold);
  return new Set([
    ...floor,
    ...(Array.isArray(overrides?.failOnSeverities) ? overrides.failOnSeverities : []),
    "unknown",
  ]);
}

// Load + schema-validate the per-repo overrides (SEC-003). Returns the `security` sub-block or null.
// A schema-invalid override file throws (rejected) — never silently swallowed into "no override".
function loadSecurityOverrides(repo) {
  const data = loadValidatedOverrides(repo);
  return data?.security || null;
}

// Build the ignore-id set + the list of honored ignore entries (for notes) from the merged config
// and validated overrides. Only object entries {id, justification} are accepted (SEC-003: the bare
// string branch is gone). SEC-007 alias matching happens at scoring time against this id set.
function buildIgnoreSet(cfg, overrides) {
  const entries = [
    ...(Array.isArray(cfg.ignoreVulns) ? cfg.ignoreVulns : []),
    ...(Array.isArray(overrides?.ignoreVulns) ? overrides.ignoreVulns : []),
  ].filter(v => v && typeof v === "object" && typeof v.id === "string");
  const ignoreIds = new Set(entries.map(v => v.id));
  return { ignoreIds, ignoreEntries: entries };
}

// Pure scoring: given OSV results (full vuln objects, package-tagged per SEC-010), classify and
// roll up. Unknown-severity vulns bucket as "unknown" and (via failSeverities) fail by default.
// SEC-007: ignore matching is against the {id, ...aliases} union of each vuln.
export function scoreVulns(results, { ignoreIds, failSeverities }) {
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  const topCritical = [];
  const ignoredApplied = [];
  // STGB-VER-007: collect decodable reasons for every vuln that bucketed to "unknown" so the
  // operator can see WHY (the raw severity string we couldn't parse), not just that it's unknown.
  const unknownReasons = [];

  for (const r of results) {
    const pkg = r?.package || "unknown-package";
    const vulns = Array.isArray(r?.vulns) ? r.vulns : [];
    for (const v of vulns) {
      const vulnId = v?.id || v?.aliases?.[0] || "UNKNOWN";
      if (isIgnored(v, ignoreIds)) {
        ignoredApplied.push(vulnId);
        continue;
      }
      const { bucket: b, reason: unknownReason } = severityBucketWithReason(v);
      counts[b] = (counts[b] || 0) + 1;
      if ((b === "critical" || b === "unknown") && topCritical.length < 5) {
        topCritical.push(`${vulnId} (${b}) in ${pkg}`);
      }
      if (b === "unknown" && unknownReasons.length < 10) {
        unknownReasons.push(`${vulnId} in ${pkg}: ${unknownReason}`);
      }
    }
  }

  const total = counts.critical + counts.high + counts.moderate + counts.low + counts.unknown;
  let result = "pass";
  const hasFail = [...failSeverities].some(sev => (counts[sev] || 0) > 0);
  if (hasFail) result = "fail";
  else if (total > 0) result = "warn";

  return { result, counts, topCritical, total, ignoredApplied, unknownReasons };
}

function purlToOsvPackage(purl) {
  if (!purl || typeof purl !== "string") return null;
  if (!purl.startsWith("pkg:npm/")) return null;
  const rest = purl.slice("pkg:npm/".length);
  const [namePart, verPart] = rest.split("@");
  if (!namePart || !verPart) return null;
  return { ecosystem: "npm", name: decodeURIComponent(namePart), version: decodeURIComponent(verPart) };
}

async function runOne({ repo, version, sign, keyId, signingKeyPath, out }) {
  const events = readEvents();
  const rel = findReleaseEvent(events, repo, version);
  if (!rel) throw new Error(`No ReleasePublished found for ${repo}@${version}`);

  if (hasAttestationEvent(events, repo, version, "security.scan") && String(sign) !== "force") {
    return { skipped: true, reason: "already attested (security.scan)" };
  }

  const sbomAtt = findSbomAttestation(rel);
  const sbomUri = sbomAtt?.uri || null;
  if (!sbomUri) {
    const ev0 = buildAttestationEvent({
      repo,
      version,
      commit: rel.commit,
      artifacts: rel.artifacts,
      attestations: [{ type: "security.scan", uri: "repomesh:attestor:security.scan:warn" }],
      notes: "security.scan: warn \u2014 SBOM missing from ReleasePublished attestations; cannot run vuln scan."
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    return { result: "warn", reason: "no sbom" };
  }

  // SEC-002 / D6 / D13: hash the RAW fetched bytes and bind to the committed sha256. A missing OR
  // mismatched digest means we ran the scan on un-trustable SBOM data \u2014 we CANNOT certify, so this
  // is NON-SCORING ('unscored'), not 'warn'. The scorer awards 0 assurance points and reports the
  // check as missing (D13: the 'unscored' token is the shared cross-domain contract value).
  //
  // STGB-VER-004: a SBOM fetch that times out / errors out (hung URI, network drop, non-200, invalid
  // JSON) throws here. That is a scan we could not run \u2014 non-scoring, not a silent crash. Map it to
  // 'unscored' with a machine-readable reason + a human hint rather than letting it abort the CLI.
  let comps, digestStatus;
  try {
    ({ components: comps, digestStatus } = await fetchCycloneDxComponentsBound(sbomUri, sbomAtt?.sha256));
  } catch (e) {
    const why = `SBOM could not be fetched/parsed from ${sbomUri}: ${String(e?.message || e)}`;
    const hint = "Confirm the SBOM URI is reachable and returns valid CycloneDX JSON within the timeout; an un-fetchable SBOM is non-scoring, not a pass.";
    const ev0 = buildAttestationEvent({
      repo, version, commit: rel.commit,
      artifacts: rel.artifacts,
      attestations: [{ type: "security.scan", uri: "repomesh:attestor:security.scan:unscored" }],
      notes: `security.scan: unscored \u2014 ${why}\n${JSON.stringify({ reason: "sbom fetch failed", hint })}`
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  \u26a0\ufe0f security.scan: ${why} (non-scoring)`);
    return { result: "unscored", reason: "sbom fetch failed", hint };
  }
  if (!digestStatus.bound) {
    const why = digestStatus.reason === "missing"
      ? "SBOM attestation carries no sha256 digest; cannot bind trust to fetched SBOM bytes"
      : `SBOM bytes (${digestStatus.actual}) do not match committed sha256 (${digestStatus.expected})`;
    const ev0 = buildAttestationEvent({
      repo, version, commit: rel.commit,
      artifacts: rel.artifacts,
      attestations: [{ type: "security.scan", uri: "repomesh:attestor:security.scan:unscored" }],
      notes: `security.scan: unscored \u2014 ${why}. No assurance credit.`
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  \u26a0\ufe0f security.scan: ${why} (non-scoring)`);
    return { result: "unscored", reason: "sbom digest unbound", digestStatus };
  }

  const pkgs = comps.map(c => purlToOsvPackage(c.purl)).filter(Boolean);
  console.error(`[security] Parsed ${comps.length} SBOM components, ${pkgs.length} queryable packages`);

  if (pkgs.length === 0) {
    // Zero dependencies = zero vulnerabilities = pass
    const ev0 = buildAttestationEvent({
      repo, version, commit: rel.commit,
      artifacts: rel.artifacts,
      attestations: [{ type: "security.scan", uri: "repomesh:attestor:security.scan:pass" }],
      notes: "security.scan: pass \u2014 No dependencies in SBOM; zero attack surface."
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log("  \u2705 security.scan: No dependencies in SBOM (zero attack surface)");
    return { result: "pass", reason: "no deps" };
  }

  // SEC-001 + SEC-010: query OSV /v1/query per package for FULL vuln objects (severity + aliases),
  // aligned 1:1 with queries and tagged with the package name.
  const queries = pkgs.map(p => ({ package: { ecosystem: p.ecosystem, name: p.name }, version: p.version }));
  console.error(`[security] Querying OSV for ${pkgs.length} packages...`);

  // Load config and per-repo overrides (SEC-003: schema-validated; a malformed override throws).
  const baseCfg = loadConfig();
  const overrides = loadSecurityOverrides(repo);
  const cfg = mergeSecurityConfig(baseCfg, overrides);
  const { ignoreIds, ignoreEntries } = buildIgnoreSet(cfg, overrides);
  // D15: UNION the repo override onto the threshold-derived floor — never replace it.
  const failSeverities = computeFailSeverities(cfg.severityThreshold, overrides);

  // STGB-VER-001 + STGB-VER-002: OSV degradation follows the unscored doctrine (Mike's policy) \u2014 a
  // transient outage must NOT inflate the assurance score with 'warn' partial credit.
  //   - osvQueryAll only throws now on a structural alignment violation (never on a per-package
  //     transient error, which it tolerates and records in results.failures). Either way, a scan we
  //     could not complete cleanly is NON-SCORING ('unscored', 0 pts), not 'warn'.
  let results;
  try {
    results = await osvQueryAll(queries);
  } catch (e) {
    const why = `OSV API unreachable / scan could not complete: ${String(e?.message || e)}`;
    const hint = "Re-run when OSV.dev (api.osv.dev) is reachable; a transient outage is non-scoring, not a pass.";
    const ev0 = buildAttestationEvent({
      repo, version, commit: rel.commit,
      artifacts: rel.artifacts,
      attestations: [{ type: "security.scan", uri: "repomesh:attestor:security.scan:unscored" }],
      notes: `security.scan: unscored \u2014 ${why}\n${JSON.stringify({ reason: "osv unreachable", hint })}`
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  \u26A0\uFE0F security.scan: ${why} (non-scoring)`);
    return { result: "unscored", reason: "osv unreachable", hint, failures: [] };
  }

  // STGB-VER-002: if ANY package could not be scanned, we cannot certify the release clean \u2014 but we
  // STILL surface the criticals found in the packages that DID scan. Overall result is 'unscored'.
  const osvFailures = Array.isArray(results.failures) ? results.failures : [];

  const { result: scanResult, counts, topCritical, total, ignoredApplied, unknownReasons } =
    scoreVulns(results, { ignoreIds, failSeverities });

  // The scan result the operator sees: a real fail (criticals found) still reads as fail so danger
  // is not hidden; otherwise a partial scan downgrades a would-be pass/warn to non-scoring.
  let result = scanResult;
  let hint;
  if (osvFailures.length > 0 && scanResult !== "fail") {
    result = "unscored";
  }

  let reason;
  if (result === "unscored") {
    const pkgList = osvFailures.map(f => f.package).filter(Boolean).join(", ") || "one or more packages";
    reason = `${osvFailures.length} of ${pkgs.length} package(s) could not be scanned (${pkgList}); cannot certify clean`;
    hint = "Re-run when OSV.dev is reachable for all packages; a partial scan earns no assurance credit (unscored).";
  } else if (result === "pass") {
    reason = `No known vulnerabilities found in ${pkgs.length} packages`;
  } else if (result === "warn") {
    reason = `${total} low/moderate vulnerability(ies) found`;
  } else {
    reason = `${total} vulnerability(ies) found (${counts.critical} critical, ${counts.high} high, ${counts.unknown} unscored)`;
    hint = "Upgrade or remove the affected packages, or add a justified ignoreVulns override; criticals/high/unscored block a pass.";
    if (osvFailures.length > 0) {
      reason += `; ADDITIONALLY ${osvFailures.length} package(s) could not be scanned`;
    }
  }

  // SEC-003: record honored ignores (id + justification) in the attestation notes for audit.
  const honoredIgnores = ignoreEntries
    .filter(e => ignoredApplied.includes(e.id))
    .map(e => ({ id: e.id, justification: e.justification }));

  const notes = `security.scan: ${result} \u2014 ${reason}\n${JSON.stringify({
    reason,
    hint: hint || null,
    counts,
    topCritical,
    packagesScanned: pkgs.length,
    // STGB-VER-002: which packages could not be scanned (empty on a complete scan).
    scanFailures: osvFailures,
    // STGB-VER-007: why any unknown-severity vulns could not be decoded.
    unknownReasons,
    honoredIgnores
  })}`;

  const ev = buildAttestationEvent({
    repo, version, commit: rel.commit,
    artifacts: rel.artifacts,
    attestations: [{ type: "security.scan", uri: `repomesh:attestor:security.scan:${result}` }],
    notes
  });

  const signed = sign ? signEvent(ev, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev;
  if (out) writeJsonlLine(out, signed);
  const icon = result === "pass" ? "\u2705" : result === "warn" ? "\u26A0\uFE0F" : result === "unscored" ? "\u26A0\uFE0F" : "\u274C";
  console.log(`  ${icon} security.scan: ${reason}`);
  return { result, counts, topCritical, reason, hint: hint || null, failures: osvFailures, unknownReasons };
}

async function scanNew({ sign, keyId, signingKeyPath, out }) {
  const events = readEvents();
  const releases = events.filter(e => e?.type === "ReleasePublished");
  const targets = [];

  for (const rel of releases) {
    if (!hasAttestationEvent(events, rel.repo, rel.version, "security.scan")) {
      targets.push({ repo: rel.repo, version: rel.version });
    }
  }

  if (targets.length === 0) {
    console.log("No releases missing security.scan attestation.");
    return { scanned: 0, results: [] };
  }

  console.log(`Found ${targets.length} release(s) to scan.\n`);
  const results = [];
  for (const t of targets) {
    console.log(`Scanning: ${t.repo}@${t.version}`);
    results.push(await runOne({ ...t, sign, keyId, signingKeyPath, out }));
  }
  return { scanned: targets.length, results };
}

// Exports for tests (pure scoring + override loading paths). scoreVulns + computeFailSeverities are
// already exported above. runOne is exported so the unbound-SBOM -> 'unscored' I/O path (D13) is
// testable end-to-end with a temp ledger + mocked fetch.
export { failSeveritiesFromThreshold, buildIgnoreSet, mergeSecurityConfig, loadSecurityOverrides, runOne };

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
        console.log(`\n${r.scanned} release(s) scanned.`);
        if (out) console.log(`Output written to ${out}`);
      })
      .catch(e => { console.error(e); process.exit(1); });
  } else {
    if (!repo || !version) {
      console.error("Usage:");
      console.error("  node verify-security.mjs --repo <org/repo> --version <semver>");
      console.error("  node verify-security.mjs --scan-new [--sign --output <path>]");
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
