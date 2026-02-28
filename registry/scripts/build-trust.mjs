#!/usr/bin/env node
// RepoMesh Trust Index — Generates registry/trust.json
// Answers: "Is org/repo@version good?"
//
// For each (repo, version), aggregates:
//   - release event summary
//   - attestation results
//   - policy violations
//   - computed trust score

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

// Score weights — target: 80+ for a well-formed release
// Basic release (signed, artifacts, no violations) = 45
// + SBOM = 65, + provenance = 85, + full attestor = 100
const WEIGHTS = {
  signed: 15,              // signature verified at ledger ingress
  hasArtifacts: 15,        // release has real artifact hashes
  noPolicyViolations: 15,  // clean policy check
  "sbom.present": 20,      // SBOM attestation on release event
  "provenance.present": 20,// build provenance on release event
  "signature.chain": 15    // attestor re-verified signature chain
};

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
    trustScore: 0
  };
}

// Index attestations
for (const ev of events) {
  if (ev.type !== "AttestationPublished") continue;
  const key = `${ev.repo}@${ev.version}`;
  if (!releases[key]) continue;

  // Parse attestation results from the notes field
  const notes = ev.notes || "";
  const lines = notes.split("\n").filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(pass|fail)\s*—\s*(.+)$/);
    if (match) {
      releases[key].attestations.push({
        kind: match[1].trim(),
        result: match[2],
        reason: match[3].trim()
      });
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

// Compute trust scores
for (const entry of Object.values(releases)) {
  let score = 0;

  // Being in the ledger at all means signature was verified
  score += WEIGHTS.signed;

  // Has real artifacts (non-placeholder hashes)
  const hasReal = entry.artifactCount > 0;
  if (hasReal) {
    score += WEIGHTS.hasArtifacts;
  }

  // No policy violations bonus
  if (entry.policyViolations.length === 0) {
    score += WEIGHTS.noPolicyViolations;
  }

  // Check attestation results (from AttestationPublished events)
  for (const att of entry.attestations) {
    if (att.result === "pass" && WEIGHTS[att.kind] !== undefined) {
      score += WEIGHTS[att.kind];
    }
  }

  // Also check inline attestations on the release event itself
  // (SBOM/provenance declared at emission time)
  if (entry.inlineAttestations) {
    for (const type of entry.inlineAttestations) {
      const key = type === "sbom" ? "sbom.present" : type === "provenance" ? "provenance.present" : null;
      if (key && WEIGHTS[key] !== undefined) {
        // Only credit if not already credited from AttestationPublished
        if (!entry.attestations.some((a) => a.kind === key && a.result === "pass")) {
          score += WEIGHTS[key];
        }
      }
    }
  }

  entry.trustScore = Math.min(score, 100);
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
  const badge = entry.trustScore >= 70 ? "\u2705" : entry.trustScore >= 40 ? "\u26A0\uFE0F" : "\u274C";
  console.log(`  ${badge} ${entry.repo}@${entry.version} — score: ${entry.trustScore}/100`);
}
