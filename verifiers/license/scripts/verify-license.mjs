#!/usr/bin/env node
// RepoMesh License Verifier — Scans SBOM components against license allowlist.
//
// Usage:
//   node verify-license.mjs --repo org/repo --version 1.2.3
//   node verify-license.mjs --scan-new
//   node verify-license.mjs --scan-new --sign --output /tmp/license.jsonl

import fs from "node:fs";
import path from "node:path";
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
import { findSbomUriFromReleaseEvent, fetchCycloneDxComponents } from "../../lib/fetch-sbom.mjs";

function loadConfig() {
  const p = path.join(process.cwd(), "verifiers/license/config.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Load per-repo overrides from ledger node snapshot
function loadOverrides(repo) {
  const [org, repoName] = repo.split("/");
  const p = path.join(process.cwd(), "ledger/nodes", org, repoName, "repomesh.overrides.json");
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data?.license || null;
  } catch { return null; }
}

// Merge base config with per-repo overrides
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

  // Override unknown handling (stored for use in classifyLicenses)
  if (overrides.treatUnknownAs) {
    merged.treatUnknownAs = overrides.treatUnknownAs;
  }

  return merged;
}

function classifyLicenses(components, cfg) {
  const allow = new Set(cfg.allowlist);
  const coprefix = cfg.copyleftPrefixes || [];
  const coexact = new Set(cfg.copyleftExact || []);

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

    let hasCopyleft = false;
    let hasUnknown = false;

    for (const lic of ls) {
      const L = String(lic).trim();
      const isAllowed = allow.has(L);
      const isCopyleft =
        coexact.has(L) || coprefix.some(p => L.startsWith(p));

      if (isCopyleft) hasCopyleft = true;
      else if (!isAllowed) hasUnknown = true;
    }

    if (hasCopyleft) findings.copyleft.push({ name: c.name, version: c.version, licenses: ls });
    else if (hasUnknown) findings.unknownOrMissing.push({ name: c.name, version: c.version, licenses: ls, reason: "unknown" });
    else findings.allowed++;
  }

  let result = "pass";
  if (findings.copyleft.length > 0) result = "fail";
  else if (findings.unknownOrMissing.length > 0) {
    // Respect treatUnknownAs override from profile/overrides
    result = cfg.treatUnknownAs || "warn";
  }

  return { result, findings };
}

async function runOne({ repo, version, sign, keyId, signingKeyPath, out }) {
  const events = readEvents();
  const rel = findReleaseEvent(events, repo, version);
  if (!rel) throw new Error(`No ReleasePublished found for ${repo}@${version}`);

  if (hasAttestationEvent(events, repo, version, "license.audit") && String(sign) !== "force") {
    return { skipped: true, reason: "already attested (license.audit)" };
  }

  const sbomUri = findSbomUriFromReleaseEvent(rel);
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
  const comps = await fetchCycloneDxComponents(sbomUri);
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

// --- main ---
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
