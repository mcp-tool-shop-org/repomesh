#!/usr/bin/env node
// RepoMesh Trust Verifier — Consumer helper for checking release trust.
//
// Usage:
//   node verify-trust.mjs --repo org/repo --version 1.2.3
//   node verify-trust.mjs --repo org/repo  (latest version)
//
// Prints trust summary with integrity/assurance breakdowns and profile-based coaching.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TRUST_PATH = path.join(ROOT, "registry", "trust.json");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const NODES_DIR = path.join(ROOT, "ledger", "nodes");
const PROFILES_DIR = path.join(ROOT, "profiles");

const args = process.argv.slice(2);
const repoIdx = args.indexOf("--repo");
const versionIdx = args.indexOf("--version");

if (repoIdx === -1) {
  console.error("Usage:");
  console.error("  node verify-trust.mjs --repo <org/repo> [--version <semver>]");
  process.exit(1);
}

const repo = args[repoIdx + 1];
const version = versionIdx !== -1 ? args[versionIdx + 1] : null;

// Load trust index
if (!fs.existsSync(TRUST_PATH)) {
  console.error("Trust index not found. Run: node registry/scripts/build-trust.mjs");
  process.exit(1);
}

const trust = JSON.parse(fs.readFileSync(TRUST_PATH, "utf8"));

// Find matching entry
let entry;
if (version) {
  entry = trust.find((e) => e.repo === repo && e.version === version);
} else {
  const repoEntries = trust.filter((e) => e.repo === repo);
  if (repoEntries.length > 0) {
    repoEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    entry = repoEntries[0];
  }
}

if (!entry) {
  console.error(`No trust data found for ${repo}${version ? `@${version}` : ""}.`);
  console.error("The release may not exist in the ledger yet.");
  process.exit(1);
}

