#!/usr/bin/env node
// RepoMesh Trust Index — Generates registry/trust.json
// Answers: "Is org/repo@version good?"
//
// For each (repo, version), aggregates:
//   - release event summary
//   - attestation results (integrity + assurance dimensions)
//   - policy violations
//   - computed trust scores (integrityScore, assuranceScore, trustScore)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const REGISTRY_DIR = path.join(ROOT, "registry");

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

// Integrity weights — release authenticity dimension (0-100)
const INTEGRITY_WEIGHTS = {
  signed: 15,              // signature verified at ledger ingress
  hasArtifacts: 15,        // release has real artifact hashes
  noPolicyViolations: 15,  // clean policy check
  "sbom.present": 20,      // SBOM attestation on release event
  "provenance.present": 20,// build provenance on release event
  "signature.chain": 15    // attestor re-verified signature chain
};

// Assurance weights — safety/compliance dimension (0-100)
// Each key maps to { pass, warn, fail } point values
const ASSURANCE_WEIGHTS = {
  "license.audit": { pass: 30, warn: 15, fail: 0 },
  "security.scan": { pass: 40, warn: 20, fail: 0 },
  "repro.build":   { pass: 30, warn: 15, fail: 0 }  // placeholder
};

// Extract result from attestation URI (repomesh:attestor:<kind>:<result>)
function attestationResultFromUri(uri) {
  const u = String(uri || "");
  if (/:pass\b/.test(u)) return "pass";
  if (/:warn\b/.test(u)) return "warn";
  if (/:fail\b/.test(u)) return "fail";
  return null;
}

const events = readEvents();

// Index releases
const releases = {};
for (const ev of events) {
  if (ev.type !== "ReleasePublished") continue;
  const key = `${ev.repo}@${ev.version}`;
  releases[key] = {
    repo: ev.repo,
    version: ev.version,
    commit: ev.commit,
    timestamp: ev.timestamp,
    artifactCount: ev.artifacts?.length || 0,
    inlineAttestations: (ev.attestations || []).map((a) => a.type),
    attestations: [],
    policyViolations: [],
    trustScore: 0,
    integrityScore: 0,
    assuranceScore: 0
  };
}

// Index attestations from ALL AttestationPublished events
for (const ev of events) {
  if (ev.type !== "AttestationPublished") continue;
  const key = `${ev.repo}@${ev.version}`;
  if (!releases[key]) continue;

  // Parse attestation results from the notes field (supports pass/warn/fail)
  const notes = ev.notes || "";
  const lines = notes.split("\n").filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(pass|warn|fail)\s*\u2014\s*(.+)$/);
    if (match) {
      const kind = match[1].trim();
      // Avoid duplicates from multiple parsing methods
      if (!releases[key].attestations.some((a) => a.kind === kind)) {
        releases[key].attestations.push({
          kind,
          result: match[2],
          reason: match[3].trim()
        });
      }
    }
  }

  // Also check attestation URIs for inline results
  for (const att of ev.attestations || []) {
    const uriMatch = att.uri?.match(/^repomesh:attestor:([^:]+):(\w+)$/);
    if (uriMatch) {
      const kind = uriMatch[1];
      const result = uriMatch[2];
      // Avoid duplicates
      if (!releases[key].attestations.some((a) => a.kind === kind)) {
        releases[key].attestations.push({ kind, result, reason: "" });
      }
    }
  }
}

// Index policy violations
for (const ev of events) {
  if (ev.type !== "PolicyViolation") continue;
  const key = `${ev.repo}@${ev.version}`;
  if (!releases[key]) continue;
  releases[key].policyViolations.push({
    notes: ev.notes || "Policy violation detected"
  });
}

// Compute trust scores (both dimensions)
for (const entry of Object.values(releases)) {
  // --- Integrity Score ---
  let integrityScore = 0;

  // Being in the ledger at all means signature was verified
  integrityScore += INTEGRITY_WEIGHTS.signed;

  // Has real artifacts (non-placeholder hashes)
  if (entry.artifactCount > 0) {
    integrityScore += INTEGRITY_WEIGHTS.hasArtifacts;
  }

  // No policy violations bonus
  if (entry.policyViolations.length === 0) {
    integrityScore += INTEGRITY_WEIGHTS.noPolicyViolations;
  }

  // Check attestation results (from AttestationPublished events)
  for (const att of entry.attestations) {
    if (att.result === "pass" && INTEGRITY_WEIGHTS[att.kind] !== undefined) {
      integrityScore += INTEGRITY_WEIGHTS[att.kind];
    }
  }

  // Also check inline attestations on the release event itself
  if (entry.inlineAttestations) {
    for (const type of entry.inlineAttestations) {
      const k = type === "sbom" ? "sbom.present" : type === "provenance" ? "provenance.present" : null;
      if (k && INTEGRITY_WEIGHTS[k] !== undefined) {
        if (!entry.attestations.some((a) => a.kind === k && a.result === "pass")) {
          integrityScore += INTEGRITY_WEIGHTS[k];
        }
      }
    }
  }

  entry.integrityScore = Math.min(integrityScore, 100);

  // --- Assurance Score ---
  let assuranceScore = 0;
  const assuranceBreakdown = {};

  for (const [kind, weights] of Object.entries(ASSURANCE_WEIGHTS)) {
    // Find the attestation result for this kind
    const att = entry.attestations.find((a) => a.kind === kind);
    const result = att?.result || "missing";
    const pts = result !== "missing" ? (weights[result] ?? 0) : 0;
    assuranceBreakdown[kind] = { result, points: pts, max: weights.pass };
    assuranceScore += pts;
  }

  entry.assuranceScore = Math.min(assuranceScore, 100);
  entry.assuranceBreakdown = assuranceBreakdown;

  // trustScore = integrityScore for backward compatibility
  entry.trustScore = entry.integrityScore;
}

// Write output (strip internal fields)
const output = Object.values(releases)
  .map(({ inlineAttestations, ...rest }) => rest)
  .sort((a, b) => {
    const cmp = a.repo.localeCompare(b.repo);
    if (cmp !== 0) return cmp;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

fs.writeFileSync(
  path.join(REGISTRY_DIR, "trust.json"),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(`Trust index built: ${output.length} release(s).`);
for (const entry of output) {
  const iBadge = entry.integrityScore >= 70 ? "\u2705" : entry.integrityScore >= 40 ? "\u26A0\uFE0F" : "\u274C";
  const aBadge = entry.assuranceScore > 0
    ? (entry.assuranceScore >= 70 ? " \u2705" : entry.assuranceScore >= 30 ? " \u26A0\uFE0F" : " \u274C")
    : "";
  console.log(`  ${iBadge} ${entry.repo}@${entry.version} \u2014 integrity: ${entry.integrityScore}/100, assurance: ${entry.assuranceScore}/100${aBadge}`);
}
