#!/usr/bin/env node
// RepoMesh Trust Index — Generates registry/trust.json
// Answers: "Is org/repo@version good?"
//
// For each (repo, version), aggregates:
//   - release event summary
//   - attestation results (integrity + assurance dimensions)
//   - policy violations
//   - computed trust scores (integrityScore, assuranceScore, trustScore)
//   - profile-aware expected/completed/missing checks

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const NODES_DIR = path.join(ROOT, "ledger", "nodes");
const PROFILES_DIR = path.join(ROOT, "profiles");
const REGISTRY_DIR = path.join(ROOT, "registry");
const POLICY_PATH = path.join(ROOT, "verifier.policy.json");

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

// Load profile selection for a repo from its node snapshot directory
function loadRepoProfile(repoId) {
  const [org, repo] = repoId.split("/");
  const profilePath = path.join(NODES_DIR, org, repo, "repomesh.profile.json");
  if (!fs.existsSync(profilePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch { return null; }
}

// Load canonical profile definition
function loadProfileDef(profileId) {
  const p = path.join(PROFILES_DIR, `${profileId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return null; }
}

// Load overrides for a repo from its node snapshot directory
function loadRepoOverrides(repoId) {
  const [org, repo] = repoId.split("/");
  const overridesPath = path.join(NODES_DIR, org, repo, "repomesh.overrides.json");
  if (!fs.existsSync(overridesPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    return Object.keys(data).length > 0 ? data : null;
  } catch { return null; }
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

// Default assurance weights — safety/compliance dimension (0-100)
const DEFAULT_ASSURANCE_WEIGHTS = {
  "license.audit": { pass: 30, warn: 15, fail: 0 },
  "security.scan": { pass: 40, warn: 20, fail: 0 },
  "repro.build":   { pass: 30, warn: 15, fail: 0 }  // placeholder
};

// Load verifier policy
function loadVerifierPolicy() {
  if (!fs.existsSync(POLICY_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(POLICY_PATH, "utf8")); } catch { return null; }
}

// Identify signing node for a keyId
function findSignerNode(keyId) {
  if (!fs.existsSync(NODES_DIR)) return null;
  for (const org of fs.readdirSync(NODES_DIR, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const orgDir = path.join(NODES_DIR, org.name);
    for (const repo of fs.readdirSync(orgDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
      const nodePath = path.join(orgDir, repo.name, "node.json");
      if (!fs.existsSync(nodePath)) continue;
      const node = JSON.parse(fs.readFileSync(nodePath, "utf8"));
      if ((node.maintainers || []).some(m => m.keyId === keyId)) return node.id;
    }
  }
  return null;
}

// Resolve consensus from multiple attestations for a single check kind
function resolveConsensus(sources, checkPolicy) {
  if (sources.length === 0) return { consensus: "missing", sources };

  // Filter to trusted set if policy requires it
  let filtered = sources;
  if (checkPolicy?.mode === "trusted-set" && checkPolicy.trustedNodes?.length > 0) {
    filtered = sources.filter(s => checkPolicy.trustedNodes.includes(s.node));
  }
  if (filtered.length === 0) return { consensus: "untrusted", sources };

  const results = filtered.map(s => s.result);
  const policy = checkPolicy?.conflictPolicy || "fail-wins";

  if (results.every(r => r === results[0])) {
    // Unanimous
    return { consensus: results[0], sources };
  }

  // Disagreement
  if (policy === "fail-wins") {
    if (results.includes("fail")) return { consensus: "fail", sources };
    if (results.includes("warn")) return { consensus: "warn", sources };
    return { consensus: "mixed", sources };
  }

  if (policy === "majority") {
    const counts = {};
    for (const r of results) counts[r] = (counts[r] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      // Tie — go safer
      const order = ["fail", "warn", "pass"];
      for (const r of order) { if (counts[r]) return { consensus: r, sources }; }
    }
    return { consensus: sorted[0][0], sources };
  }

  if (policy === "quorum-pass") {
    const quorum = checkPolicy?.quorum || 1;
    const passCount = results.filter(r => r === "pass").length;
    return { consensus: passCount >= quorum ? "pass" : "fail", sources };
  }

  return { consensus: results[0], sources };
}

// Merge profile scoring overrides and repo overrides into assurance weights
function resolveAssuranceWeights(profileDef, repoOverrides) {
  const weights = {};
  for (const [k, v] of Object.entries(DEFAULT_ASSURANCE_WEIGHTS)) {
    weights[k] = { ...v };
  }

  // Profile-level scoring overrides
  if (profileDef?.scoring?.assuranceWeights) {
    for (const [k, v] of Object.entries(profileDef.scoring.assuranceWeights)) {
      if (weights[k]) weights[k] = { ...weights[k], ...v };
    }
  }

  // Repo-level scoring overrides (highest priority)
  if (repoOverrides?.scoring?.assuranceWeights) {
    for (const [k, v] of Object.entries(repoOverrides.scoring.assuranceWeights)) {
      if (weights[k]) weights[k] = { ...weights[k], ...v };
    }
  }

  return weights;
}

const events = readEvents();
const verifierPolicy = loadVerifierPolicy();

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
    attestations: [],       // resolved (one per check kind, backward compat)
    attestationSources: {}, // all sources per check kind (new: multi-attestor)
    policyViolations: [],
    disputes: [],
    trustScore: 0,
    integrityScore: 0,
    assuranceScore: 0
  };
}

// Collect ALL attestation sources per (release, check kind)
const rawSources = {}; // key -> { kind -> [{result, reason, node, timestamp}] }
for (const ev of events) {
  if (ev.type !== "AttestationPublished") continue;
  const key = `${ev.repo}@${ev.version}`;
  if (!releases[key]) continue;

  const signerNode = findSignerNode(ev.signature?.keyId) || "unknown";

  // Parse from notes
  const notes = ev.notes || "";
  const noteLines = notes.split("\n").filter(Boolean);
  for (const line of noteLines) {
    const match = line.match(/^([^:]+):\s*(pass|warn|fail)\s*\u2014\s*(.+)$/);
    if (match) {
      const kind = match[1].trim();
      if (!rawSources[key]) rawSources[key] = {};
      if (!rawSources[key][kind]) rawSources[key][kind] = [];
      // Deduplicate by (kind, node)
      if (!rawSources[key][kind].some(s => s.node === signerNode)) {
        rawSources[key][kind].push({
          result: match[2], reason: match[3].trim(),
          node: signerNode, timestamp: ev.timestamp,
        });
      }
    }
  }

  // Also check attestation URIs
  for (const att of ev.attestations || []) {
    const uriMatch = att.uri?.match(/^repomesh:attestor:([^:]+):(\w+)$/);
    if (uriMatch) {
      const kind = uriMatch[1];
      const result = uriMatch[2];
      if (!rawSources[key]) rawSources[key] = {};
      if (!rawSources[key][kind]) rawSources[key][kind] = [];
      if (!rawSources[key][kind].some(s => s.node === signerNode)) {
        rawSources[key][kind].push({
          result, reason: "",
          node: signerNode, timestamp: ev.timestamp,
        });
      }
    }
  }
}

// Index dispute events
for (const ev of events) {
  if (ev.type !== "AttestationPublished") continue;
  if (!(ev.attestations || []).some(a => a.type === "attestation.dispute")) continue;
  const key = `${ev.repo}@${ev.version}`;
  if (!releases[key]) continue;
  const signerNode = findSignerNode(ev.signature?.keyId) || "unknown";
  releases[key].disputes.push({
    disputedHash: ev.notes?.match(/disputed:([0-9a-f]{64})/)?.[1] || null,
    reason: ev.notes || "",
    node: signerNode,
    timestamp: ev.timestamp,
  });
}

// Resolve consensus and populate backward-compatible attestations
for (const [key, kindMap] of Object.entries(rawSources)) {
  if (!releases[key]) continue;
  releases[key].attestationSources = {};

  for (const [kind, sources] of Object.entries(kindMap)) {
    const checkPolicy = verifierPolicy?.checks?.[kind] || null;
    const resolved = resolveConsensus(sources, checkPolicy);

    releases[key].attestationSources[kind] = {
      consensus: resolved.consensus,
      sources: resolved.sources,
    };

    // Backward compat: single attestation entry per kind
    if (!releases[key].attestations.some(a => a.kind === kind)) {
      releases[key].attestations.push({
        kind,
        result: resolved.consensus === "mixed" ? "warn" : resolved.consensus,
        reason: sources[0]?.reason || "",
      });
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

// Compute trust scores (both dimensions, profile-aware)
for (const entry of Object.values(releases)) {
  // Load profile for this repo
  const repoProfile = loadRepoProfile(entry.repo);
  const profileId = repoProfile?.profileId || null;
  const profileDef = profileId ? loadProfileDef(profileId) : null;
  const repoOverrides = loadRepoOverrides(entry.repo);
  const assuranceWeights = resolveAssuranceWeights(profileDef, repoOverrides);

  entry.profileId = profileId;

  // --- Expected checks from profile ---
  const expectedIntegrity = profileDef?.requiredChecks?.integrity || Object.keys(INTEGRITY_WEIGHTS);
  const expectedAssurance = profileDef?.requiredChecks?.assurance || [];

  entry.expectedChecks = [...expectedIntegrity, ...expectedAssurance];

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

  // --- Assurance Score (profile-aware) ---
  let assuranceScore = 0;
  const assuranceBreakdown = {};

  // Only score checks relevant to the profile
  // If no profile, score all known checks (backward compat)
  const checksToScore = expectedAssurance.length > 0
    ? expectedAssurance
    : Object.keys(DEFAULT_ASSURANCE_WEIGHTS);

  // Compute max possible score for normalization
  let maxPossible = 0;
  for (const kind of checksToScore) {
    const weights = assuranceWeights[kind] || DEFAULT_ASSURANCE_WEIGHTS[kind];
    if (!weights) continue;
    maxPossible += weights.pass;
  }

  for (const kind of checksToScore) {
    const weights = assuranceWeights[kind] || DEFAULT_ASSURANCE_WEIGHTS[kind];
    if (!weights) continue;

    const att = entry.attestations.find((a) => a.kind === kind);
    const result = att?.result || "missing";
    const pts = result !== "missing" ? (weights[result] ?? 0) : 0;
    assuranceBreakdown[kind] = { result, points: pts, max: weights.pass };
    assuranceScore += pts;
  }

  // Normalize to 0-100 if using a subset of checks
  if (maxPossible > 0 && maxPossible !== 100) {
    entry.assuranceScore = Math.min(Math.round((assuranceScore / maxPossible) * 100), 100);
  } else {
    entry.assuranceScore = Math.min(assuranceScore, 100);
  }
  entry.assuranceBreakdown = assuranceBreakdown;

  // Completed/missing checks
  const completedChecks = [];
  const missingChecks = [];

  // Integrity completed/missing
  for (const check of expectedIntegrity) {
    let passed = false;
    if (check === "signed") passed = true;
    else if (check === "hasArtifacts") passed = entry.artifactCount > 0;
    else if (check === "noPolicyViolations") passed = entry.policyViolations.length === 0;
    else if (check === "sbom.present") {
      passed = entry.attestations.some(a => a.kind === "sbom.present" && a.result === "pass")
        || (entry.inlineAttestations || []).some(t => t === "sbom" || t === "sbom.present");
    }
    else if (check === "provenance.present") {
      passed = entry.attestations.some(a => a.kind === "provenance.present" && a.result === "pass")
        || (entry.inlineAttestations || []).includes("provenance");
    }
    else if (check === "signature.chain") {
      passed = entry.attestations.some(a => a.kind === "signature.chain" && a.result === "pass");
    }

    if (passed) completedChecks.push(check);
    else missingChecks.push(check);
  }

  // Assurance completed/missing
  for (const check of expectedAssurance) {
    const att = entry.attestations.find(a => a.kind === check);
    if (att && att.result !== "missing") completedChecks.push(check);
    else missingChecks.push(check);
  }

  entry.completedChecks = completedChecks;
  entry.missingChecks = missingChecks;

  // trustScore = integrityScore for backward compatibility
  entry.trustScore = entry.integrityScore;
}

// Write output (strip internal fields)
const output = Object.values(releases)
  .map(({ inlineAttestations, ...rest }) => rest)
  .map((entry) => {
    // Build assurance consensus summary
    const assuranceConsensus = {};
    for (const [kind, data] of Object.entries(entry.attestationSources || {})) {
      assuranceConsensus[kind] = {
        consensus: data.consensus,
        sourceCount: data.sources.length,
        sources: data.sources.map(s => ({ node: s.node, result: s.result })),
      };
    }
    return { ...entry, assuranceConsensus };
  })
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
  const profile = entry.profileId ? ` [${entry.profileId}]` : "";
  const missing = entry.missingChecks.length > 0 ? ` (missing: ${entry.missingChecks.join(", ")})` : "";
  console.log(`  ${iBadge} ${entry.repo}@${entry.version}${profile} \u2014 integrity: ${entry.integrityScore}/100, assurance: ${entry.assuranceScore}/100${aBadge}${missing}`);
}