// Load profile info
function loadRepoProfile(repoId) {
  const [org, r] = repoId.split("/");
  const p = path.join(NODES_DIR, org, r, "repomesh.profile.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function loadProfileDef(profileId) {
  const p = path.join(PROFILES_DIR, `${profileId}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

const repoProfile = loadRepoProfile(entry.repo);
const profileId = entry.profileId || repoProfile?.profileId || null;
const profileDef = profileId ? loadProfileDef(profileId) : null;

// Load release event for inline attestation info
const events = fs.existsSync(LEDGER_PATH)
  ? fs.readFileSync(LEDGER_PATH, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l))
  : [];

const releaseEvent = events.find(
  (ev) => ev.type === "ReleasePublished" && ev.repo === entry.repo && ev.version === entry.version
);

const inlineTypes = new Set((releaseEvent?.attestations || []).map((a) => a.type));
const attestedKinds = new Map();
for (const a of entry.attestations || []) {
  attestedKinds.set(a.kind, a.result);
}

// Build integrity checklist
const integrityChecks = [
  { name: "Signed & in ledger", key: "signed", weight: 15, pass: true },
  { name: "Has artifacts", key: "hasArtifacts", weight: 15, pass: entry.artifactCount > 0 },
  { name: "No policy violations", key: "noPolicyViolations", weight: 15, pass: (entry.policyViolations || []).length === 0 },
  {
    name: "SBOM present", key: "sbom.present", weight: 20,
    pass: inlineTypes.has("sbom") || inlineTypes.has("sbom.present") || attestedKinds.get("sbom.present") === "pass"
  },
  {
    name: "Provenance present", key: "provenance.present", weight: 20,
    pass: inlineTypes.has("provenance") || attestedKinds.get("provenance.present") === "pass"
  },
  { name: "Signature chain verified", key: "signature.chain", weight: 15, pass: attestedKinds.get("signature.chain") === "pass" }
];

// Build assurance checklist
const assuranceWeights = {
  "license.audit": { pass: 30, warn: 15, fail: 0 },
  "security.scan": { pass: 40, warn: 20, fail: 0 },
  "repro.build":   { pass: 30, warn: 15, fail: 0 }
};

const expectedAssurance = profileDef?.requiredChecks?.assurance || Object.keys(assuranceWeights);

const assuranceChecks = expectedAssurance.map((kind) => {
  const weights = assuranceWeights[kind] || { pass: 0, warn: 0, fail: 0 };
  const result = attestedKinds.get(kind) || "pending";
  const pts = result !== "pending" ? (weights[result] ?? 0) : 0;
  return {
    name: kind,
    key: kind,
    maxWeight: weights.pass,
    result,
    points: pts,
    required: (profileDef?.requiredChecks?.assurance || []).includes(kind)
  };
});

// Compute scores
const integrityScore = entry.integrityScore ?? entry.trustScore ?? 0;
const assuranceScore = entry.assuranceScore ?? 0;

// Print header
const iBadge = integrityScore >= 80 ? "\u2705" : integrityScore >= 50 ? "\u26A0\uFE0F" : "\u274C";
const aBadge = assuranceScore >= 70 ? "\u2705" : assuranceScore >= 30 ? "\u26A0\uFE0F" : "\u274C";
console.log(`\n${iBadge} ${entry.repo}@${entry.version}`);
console.log(`  Integrity Score:  ${integrityScore}/100`);
console.log(`  Assurance Score:  ${assuranceScore}/100`);
if (profileId) {
  console.log(`  Profile:          ${profileId}${profileDef ? ` (${profileDef.version})` : ""}`);
}
console.log();
console.log(`  Commit:    ${entry.commit}`);
console.log(`  Published: ${entry.timestamp}`);
console.log(`  Artifacts: ${entry.artifactCount}`);

// Print integrity breakdown
console.log("\n  Integrity Breakdown:");
let computedIntegrity = 0;
const missingIntegrity = [];
for (const c of integrityChecks) {
  const mark = c.pass ? "\u2705" : "\u274C";
  const pts = c.pass ? `+${c.weight}` : ` 0`;
  console.log(`    ${mark} ${c.name.padEnd(28)} ${pts.padStart(3)} pts`);
  if (c.pass) computedIntegrity += c.weight;
  if (!c.pass) missingIntegrity.push(c);
}
console.log(`${"".padEnd(37)}${"---".padStart(6)}`);
console.log(`${"".padEnd(34)}Total: ${computedIntegrity}/100`);

// Print assurance breakdown
console.log("\n  Assurance Breakdown:");
let computedAssurance = 0;
const missingAssurance = [];
for (const c of assuranceChecks) {
  let mark, ptsStr;
  if (c.result === "pass") {
    mark = "\u2705";
    ptsStr = `+${c.points}`;
  } else if (c.result === "warn") {
    mark = "\u26A0\uFE0F";
    ptsStr = `+${c.points}`;
  } else if (c.result === "fail") {
    mark = "\u274C";
    ptsStr = ` 0`;
  } else {
    mark = "\u23F3";
    ptsStr = ` 0`;
  }
  const reqTag = c.required ? "" : " (optional)";
  const label = `${c.name} (${c.result})${reqTag}`;
  console.log(`    ${mark} ${label.padEnd(38)} ${ptsStr.padStart(3)} / ${c.maxWeight} pts`);
  computedAssurance += c.points;
  if (c.result === "pending" || c.result === "fail") missingAssurance.push(c);
}
console.log(`${"".padEnd(45)}${"---".padStart(6)}`);
console.log(`${"".padEnd(42)}Total: ${computedAssurance}/100`);

// Print coaching recommendations
const allMissing = [...missingIntegrity, ...missingAssurance];
if (allMissing.length > 0) {
  console.log("\n  What to do next:");

  for (const m of missingIntegrity) {
    switch (m.key) {
      case "sbom.present":
        console.log(`    \u2192 Add SBOM generation to your broadcast workflow`);
        console.log(`      npm sbom --sbom-format cyclonedx (already in broadcast template)`);
        if (profileDef?.requiredEvidence?.sbom) {
          console.log(`      Your profile (${profileId}) requires SBOM.`);
        }
        break;
      case "provenance.present":
        console.log(`    \u2192 Add provenance generation to your broadcast workflow`);
        console.log(`      The broadcast template generates SLSA-style provenance automatically.`);
        if (profileDef?.requiredEvidence?.provenance) {
          console.log(`      Your profile (${profileId}) requires provenance.`);
        }
        break;
      case "signature.chain":
        console.log(`    \u2192 Wait for the next attestor cycle (runs every 6 hours)`);
        console.log(`      Or trigger manually: gh workflow run attestor-ci`);
        break;
      case "hasArtifacts":
        console.log(`    \u2192 Ensure your broadcast workflow hashes real build artifacts`);
        console.log(`      Check the "Hash artifacts" step in repomesh-broadcast.yml`);
        break;
      case "noPolicyViolations":
        console.log(`    \u2192 Fix policy violations:`);
        console.log(`      node policy/scripts/check-policy.mjs --repo ${repo}`);
        break;
    }
  }

  for (const m of missingAssurance) {
    switch (m.key) {
      case "license.audit":
        if (m.result === "pending") {
          console.log(`    \u2192 License audit not yet run`);
          if (m.required) {
            console.log(`      Your profile (${profileId}) requires this check.`);
          }
          console.log(`      Wait for attestor cycle, or run locally:`);
          console.log(`      node verifiers/license/scripts/verify-license.mjs --repo ${repo} --version ${entry.version}`);
        } else if (m.result === "fail") {
          console.log(`    \u2192 License audit failed: copyleft licenses detected`);
          // Find the attestation for details
          const att = (entry.attestations || []).find(a => a.kind === "license.audit");
          if (att?.reason) console.log(`      Reason: ${att.reason}`);
          console.log(`      Review: verifiers/license/config.json (allowlist/copyleft rules)`);
          console.log(`      Override: add allowed licenses to repomesh.overrides.json`);
        }
        break;
      case "security.scan":
        if (m.result === "pending") {
          console.log(`    \u2192 Security scan not yet run`);
          if (m.required) {
            console.log(`      Your profile (${profileId}) requires this check.`);
          }
          console.log(`      Wait for attestor cycle, or run locally:`);
          console.log(`      node verifiers/security/scripts/verify-security.mjs --repo ${repo} --version ${entry.version}`);
        } else if (m.result === "fail") {
          console.log(`    \u2192 Security scan failed: high/critical vulnerabilities found`);
          const att = (entry.attestations || []).find(a => a.kind === "security.scan");
          if (att?.reason) console.log(`      Reason: ${att.reason}`);
          console.log(`      To ignore known-safe vulns: add to repomesh.overrides.json with justification`);
        }
        break;
      case "repro.build":
        if (m.result === "pending") {
          console.log(`    \u2192 Reproducible build check not yet available (planned)`);
          if (m.required) {
            console.log(`      Your profile (${profileId}) requires this check.`);
            console.log(`      This will be scored once the repro.build verifier ships.`);
          }
        }
        break;
    }
  }
}

// Print attestation details if any
if (entry.attestations?.length > 0) {
  console.log("\n  Attestation Details:");
  for (const att of entry.attestations) {
    const mark = att.result === "pass" ? "\u2705" : att.result === "warn" ? "\u26A0\uFE0F" : "\u274C";
    console.log(`    ${mark} ${att.kind}: ${att.reason || att.result}`);
  }
}

// Print expected checks summary (profile-aware)
if (entry.expectedChecks?.length > 0) {
  const completed = entry.completedChecks || [];
  const missing = entry.missingChecks || [];
  console.log(`\n  Check Coverage: ${completed.length}/${entry.expectedChecks.length} expected checks complete`);
  if (missing.length > 0) {
    console.log(`  Missing: ${missing.join(", ")}`);
  }
}

console.log();
process.exit(integrityScore >= 50 ? 0 : 1);
