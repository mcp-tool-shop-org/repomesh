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
//
// Stage A amend (REG-002, REG-004):
//   - REG-004: every event's signature is verified (canonicalHash recompute + crypto.verify against
//     the resolving node's maintainer publicKey) BEFORE it contributes to any score. ReleasePublished
//     is repo-bound (signer must be a maintainer of its own repo); AttestationPublished/PolicyViolation
//     resolve to a TRUSTED, correctly-kinded node from verifier.policy.json. keyId must resolve to a
//     single node (collisions are fatal).
//   - REG-002: sbom.present / provenance.present integrity points are awarded ONLY when a TRUSTED
//     attestor published an AttestationPublished with consensus `pass`. Inline release-event
//     attestations are display-only unverified claims (no points, no completedChecks credit).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalizeForHash } from "../../ledger/scripts/canonicalize.mjs";

const DEFAULT_ROOT = path.resolve(import.meta.dirname, "..", "..");

const REPO_ID_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

// Third-party-signed event types resolve their key from a TRUSTED attestor/policy node, not the
// event's own repo. Their allowed kinds mirror validate-ledger.mjs (D2 / LDG-007).
const ATTESTOR_KINDS = new Set(["attestor", "registry"]);
const POLICY_KINDS = new Set(["policy", "registry"]);

// Integrity weights — release authenticity dimension (0-100)
const INTEGRITY_WEIGHTS = {
  signed: 15,              // signature verified at ledger ingress
  hasArtifacts: 15,        // release has real artifact hashes
  noPolicyViolations: 15,  // clean policy check
  "sbom.present": 20,      // SBOM attestation (trusted-attestor consensus pass)
  "provenance.present": 20,// build provenance (trusted-attestor consensus pass)
  "signature.chain": 15    // attestor re-verified signature chain
};

// Default assurance weights — safety/compliance dimension (0-100)
const DEFAULT_ASSURANCE_WEIGHTS = {
  "license.audit": { pass: 30, warn: 15, fail: 0 },
  "security.scan": { pass: 40, warn: 20, fail: 0 },
  "repro.build":   { pass: 30, warn: 15, fail: 0 }  // placeholder
};

// Integrity checks that require a TRUSTED-attestor consensus pass (REG-002). These are the
// presence/chain claims a release cannot self-declare — only an independent attestor can grant them.
const ATTESTOR_GATED_INTEGRITY = new Set(["sbom.present", "provenance.present", "signature.chain"]);

// Severity/strictness ordering for threshold validation (stricter = lower index)
const THRESHOLD_STRICTNESS = { fail: 0, warn: 1, pass: 2 };

// D13: the only attestation results that count as a COMPLETED check and may carry assurance weight.
// A non-scoring result ('unscored' — verifier could not certify, e.g. unbound/mismatched SBOM digest
// or a repro build that could not run) scores 0 points AND is reported as a MISSING check, never a
// completed one. Anything outside this set (including 'missing') is treated the same way.
const SCOREABLE_RESULTS = new Set(["pass", "warn", "fail"]);

// ANC-B10: attestation note lines are written "kind: result — reason". The separator was historically
// an em-dash (—), but hand-written/ported notes drift to an en-dash (–) or an ASCII hyphen (-). Accept
// all three so a cosmetic dash variation never silently drops a real attestation result.
const ATTESTATION_NOTE_RE = /^([^:]+):\s*(pass|warn|fail)\s*[—–-]\s*(.+)$/;
// Near-miss detector: a line that starts "kind: pass|warn|fail" but did NOT match the full pattern
// above (e.g. an exotic separator, a stray result token, or no reason). We WARN on these so format
// drift is visible instead of vanishing into an empty parse.
const ATTESTATION_NEARMISS_RE = /^([^:]+):\s*(pass|warn|fail|unscored)\b/;

