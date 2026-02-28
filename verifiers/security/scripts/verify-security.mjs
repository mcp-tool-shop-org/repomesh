#!/usr/bin/env node
// RepoMesh Security Verifier — Queries OSV.dev for known vulnerabilities in SBOM components.
//
// Usage:
//   node verify-security.mjs --repo org/repo --version 1.2.3
//   node verify-security.mjs --scan-new
//   node verify-security.mjs --scan-new --sign --output /tmp/security.jsonl

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Load per-repo overrides from ledger node snapshot
function loadSecurityOverrides(repo) {
  const [org, repoName] = repo.split("/");
  const p = path.join(process.cwd(), "ledger/nodes", org, repoName, "repomesh.overrides.json");
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data?.security || null;
  } catch { return null; }
}

async function osvQueryBatch(queries) {
  const url = "https://api.osv.dev/v1/querybatch";
  const body = { queries };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`OSV HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(300 * (attempt + 1));
    }
  }
}

function purlToOsvPackage(purl) {
  if (!purl || typeof purl !== "string") return null;
  if (!purl.startsWith("pkg:npm/")) return null;
  const rest = purl.slice("pkg:npm/".length);
  const [namePart, verPart] = rest.split("@");
  if (!namePart || !verPart) return null;
  return { ecosystem: "npm", name: decodeURIComponent(namePart), version: decodeURIComponent(verPart) };
}

function severityBucket(vuln) {
  const sev = vuln?.severity;
  if (Array.isArray(sev) && sev.length > 0) {
    const s = String(sev[0]?.score || "").trim();
    const n = Number(s);
    if (!Number.isNaN(n)) {
      if (n >= 9.0) return "critical";
      if (n >= 7.0) return "high";
      if (n >= 4.0) return "moderate";
      return "low";
    }
  }
  return "unknown";
}

async function runOne({ repo, version, sign, keyId, signingKeyPath, out }) {
  const events = readEvents();
  const rel = findReleaseEvent(events, repo, version);
  if (!rel) throw new Error(`No ReleasePublished found for ${repo}@${version}`);

  if (hasAttestationEvent(events, repo, version, "security.scan") && String(sign) !== "force") {
    return { skipped: true, reason: "already attested (security.scan)" };
  }

  const sbomUri = findSbomUriFromReleaseEvent(rel);
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

  const comps = await fetchCycloneDxComponents(sbomUri);
  const pkgs = comps.map(c => purlToOsvPackage(c.purl)).filter(Boolean);

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

  // Build OSV queries (batch, max 1000 per request)
  const queries = pkgs.map(p => ({ package: { ecosystem: p.ecosystem, name: p.name }, version: p.version }));
  let osv;
  try {
    osv = await osvQueryBatch(queries);
  } catch (e) {
    const ev0 = buildAttestationEvent({
      repo, version, commit: rel.commit,
      artifacts: rel.artifacts,
      attestations: [{ type: "security.scan", uri: "repomesh:attestor:security.scan:warn" }],
      notes: `security.scan: warn \u2014 OSV API unreachable: ${String(e?.message || e)}`
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log("  \u26A0\uFE0F security.scan: OSV API unreachable");
    return { result: "warn", reason: "osv unreachable" };
  }

  // Load per-repo overrides
  const overrides = loadSecurityOverrides(repo);
  const ignoreIds = new Set((overrides?.ignoreVulns || []).map(v => v.id));
  const failSeverities = new Set(overrides?.failOnSeverities || ["critical", "high"]);

  const results = Array.isArray(osv?.results) ? osv.results : [];
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 };
  const topCritical = [];

  for (const r of results) {
    const vulns = Array.isArray(r?.vulns) ? r.vulns : [];
    for (const v of vulns) {
      const vulnId = v?.id || v?.aliases?.[0] || "UNKNOWN";
      // Skip ignored vulns (with justification required in overrides)
      if (ignoreIds.has(vulnId)) continue;

      const b = severityBucket(v);
      counts[b] = (counts[b] || 0) + 1;
      if (b === "critical" && topCritical.length < 5) {
        topCritical.push(vulnId);
      }
    }
  }

  const total = counts.critical + counts.high + counts.moderate + counts.low + counts.unknown;
  let result = "pass";
  // Use failOnSeverities from overrides (default: critical + high)
  const hasFail = [...failSeverities].some(sev => (counts[sev] || 0) > 0);
  if (hasFail) result = "fail";
  else if (total > 0) result = "warn";

  let reason;
  if (result === "pass") {
    reason = `No known vulnerabilities found in ${pkgs.length} packages`;
  } else if (result === "warn") {
    reason = `${total} low/moderate vulnerability(ies) found`;
  } else {
    reason = `${total} vulnerability(ies) found (${counts.critical} critical, ${counts.high} high)`;
  }

  const notes = `security.scan: ${result} \u2014 ${reason}\n${JSON.stringify({ counts, topCritical, packagesScanned: pkgs.length })}`;

  const ev = buildAttestationEvent({
    repo, version, commit: rel.commit,
    artifacts: rel.artifacts,
    attestations: [{ type: "security.scan", uri: `repomesh:attestor:security.scan:${result}` }],
    notes
  });

  const signed = sign ? signEvent(ev, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev;
  if (out) writeJsonlLine(out, signed);
  const icon = result === "pass" ? "\u2705" : result === "warn" ? "\u26A0\uFE0F" : "\u274C";
  console.log(`  ${icon} security.scan: ${reason}`);
  return { result, counts, topCritical };
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
