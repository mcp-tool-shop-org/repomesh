#!/usr/bin/env node
// RepoMesh Trust Verifier — Consumer helper for checking release trust.
//
// Usage:
//   node verify-trust.mjs --repo org/repo --version 1.2.3
//   node verify-trust.mjs --repo org/repo  (latest version)
//
// Prints trust summary + missing items for the given release.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TRUST_PATH = path.join(ROOT, "registry", "trust.json");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");

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
  // Find latest version for this repo
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
const attestedKinds = new Set(
  (entry.attestations || []).filter((a) => a.result === "pass").map((a) => a.kind)
);

// Build checklist
const checks = [
  {
    name: "Signed & in ledger",
    key: "signed",
    weight: 15,
    pass: true // if it's in trust.json, it's signed
  },
  {
    name: "Has artifacts",
    key: "hasArtifacts",
    weight: 15,
    pass: entry.artifactCount > 0
  },
  {
    name: "No policy violations",
    key: "noPolicyViolations",
    weight: 15,
    pass: (entry.policyViolations || []).length === 0
  },
  {
    name: "SBOM present",
    key: "sbom.present",
    weight: 20,
    pass: inlineTypes.has("sbom") || inlineTypes.has("sbom.present") || attestedKinds.has("sbom.present")
  },
  {
    name: "Provenance present",
    key: "provenance.present",
    weight: 20,
    pass: inlineTypes.has("provenance") || attestedKinds.has("provenance.present")
  },
  {
    name: "Signature chain verified",
    key: "signature.chain",
    weight: 15,
    pass: attestedKinds.has("signature.chain")
  }
];

// Print summary
const badge = entry.trustScore >= 80 ? "\u2705" : entry.trustScore >= 50 ? "\u26A0\uFE0F" : "\u274C";
console.log(`\n${badge} ${entry.repo}@${entry.version} — Trust Score: ${entry.trustScore}/100\n`);
console.log(`  Commit:    ${entry.commit}`);
console.log(`  Published: ${entry.timestamp}`);
console.log(`  Artifacts: ${entry.artifactCount}`);
console.log();

// Print checklist
console.log("  Trust Breakdown:");
let computed = 0;
const missing = [];
for (const c of checks) {
  const mark = c.pass ? "\u2705" : "\u274C";
  const pts = c.pass ? `+${c.weight}` : ` 0`;
  console.log(`    ${mark} ${c.name.padEnd(28)} ${pts.padStart(3)} pts`);
  if (c.pass) computed += c.weight;
  if (!c.pass) missing.push(c);
}
console.log(`${"".padEnd(37)}${"---".padStart(6)}`);
console.log(`${"".padEnd(34)}Total: ${computed}/100`);

// Print recommendations
if (missing.length > 0) {
  console.log("\n  To improve trust score:");
  for (const m of missing) {
    switch (m.key) {
      case "sbom.present":
        console.log(`    - Add SBOM generation to your broadcast workflow (npm sbom --sbom-format cyclonedx)`);
        break;
      case "provenance.present":
        console.log(`    - Add provenance generation to your broadcast workflow (SLSA-style statement)`);
        break;
      case "signature.chain":
        console.log(`    - Wait for the attestor to run (or trigger: gh workflow run attestor-ci)`);
        break;
      case "hasArtifacts":
        console.log(`    - Ensure your broadcast workflow hashes real build artifacts`);
        break;
      case "noPolicyViolations":
        console.log(`    - Fix policy violations (run: node policy/scripts/check-policy.mjs --repo ${repo})`);
        break;
    }
  }
}

// Print attestation details if any
if (entry.attestations?.length > 0) {
  console.log("\n  Attestation Details:");
  for (const att of entry.attestations) {
    const mark = att.result === "pass" ? "\u2705" : "\u274C";
    console.log(`    ${mark} ${att.kind}: ${att.reason || att.result}`);
  }
}

console.log();
process.exit(entry.trustScore >= 50 ? 0 : 1);