function readEvents(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return [];
  return fs.readFileSync(ledgerPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

// --- REG-004: signature verification machinery -------------------------------------------------

// Recompute the canonical hash the same way validate-ledger / the CLIs do.
function computeCanonicalHash(event) {
  const copy = JSON.parse(JSON.stringify(event));
  delete copy.signature;
  return crypto.createHash("sha256").update(canonicalizeForHash(copy), "utf8").digest("hex");
}

// Enumerate every registered node manifest under nodesDir, skipping fixture dirs.
const FIXTURE_DIRS = new Set(["a", "fixtures", "__fixtures__", "test", "tests", "example", "examples"]);
function listNodeManifests(nodesDir) {
  if (!fs.existsSync(nodesDir)) return [];
  const out = [];
  for (const org of fs.readdirSync(nodesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !FIXTURE_DIRS.has(d.name))) {
    const orgDir = path.join(nodesDir, org.name);
    for (const repo of fs.readdirSync(orgDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !FIXTURE_DIRS.has(d.name))) {
      const nodePath = path.join(orgDir, repo.name, "node.json");
      if (!fs.existsSync(nodePath)) continue;
      try {
        out.push({ id: `${org.name}/${repo.name}`, manifest: JSON.parse(fs.readFileSync(nodePath, "utf8")) });
      } catch { /* skip malformed node manifest */ }
    }
  }
  return out;
}

function pemFor(manifest, keyId) {
  const m = (manifest.maintainers || []).find((x) => x.keyId === keyId);
  if (!m || !m.publicKey) return null;
  const pk = String(m.publicKey).trim();
  return pk.includes("BEGIN PUBLIC KEY") ? pk : null;
}

// Resolve the public key for a repo-bound (e.g. ReleasePublished) event: the signer MUST be a
// maintainer of the event's OWN repo. Returns { pem } or { error }.
function resolveRepoBoundKey(nodesDir, repoId, keyId) {
  if (!REPO_ID_RE.test(repoId)) return { error: `invalid repoId ${repoId}` };
  const [org, repo] = repoId.split("/");
  const nodePath = path.join(nodesDir, org, repo, "node.json");
  if (!fs.existsSync(nodePath)) return { error: `no node manifest for ${repoId}` };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(nodePath, "utf8")); }
  catch (e) { return { error: `invalid node.json for ${repoId}: ${e.message}` }; }
  const pem = pemFor(manifest, keyId);
  if (!pem) return { error: `no maintainer with keyId=${keyId} in ${repoId} node.json` };
  return { pem, signerNode: repoId };
}

// Resolve the public key for a third-party event from a TRUSTED, correctly-kinded node whose
// maintainer advertises this keyId. FATAL on keyId collision across trusted nodes (ambiguous).
function resolveTrustedKey(nodeManifests, keyId, allowlist, allowedKinds, eventType) {
  const matches = [];
  for (const { id, manifest } of nodeManifests) {
    if (!allowlist.has(id)) continue;
    if (!allowedKinds.has(manifest.kind)) continue;
    const pem = pemFor(manifest, keyId);
    if (pem) matches.push({ id, pem });
  }
  if (matches.length === 0) {
    return { error: `no TRUSTED ${eventType} signer advertises keyId=${keyId}` };
  }
  if (matches.length > 1) {
    // keyId->single-node is a hard invariant: a collision means trust cannot be attributed.
    throw new Error(
      `keyId="${keyId}" collision across multiple trusted nodes (${matches.map((m) => m.id).join(", ")}). ` +
      `keyIds must resolve to a single node — give each node its own keyId.`
    );
  }
  return { pem: matches[0].pem, signerNode: matches[0].id };
}

function verifyEd25519(pem, canonHashHex, sigB64) {
  try {
    return crypto.verify(null, Buffer.from(canonHashHex, "hex"), pem, Buffer.from(sigB64, "base64"));
  } catch { return false; }
}

// Verify an event's signature end-to-end. Returns { ok, signerNode } or { ok:false, reason }.
// Throws ONLY on keyId collisions (a structural invariant that must halt the build).
function verifyEventSignature(event, ctx) {
  const sig = event.signature;
  if (!sig || !sig.canonicalHash || !sig.value || !sig.keyId) {
    return { ok: false, reason: "missing signature fields" };
  }
  const recomputed = computeCanonicalHash(event);
  if (recomputed !== sig.canonicalHash) {
    return { ok: false, reason: "canonicalHash mismatch (event payload tampered)" };
  }

  const isThirdParty = event.type === "AttestationPublished" || event.type === "PolicyViolation";
  let resolved;
  if (isThirdParty) {
    const allowlist = event.type === "PolicyViolation" ? ctx.trustedPolicy : ctx.trustedAttestors;
    const kinds = event.type === "PolicyViolation" ? POLICY_KINDS : ATTESTOR_KINDS;
    resolved = resolveTrustedKey(ctx.nodeManifests, sig.keyId, allowlist, kinds, event.type);
  } else {
    resolved = resolveRepoBoundKey(ctx.nodesDir, event.repo, sig.keyId);
  }
  if (resolved.error) return { ok: false, reason: resolved.error };

  const ok = verifyEd25519(resolved.pem, sig.canonicalHash, sig.value);
  if (!ok) return { ok: false, reason: "signature invalid" };
  return { ok: true, signerNode: resolved.signerNode };
}

// --- profile / overrides loaders --------------------------------------------------------------

function loadRepoProfile(nodesDir, repoId) {
  if (!REPO_ID_RE.test(repoId)) return null;
  const [org, repo] = repoId.split("/");
  const p = path.join(nodesDir, org, repo, "repomesh.profile.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function loadProfileDef(profilesDir, profileId) {
  const p = path.join(profilesDir, `${profileId}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function loadRepoOverrides(nodesDir, repoId) {
  if (!REPO_ID_RE.test(repoId)) return null;
  const [org, repo] = repoId.split("/");
  const p = path.join(nodesDir, org, repo, "repomesh.overrides.json");
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return Object.keys(data).length > 0 ? data : null;
  } catch { return null; }
}

function loadVerifierPolicy(policyPath) {
  if (!fs.existsSync(policyPath)) return null;
  try { return JSON.parse(fs.readFileSync(policyPath, "utf8")); } catch { return null; }
}

// Resolve consensus from multiple attestations for a single check kind.
function resolveConsensus(sources, checkPolicy) {
  if (sources.length === 0) return { consensus: "missing", sources };
  let filtered = sources;
  if (checkPolicy?.mode === "trusted-set" && checkPolicy.trustedNodes?.length > 0) {
    filtered = sources.filter((s) => checkPolicy.trustedNodes.includes(s.node));
  }
  if (filtered.length === 0) return { consensus: "untrusted", sources };

  const results = filtered.map((s) => s.result);
  const policy = checkPolicy?.conflictPolicy || "fail-wins";

  if (results.every((r) => r === results[0])) return { consensus: results[0], sources };

  if (policy === "fail-wins") {
    if (results.includes("fail")) return { consensus: "fail", sources };
    // D13: 'unscored' is STICKY/poisoning. After fail-wins, any trusted attestor reporting
    // 'unscored' (verifier could not certify — e.g. an unbound/tampered SBOM digest) poisons the
    // consensus to 'unscored'. This guarantees a single trusted attestor's 'unscored' cannot be
    // OVERRIDDEN to credit by another's 'pass' (which the old 'mixed'->'warn' fallthrough allowed).
    // 'unscored' scores 0 (weights[result] ?? 0) and is excluded from completedChecks.
    if (results.includes("unscored")) return { consensus: "unscored", sources };
    if (results.includes("warn")) return { consensus: "warn", sources };
    return { consensus: "mixed", sources };
  }
  if (policy === "majority") {
    const counts = {};
    for (const r of results) counts[r] = (counts[r] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      for (const r of ["fail", "warn", "pass"]) { if (counts[r]) return { consensus: r, sources }; }
    }
    return { consensus: sorted[0][0], sources };
  }
  if (policy === "quorum-pass") {
    const quorum = checkPolicy?.quorum || 1;
    const passCount = results.filter((r) => r === "pass").length;
    return { consensus: passCount >= quorum ? "pass" : "fail", sources };
  }
  return { consensus: results[0], sources };
}

function validateOverrides(repoOverrides, profileDef) {
  if (!repoOverrides || !profileDef) return repoOverrides;
  const sanitized = JSON.parse(JSON.stringify(repoOverrides));
  const profileThresholds = profileDef.thresholds || {};

  if (sanitized.thresholds?.licenseTreatUnknownAs && profileThresholds.licenseTreatUnknownAs) {
    const profileLevel = THRESHOLD_STRICTNESS[profileThresholds.licenseTreatUnknownAs];
    const overrideLevel = THRESHOLD_STRICTNESS[sanitized.thresholds.licenseTreatUnknownAs];
    if (profileLevel !== undefined && overrideLevel !== undefined && overrideLevel > profileLevel) {
      console.warn(
        `Warning: repo override licenseTreatUnknownAs="${sanitized.thresholds.licenseTreatUnknownAs}" ` +
        `is weaker than profile "${profileDef.id}" requirement "${profileThresholds.licenseTreatUnknownAs}". Ignoring override.`
      );
      delete sanitized.thresholds.licenseTreatUnknownAs;
    }
  }

  if (Array.isArray(sanitized.thresholds?.securityFailOn) && Array.isArray(profileThresholds.securityFailOn)) {
    const profileSet = new Set(profileThresholds.securityFailOn);
    const overrideSet = new Set(sanitized.thresholds.securityFailOn);
    const removed = [...profileSet].filter((s) => !overrideSet.has(s));
    if (removed.length > 0) {
      console.warn(
        `Warning: repo override securityFailOn removes profile-required severities [${removed.join(", ")}] ` +
        `from profile "${profileDef.id}". Restoring profile requirements.`
      );
      sanitized.thresholds.securityFailOn = [...new Set([...sanitized.thresholds.securityFailOn, ...profileThresholds.securityFailOn])];
    }
  }

  if (sanitized.thresholds && Object.keys(sanitized.thresholds).length === 0) delete sanitized.thresholds;
  return sanitized;
}

// D14: a repo-level override MUST NOT raise the value of a failing/warning bucket. Raising is
// profile/governance-ONLY. We clamp the repo layer so `fail` stays 0 and `warn` cannot exceed the
// profile/default warn ceiling for that check. (`pass` may be tuned by the repo freely — only the
// fail/warn floors are governance-controlled, mirroring the strictness floor on treatUnknownAs /
// failOnSeverities.) The profile layer applies first and IS allowed to raise.
function resolveAssuranceWeights(profileDef, repoOverrides) {
  const weights = {};
  for (const [k, v] of Object.entries(DEFAULT_ASSURANCE_WEIGHTS)) weights[k] = { ...v };
  // Profile layer (governance): may raise fail/warn freely.
  if (profileDef?.scoring?.assuranceWeights) {
    for (const [k, v] of Object.entries(profileDef.scoring.assuranceWeights)) {
      if (weights[k]) weights[k] = { ...weights[k], ...v };
    }
  }
  // The fail/warn ceilings a repo override may not exceed are the post-profile values resolved above.
  const ceilings = {};
  for (const [k, v] of Object.entries(weights)) ceilings[k] = { fail: v.fail ?? 0, warn: v.warn ?? 0 };
  // Repo layer: clamp fail to 0 and warn to the profile/default ceiling; lowering is honored.
  if (repoOverrides?.scoring?.assuranceWeights) {
    for (const [k, v] of Object.entries(repoOverrides.scoring.assuranceWeights)) {
      if (!weights[k]) continue;
      const next = { ...weights[k], ...v };
      // fail bucket is a hard floor of 0 — a repo can never make a FAILING check earn points.
      if (next.fail !== undefined && next.fail > 0) {
        console.warn(
          `Warning: repo override assuranceWeights["${k}"].fail=${next.fail} would raise a FAILING ` +
          `check's score. Clamping to 0 (raising is profile/governance-only).`
        );
        next.fail = 0;
      }
      // warn bucket may be lowered but not raised above the profile/default warn.
      if (next.warn !== undefined && next.warn > ceilings[k].warn) {
        console.warn(
          `Warning: repo override assuranceWeights["${k}"].warn=${next.warn} exceeds the profile/default ` +
          `ceiling (${ceilings[k].warn}). Clamping to ${ceilings[k].warn} (raising is profile/governance-only).`
        );
        next.warn = ceilings[k].warn;
      }
      weights[k] = next;
    }
  }
  return weights;
}

// --- main build -------------------------------------------------------------------------------

export function buildTrust(opts = {}) {
  const root = opts.root || DEFAULT_ROOT;
  const ledgerPath = opts.ledgerPath || path.join(root, "ledger", "events", "events.jsonl");
  const nodesDir = opts.nodesDir || path.join(root, "ledger", "nodes");
  const profilesDir = opts.profilesDir || path.join(root, "profiles");
  const registryDir = opts.registryDir || path.join(root, "registry");
  const policyPath = opts.policyPath || path.join(root, "verifier.policy.json");
  const write = opts.write !== false;

  const events = readEvents(ledgerPath);
  const verifierPolicy = loadVerifierPolicy(policyPath);
  const nodeManifests = listNodeManifests(nodesDir);
  const ctx = {
    nodesDir,
    nodeManifests,
    trustedAttestors: new Set(verifierPolicy?.trustedAttestors || []),
    trustedPolicy: new Set(verifierPolicy?.trustedPolicy || verifierPolicy?.trustedAttestors || []),
  };

  // REG-004: verify EVERY event's signature up front; keep only those that pass. A forged or
  // unauthorized event never contributes to any score. (keyId collisions throw and halt the build.)
  const verifiedEvents = [];
  for (const ev of events) {
    const v = verifyEventSignature(ev, ctx);
    if (v.ok) {
      verifiedEvents.push({ ev, signerNode: v.signerNode });
    } else {
      console.warn(`Warning: dropping ${ev.type} ${ev.repo}@${ev.version} — signature not verified (${v.reason}).`);
    }
  }
  const signerByEvent = new Map(verifiedEvents.map(({ ev, signerNode }) => [ev, signerNode]));
  const okEvents = verifiedEvents.map(({ ev }) => ev);

  // Index releases (verified only)
  const releases = {};
  for (const ev of okEvents) {
    if (ev.type !== "ReleasePublished") continue;
    const key = `${ev.repo}@${ev.version}`;
    releases[key] = {
      repo: ev.repo,
      version: ev.version,
      commit: ev.commit,
      timestamp: ev.timestamp,
      artifactCount: ev.artifacts?.length || 0,
      // Inline attestations are kept for DISPLAY only (REG-002): they never earn integrity points.
      inlineAttestations: (Array.isArray(ev.attestations) ? ev.attestations : []).map((a) => a.type),
      attestations: [],
      attestationSources: {},
      policyViolations: [],
      disputes: [],          // FC6: trusted, non-self disputes that DOWNGRADE the verdict.
      ignoredDisputes: [],   // FC6: self-disputes kept for display only (no scoring effect).
      disputed: false,       // FC6: true iff an unresolved trusted dispute stands.
      trustScore: 0,
      integrityScore: 0,
      assuranceScore: 0,
    };
  }

  // Collect ALL attestation sources per (release, check kind) — from verified AttestationPublished.
  const rawSources = {};
  for (const ev of okEvents) {
    if (ev.type !== "AttestationPublished") continue;
    const key = `${ev.repo}@${ev.version}`;
    if (!releases[key]) continue;
    const signerNode = signerByEvent.get(ev) || "unknown";

    try {
      const noteLines = (ev.notes || "").split("\n").filter(Boolean);
      for (const line of noteLines) {
        const match = line.match(ATTESTATION_NOTE_RE);
        if (match) {
          const kind = match[1].trim();
          (rawSources[key] ||= {});
          (rawSources[key][kind] ||= []);
          if (!rawSources[key][kind].some((s) => s.node === signerNode)) {
            rawSources[key][kind].push({ result: match[2], reason: match[3].trim(), node: signerNode, timestamp: ev.timestamp });
          }
        } else if (ATTESTATION_NEARMISS_RE.test(line)) {
          // ANC-B10: looks like an attestation result line but the full pattern didn't match (bad
          // separator / missing reason). Warn so format drift is caught instead of silently dropped.
          console.warn(
            `Warning: attestation note for ${key} looks like a result line but did not parse ` +
            `(expected "kind: pass|warn|fail — reason"): ${JSON.stringify(line)}`
          );
        }
      }
    } catch (noteErr) {
      console.warn(`Warning: failed to parse attestation notes for ${key}: ${noteErr.message}`);
    }

    try {
      const evAttestations = Array.isArray(ev.attestations) ? ev.attestations : [];
      for (const att of evAttestations) {
        if (!att || typeof att.uri !== "string") continue;
        const uriMatch = att.uri.match(/^repomesh:attestor:([^:]+):(\w+)$/);
        if (uriMatch) {
          const kind = uriMatch[1];
          const result = uriMatch[2];
          (rawSources[key] ||= {});
          (rawSources[key][kind] ||= []);
          if (!rawSources[key][kind].some((s) => s.node === signerNode)) {
            rawSources[key][kind].push({ result, reason: "", node: signerNode, timestamp: ev.timestamp });
          }
        }
      }
    } catch (uriErr) {
      console.warn(`Warning: failed to parse attestation URIs for ${key}: ${uriErr.message}`);
    }
  }

  // FC6 (#4 LSP-01): index dispute events that AFFECT scoring.
  // A dispute is carried on an AttestationPublished whose attestations[] includes attestation.dispute.
  // Because AttestationPublished is third-party-signed, only events whose signer resolved to a TRUSTED,
  // correctly-kinded node (resolveTrustedKey against verifier.policy.json `trustedAttestors` + the
  // ATTESTOR_KINDS gate) survived into okEvents — an untrusted/non-allowlisted dispute was already
  // dropped at signature verification and never reaches here. We additionally REFUSE self-disputes:
  // a node may not dispute its OWN release (signerNode === the disputed repo). Self/untrusted disputes
  // are display-only and IGNORED for scoring, mirroring the attestation doctrine. Recorded disputes
  // (entry.disputes) are the SCORING-AFFECTING set; a self-dispute is captured separately for display.
  for (const ev of okEvents) {
    if (ev.type !== "AttestationPublished") continue;
    if (!(Array.isArray(ev.attestations) ? ev.attestations : []).some((a) => a.type === "attestation.dispute")) continue;
    const key = `${ev.repo}@${ev.version}`;
    if (!releases[key]) continue;
    const signerNode = signerByEvent.get(ev) || "unknown";
    const record = {
      disputedHash: ev.notes?.match(/disputed:([0-9a-f]{64})/)?.[1] || null,
      reason: ev.notes || "",
      node: signerNode,
      timestamp: ev.timestamp,
    };
    if (signerNode === ev.repo) {
      // Self-dispute: a node disputing its own release. IGNORED for scoring (display-only).
      record.ignored = "self-dispute";
      releases[key].ignoredDisputes.push(record);
      console.warn(`Warning: ignoring self-dispute on ${key} (signer ${signerNode} is the release repo).`);
      continue;
    }
    releases[key].disputes.push(record);
  }

  // Resolve consensus and populate backward-compatible attestations.
  for (const [key, kindMap] of Object.entries(rawSources)) {
    if (!releases[key]) continue;
    releases[key].attestationSources = {};
    for (const [kind, sources] of Object.entries(kindMap)) {
      const checkPolicy = verifierPolicy?.checks?.[kind] || null;
      const resolved = resolveConsensus(sources, checkPolicy);
      releases[key].attestationSources[kind] = { consensus: resolved.consensus, sources: resolved.sources };
      if (!releases[key].attestations.some((a) => a.kind === kind)) {
        releases[key].attestations.push({
          kind,
          result: resolved.consensus === "mixed" ? "warn" : resolved.consensus,
          reason: sources[0]?.reason || "",
        });
      }
    }
  }

  // Index policy violations (verified only)
  for (const ev of okEvents) {
    if (ev.type !== "PolicyViolation") continue;
    const key = `${ev.repo}@${ev.version}`;
    if (!releases[key]) continue;
    releases[key].policyViolations.push({ notes: ev.notes || "Policy violation detected" });
  }

  // Compute trust scores (both dimensions, profile-aware)
  for (const entry of Object.values(releases)) {
    const repoProfile = loadRepoProfile(nodesDir, entry.repo);
    const profileId = repoProfile?.profileId || null;
    const profileDef = profileId ? loadProfileDef(profilesDir, profileId) : null;
    const rawOverrides = loadRepoOverrides(nodesDir, entry.repo);
    const repoOverrides = validateOverrides(rawOverrides, profileDef);
    const assuranceWeights = resolveAssuranceWeights(profileDef, repoOverrides);

    entry.profileId = profileId;

    const expectedIntegrity = profileDef?.requiredChecks?.integrity || Object.keys(INTEGRITY_WEIGHTS);
    const expectedAssurance = profileDef?.requiredChecks?.assurance || [];
    entry.expectedChecks = [...expectedIntegrity, ...expectedAssurance];

    // REG-002: an integrity check is satisfied by a trusted attestor only if the resolved consensus
    // for that kind is `pass`. Inline self-declared attestations grant nothing.
    const attestorPassed = (kind) =>
      entry.attestations.some((a) => a.kind === kind && a.result === "pass");

    // --- Integrity Score ---
    let integrityScore = 0;
    integrityScore += INTEGRITY_WEIGHTS.signed; // being in the verified set means signature passed
    if (entry.artifactCount > 0) integrityScore += INTEGRITY_WEIGHTS.hasArtifacts;
    if (entry.policyViolations.length === 0) integrityScore += INTEGRITY_WEIGHTS.noPolicyViolations;

    // Attestor-gated integrity checks (sbom/provenance/signature.chain): trusted consensus pass only.
    for (const kind of ATTESTOR_GATED_INTEGRITY) {
      if (INTEGRITY_WEIGHTS[kind] !== undefined && attestorPassed(kind)) {
        integrityScore += INTEGRITY_WEIGHTS[kind];
      }
    }
    // NOTE (REG-002): inline release-event attestations are NOT scored. They live in
    // entry.inlineAttestations for display only.

    entry.integrityScore = Math.min(integrityScore, 100);

    // --- Assurance Score (profile-aware) ---
    let assuranceScore = 0;
    const assuranceBreakdown = {};
    const checksToScore = expectedAssurance.length > 0 ? expectedAssurance : Object.keys(DEFAULT_ASSURANCE_WEIGHTS);

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
      // D13: a non-scoring 'unscored' result (verifier could not certify) earns 0 assurance points
      // — weights['unscored'] is undefined so `?? 0` already floors it; an absent attestation is
      // likewise 0. Only pass/warn/fail carry weight.
      const pts = SCOREABLE_RESULTS.has(result) ? (weights[result] ?? 0) : 0;
      assuranceBreakdown[kind] = { result, points: pts, max: weights.pass };
      assuranceScore += pts;
    }
    // ANC-B09: make the /100 renormalization transparent. When the sum of pass-weights for the
    // scored checks is not 100, the raw achieved points are rescaled to a /100 axis. We record the
    // raw achieved, the sum-of-pass-weights denominator, and the scaling factor so the displayed
    // assuranceScore is auditable rather than an opaque number.
    if (maxPossible > 0 && maxPossible !== 100) {
      const scalingFactor = 100 / maxPossible;
      entry.assuranceScore = Math.min(Math.round(assuranceScore * scalingFactor), 100);
      entry.assuranceScaling = {
        rawAchieved: assuranceScore,
        sumOfPassWeights: maxPossible,
        scalingFactor: Math.round(scalingFactor * 1000) / 1000,
        renormalized: true,
      };
    } else {
      entry.assuranceScore = Math.min(assuranceScore, 100);
      entry.assuranceScaling = {
        rawAchieved: assuranceScore,
        sumOfPassWeights: maxPossible,
        scalingFactor: 1,
        renormalized: false,
      };
    }
    entry.assuranceBreakdown = assuranceBreakdown;

    // Completed/missing checks
    const completedChecks = [];
    const missingChecks = [];
    for (const check of expectedIntegrity) {
      let passed = false;
      if (check === "signed") passed = true;
      else if (check === "hasArtifacts") passed = entry.artifactCount > 0;
      else if (check === "noPolicyViolations") passed = entry.policyViolations.length === 0;
      else if (ATTESTOR_GATED_INTEGRITY.has(check)) {
        // REG-002: only a trusted-attestor consensus pass counts — NOT inline self-declaration.
        passed = attestorPassed(check);
      }
      (passed ? completedChecks : missingChecks).push(check);
    }
    for (const check of expectedAssurance) {
      const att = entry.attestations.find((a) => a.kind === check);
      // D13: only pass/warn/fail are completed checks. A non-scoring 'unscored' result (and an
      // absent/'missing' attestation) is reported as a MISSING check, never completed.
      if (att && SCOREABLE_RESULTS.has(att.result)) completedChecks.push(check);
      else missingChecks.push(check);
    }
    // FC6 (#4 LSP-01): an unresolved TRUSTED, non-self dispute downgrades the verdict. The disputed
    // integrity/assurance claim is treated as FAILED: the attestor-gated integrity credit a release
    // cannot self-declare (sbom/provenance/signature.chain) is revoked, and the score is capped below
    // the UNVERIFIED ceiling (<40) so the verdict is "no better than UNVERIFIED" while the dispute
    // stands. The downgrade is recorded on entry.integrityScore so badges/snippets reflect it too.
    const DISPUTE_INTEGRITY_CAP = 39; // one point under the PARTIAL floor (40) = strictly UNVERIFIED band.
    entry.disputed = entry.disputes.length > 0;
    entry.completedChecks = completedChecks;
    entry.missingChecks = missingChecks;
    if (entry.disputed) {
      // Revoke attestor-gated integrity credit (the dispute attacks exactly these claims), then cap.
      let revoked = entry.integrityScore;
      for (const kind of ATTESTOR_GATED_INTEGRITY) {
        if (INTEGRITY_WEIGHTS[kind] !== undefined && attestorPassed(kind)) revoked -= INTEGRITY_WEIGHTS[kind];
      }
      entry.integrityScore = Math.max(0, Math.min(revoked, DISPUTE_INTEGRITY_CAP));
      // Mark the disputed integrity check as no-longer-completed so the proof chain stays honest.
      entry.completedChecks = completedChecks.filter((c) => !ATTESTOR_GATED_INTEGRITY.has(c));
      for (const kind of ATTESTOR_GATED_INTEGRITY) {
        if (entry.expectedChecks?.includes(kind) && !entry.missingChecks.includes(kind)) {
          entry.missingChecks.push(kind);
        }
      }
    }

    entry.trustScore = entry.integrityScore;

    // ANC-B04: a legible one-line summary of WHY this release scored as it did. A bare score is not
    // actionable; an operator/CI needs to know exactly which required checks are missing, failed, or
    // could-not-be-scored. We label the verdict by the integrity badge thresholds (the same ones the
    // CLI/dashboard render) and itemize the gaps with their cause.
    // FC6: a standing trusted dispute forces the DISPUTED verdict (a distinct, louder state than the
    // numeric band) — it is never reported as VERIFIED/PARTIAL while unresolved.
    entry.verdict = entry.disputed ? "DISPUTED"
      : entry.integrityScore >= 70 ? "VERIFIED"
      : entry.integrityScore >= 40 ? "PARTIAL" : "UNVERIFIED";
    const failed = [];     // attestor RAN and said fail (a fail is a completed-but-failing check)
    const unscored = [];   // verifier could not certify (network/unbound) — 0 points, MISSING
    const absent = [];     // no attestation at all
    // Categorize EVERY required check (integrity + assurance) by its observed cause. A 'fail' result
    // lives in completedChecks (it ran), so scanning only missingChecks would hide it — we scan the
    // full expected set and look up each one's attestation result.
    const seen = new Set();
    const noteCause = (check) => {
      if (seen.has(check)) return;
      seen.add(check);
      // noPolicyViolations is a synthetic integrity check: a present violation is a FAILED cause.
      if (check === "noPolicyViolations" && entry.policyViolations.length > 0) { failed.push(check); return; }
      const att = entry.attestations.find((a) => a.kind === check);
      if (att?.result === "fail") { failed.push(check); return; }
      if (att?.result === "unscored") { unscored.push(check); return; }
      // Anything still in missingChecks with no fail/unscored cause is simply absent.
      if (missingChecks.includes(check)) absent.push(check);
    };
    for (const check of entry.expectedChecks || []) noteCause(check);
    const parts = [];
    // FC6: surface the dispute reason FIRST — it is the dominant cause of the downgrade. Each dispute
    // is shown as "disputed by <node>: <reason>" so a consumer/CI sees who disputed it and why.
    if (entry.disputed) {
      for (const d of entry.disputes) {
        // The reason note carries "… — <human reason>"; strip the machine "disputed:<hash>" token for
        // legibility but keep the human tail. Fall back to the raw reason if no separator is present.
        const human = (d.reason || "").split(/\s[—–-]\s/).slice(1).join(" — ").trim() || d.reason || "(no reason given)";
        parts.push(`disputed by ${d.node}: ${human}`);
      }
    }
    if (failed.length) parts.push(`failed: ${failed.join(", ")}`);
    if (unscored.length) parts.push(`unscored (verifier could not run): ${unscored.join(", ")}`);
    if (absent.length) parts.push(`missing: ${absent.join(", ")}`);
    entry.trustSummary = parts.length
      ? `${entry.verdict} (integrity ${entry.integrityScore}/100) — ${parts.join("; ")}`
      : `${entry.verdict} (integrity ${entry.integrityScore}/100) — all required checks satisfied`;
  }

  // Build output (strip internal fields)
  const output = Object.values(releases)
    .map(({ inlineAttestations, ...rest }) => rest)
    .map((entry) => {
      const assuranceConsensus = {};
      for (const [kind, data] of Object.entries(entry.attestationSources || {})) {
        assuranceConsensus[kind] = {
          consensus: data.consensus,
          sourceCount: data.sources.length,
          // STGB-VER-003: KEEP each source's reason string so trust.json explains WHY a check
          // resolved to warn/unscored/fail — a result token alone ("warn") is not legible to a
          // consumer or CI. The reason is the verifier's own one-line cause (e.g. "moderate vuln").
          sources: data.sources.map((s) => ({ node: s.node, result: s.result, reason: s.reason || "" })),
        };
      }
      return { ...entry, assuranceConsensus };
    })
    .sort((a, b) => {
      const cmp = a.repo.localeCompare(b.repo);
      if (cmp !== 0) return cmp;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

  if (write) {
    fs.writeFileSync(path.join(registryDir, "trust.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(`Trust index built: ${output.length} release(s).`);
    for (const entry of output) {
      const iBadge = entry.disputed ? "⛔" : entry.integrityScore >= 70 ? "✅" : entry.integrityScore >= 40 ? "⚠️" : "❌";
      const aBadge = entry.assuranceScore > 0
        ? (entry.assuranceScore >= 70 ? " ✅" : entry.assuranceScore >= 30 ? " ⚠️" : " ❌")
        : "";
      const profile = entry.profileId ? ` [${entry.profileId}]` : "";
      const missing = entry.missingChecks.length > 0 ? ` (missing: ${entry.missingChecks.join(", ")})` : "";
      console.log(`  ${iBadge} ${entry.repo}@${entry.version}${profile} — integrity: ${entry.integrityScore}/100, assurance: ${entry.assuranceScore}/100${aBadge}${missing}`);
      // ANC-B04: print the legible verdict summary inline with each release (the cause, not just the score).
      console.log(`      ↳ ${entry.trustSummary}`);
      // ANC-B09: when the assurance axis was renormalized, show raw achieved vs sum-of-pass-weights.
      if (entry.assuranceScaling?.renormalized) {
        const s = entry.assuranceScaling;
        console.log(`      ↳ assurance renormalized: ${s.rawAchieved} raw / ${s.sumOfPassWeights} possible × ${s.scalingFactor} = ${entry.assuranceScore}/100`);
      }
    }
  }

  return output;
}

// CLI entrypoint — only when invoked as a script, not when imported by tests.
const INVOKED_AS_SCRIPT =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, "build-trust.mjs");
if (INVOKED_AS_SCRIPT) {
  buildTrust();
}
