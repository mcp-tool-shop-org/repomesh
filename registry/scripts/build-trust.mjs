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
// Key-lifecycle window predicate + OFFLINE trusted-time resolver (contract §5). build-trust scores
// the LOCAL ledger offline, so it uses the SYNC resolver. The predicate gates every key the build
// resolves by keyId: a compromise-revoked-but-still-listed key no longer scores full integrity.
// A maintainer with NO window fields is grandfathered => always valid (byte-identical to today).
// Contract §12.1 (Wave-B2) — deriveKeyWindowConstraints + mergeStricterWindow close the node.json-
// tamper / grandfather-strip bypass: a tampered node.json that STRIPS a revoked key's window fields
// re-grandfathers it (isWindowed=false => VALID). The fix derives the window from the SIGNED
// KeyRotation/KeyRevocation events (authorization gated, §4) and merges in the MOST RESTRICTIVE of
// node.json + derived, so a tampered node.json can only ADD restriction, never remove what the signed
// events assert. With NO key events for a repo the derived map is empty => merge is the identity =>
// grandfather stays byte-identical to today.
import {
  isKeyValidForSignature,
  resolveTrustedSignatureTimeSync,
  deriveKeyWindowConstraints,
  mergeStricterWindow,
} from "../../verifiers/lib/key-window.mjs";
// SEAM-PARSE-001: the ONE canonical anchor-note metadata parser (replaces this file's old greedy
// trailing-JSON regex). The anchor-event-type + range guards stay local to parseAnchorMeta below.
import { parseAnchorPartitionMeta } from "../../verifiers/lib/anchor-notes.mjs";
// STGB-TRUST-004: atomic temp-file + rename write so a crash mid-write can't tear trust.json.
import { writeJsonAtomic } from "../../verifiers/lib/common.mjs";
// #7 verifier-plugin contract — the SINGLE check-kinds registry + node-kinds permission map, resolved
// from verifier.policy.json (v2) with per-field fallback to the historical hardcoded defaults (v1). This
// is what makes a new check kind a verifier.policy.json EDIT, not a code change. Every resolver below
// falls back, per field, to the exact pre-#7 constant when the policy omits it, so the shipped v2 policy
// (whose values mirror the old constants) and any v1 policy score BYTE-IDENTICALLY to pre-#7.
import {
  nodeKindsForEvent,
  integrityCheckWeights,
  assuranceWeights as resolveAssuranceWeightDefaults,
  attestorGatedIntegrity,
  scoreableResults,
  isRegisteredCheck,
} from "../../verifiers/lib/policy.mjs";

const DEFAULT_ROOT = path.resolve(import.meta.dirname, "..", "..");

const REPO_ID_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

// SCORING-A-003: the verdict-band thresholds are a SINGLE shared source of truth. build-trust is the
// AUTHORITATIVE producer (it writes the verdict into trust.json), so its canonical 70/40 thresholds
// live here and are exported for the consumers (verify-trust.mjs renders the badge + exit code,
// build-badges.mjs picks the score color). Before this constant existed, verify-trust hard-coded
// green ≥80 / exit-0 ≥50 and build-badges used green ≥80 / yellow ≥50 — a THIRD threshold set — so a
// 70-79 release was VERIFIED to the producer but RED+exit-0 to the consumer, and a 40-49 release was
// PARTIAL to the producer but exit-1 (unusable) to the consumer. The bands now agree across all three:
//   integrity >= VERIFIED (70) → VERIFIED / green / exit 0
//   integrity >= PARTIAL  (40) → PARTIAL  / yellow / exit 0
//   else                       → UNVERIFIED / red / exit 1
// GREEN/YELLOW are aliases used by the badge color + consumer banner so the visual tiers track the
// SAME boundaries as the verdict. (A disputed release is a louder, distinct state handled separately.)
export const INTEGRITY_BANDS = Object.freeze({
  VERIFIED: 70,
  PARTIAL: 40,
  // Aliases for the badge/consumer color tiers — bound to the canonical verdict thresholds above.
  GREEN: 70,
  YELLOW: 40,
});

// SCORING-A-003 helpers — the single mapping from a score to its band/color, reused by build-trust's
// own output and importable by the consumers so the decision is identical everywhere.
export function integrityVerdict(score) {
  return score >= INTEGRITY_BANDS.VERIFIED ? "VERIFIED"
    : score >= INTEGRITY_BANDS.PARTIAL ? "PARTIAL" : "UNVERIFIED";
}
export function bandColor(score) {
  if (score >= INTEGRITY_BANDS.GREEN) return "#4c1";    // green
  if (score >= INTEGRITY_BANDS.YELLOW) return "#dfb317"; // yellow
  return "#e05d44";                                       // red
}

// #7: node-kind permissions, the integrity CHECK-KIND weights, the default assurance weights, the
// attestor-gated set, and the scoreable-results set are NO LONGER hardcoded here — they are resolved
// from verifier.policy.json via the contract resolver (imported above), with per-field fallback to the
// exact pre-#7 defaults. The two constants that remain are the ones the resolver does NOT own:
//
//   1. INTRINSIC_INTEGRITY_WEIGHTS — the release-INTRINSIC integrity points (signed / hasArtifacts /
//      noPolicyViolations). These are NOT check kinds (no attestor publishes them; they are derived from
//      the release event itself), so they stay in the scorer. The full integrity weight table is built
//      per-build as { ...INTRINSIC_INTEGRITY_WEIGHTS, ...integrityCheckWeights(policy) }.
//   2. THRESHOLD_STRICTNESS — the override strictness floor ordering (unrelated to the check registry).
//
// Historical defaults the RESOLVER now owns (kept here only as a documentation anchor — the live values
// come from policy.mjs's V1_* fallbacks): node kinds {attestor,registry}/{policy,registry} per event
// type; integrity check weights sbom.present=20 / provenance.present=20 / signature.chain=15; default
// assurance weights license.audit{30,15,0} / security.scan{40,20,0} / repro.build{30,15,0}; attestor-
// gated {sbom.present, provenance.present, signature.chain}; scoreable results {pass,warn,fail}.

// Release-INTRINSIC integrity weights — NOT check kinds, so they stay in the scorer (see note above).
const INTRINSIC_INTEGRITY_WEIGHTS = {
  signed: 15,              // signature verified at ledger ingress
  hasArtifacts: 15,        // release has real artifact hashes
  noPolicyViolations: 15,  // clean policy check
};

// Severity/strictness ordering for threshold validation (stricter = lower index)
const THRESHOLD_STRICTNESS = { fail: 0, warn: 1, pass: 2 };

// ANC-B10: attestation note lines are written "kind: result — reason". The separator was historically
// an em-dash (—), but hand-written/ported notes drift to an en-dash (–) or an ASCII hyphen (-). Accept
// all three so a cosmetic dash variation never silently drops a real attestation result.
//
// SCORING-A-001: 'unscored' is a FIRST-CLASS captured result here, IDENTICAL to the URI path (whose
// `(\w+)` capture already accepts 'unscored'). Before this, the note regex captured only
// (pass|warn|fail): a note-line "kind: unscored — reason" failed the full match, fell into the
// near-miss path (console.warn only), and was NEVER recorded as a source. That made the D13b
// sticky/poisoning branch unreachable from the note path — in a {unscored, pass} topology the `pass`
// won and awarded full credit (a latent assurance forge). Capturing 'unscored' here lets a note-form
// 'unscored' participate in resolveConsensus's poisoning logic and zero assurance, byte-identical to
// the URI form. Keep the near-miss detector below as a superset so a genuinely malformed line (bad
// separator / missing reason) still WARNs instead of vanishing.
const ATTESTATION_NOTE_RE = /^([^:]+):\s*(pass|warn|fail|unscored)\s*[—–-]\s*(.+)$/;
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

// Resolve the maintainer + its PEM by keyId. Returns { pem, maintainer } so the caller can apply
// the key-window predicate (the maintainer carries the validFrom/validUntil/revokedAt/... fields),
// or null when no maintainer advertises this keyId / the key is not a usable PEM.
function pemFor(manifest, keyId) {
  const m = (manifest.maintainers || []).find((x) => x.keyId === keyId);
  if (!m || !m.publicKey) return null;
  const pk = String(m.publicKey).trim();
  return pk.includes("BEGIN PUBLIC KEY") ? { pem: pk, maintainer: m } : null;
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
  const hit = pemFor(manifest, keyId);
  if (!hit) return { error: `no maintainer with keyId=${keyId} in ${repoId} node.json` };
  return { pem: hit.pem, maintainer: hit.maintainer, signerNode: repoId };
}

// Resolve the public key for a third-party event from a TRUSTED, correctly-kinded node whose
// maintainer advertises this keyId. FATAL on keyId collision across trusted nodes (ambiguous).
function resolveTrustedKey(nodeManifests, keyId, allowlist, allowedKinds, eventType) {
  const matches = [];
  for (const { id, manifest } of nodeManifests) {
    if (!allowlist.has(id)) continue;
    if (!allowedKinds.has(manifest.kind)) continue;
    const hit = pemFor(manifest, keyId);
    if (hit) matches.push({ id, pem: hit.pem, maintainer: hit.maintainer });
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
  return { pem: matches[0].pem, maintainer: matches[0].maintainer, signerNode: matches[0].id };
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
    // #7: which node KINDS may sign this event type comes from verifier.policy.json (nodeKinds map),
    // resolved once into ctx.nodeKindsForEvent. v1 fallback reproduces the old ATTESTOR/POLICY_KINDS.
    const kinds = ctx.nodeKindsForEvent(event.type);
    resolved = resolveTrustedKey(ctx.nodeManifests, sig.keyId, allowlist, kinds, event.type);
  } else {
    resolved = resolveRepoBoundKey(ctx.nodesDir, event.repo, sig.keyId);
  }
  if (resolved.error) return { ok: false, reason: resolved.error };

  const ok = verifyEd25519(resolved.pem, sig.canonicalHash, sig.value);
  if (!ok) return { ok: false, reason: "signature invalid" };

  // Contract §5.3 — key-lifecycle window gate. AFTER the maintainer is resolved by keyId and BEFORE
  // the key is used, resolve the signature's TRUSTED time (offline anchor ladder over the loaded
  // events) and apply the predicate. A grandfathered key (no window fields) is always valid, so this
  // is byte-identical to today for every existing node.json + event. A compromise-revoked key whose
  // signature is provably anchored at/after its invalidity date (or cannot be proven pre-invalidity)
  // is dropped here — the same null/error path the build already uses for an unresolvable key.
  //
  // Contract §12.1 (Wave-B2) — derive-stricter hardening. The node.json maintainer is the read
  // surface, but a tampered node.json that STRIPS a revoked key's window fields would re-grandfather
  // it. So BEFORE the predicate we derive the window from the SIGNED KeyRotation/KeyRevocation events
  // (authorization gated, §4) and merge in the MOST RESTRICTIVE of node.json + derived. With no key
  // events for this repo the derived map is empty => mergeStricterWindow(maintainer, undefined)
  // returns the maintainer UNCHANGED => grandfather byte-identical to today. A tampered node.json can
  // only ADD restriction, never remove what the signed events assert.
  const tt = resolveTrustedSignatureTimeSync(event, ctx.timeCtx || {});
  const constraint = ctx.deriveConstraintsForRepo
    ? ctx.deriveConstraintsForRepo(event.repo).get(sig.keyId)
    : undefined;
  const eff = mergeStricterWindow(resolved.maintainer, constraint);
  const dec = isKeyValidForSignature(eff, tt);
  if (!dec.valid) {
    return { ok: false, reason: `key window: ${dec.reason} (keyId=${sig.keyId})` };
  }

  return { ok: true, signerNode: resolved.signerNode };
}

// Contract §13.1 — the §4 authorization VALIDITY DECISION now lives ENTIRELY in the shared module's
// order-aware forward pass (deriveKeyWindowConstraints with the NEW opts). build-trust no longer makes
// the authorize/validity call itself; it supplies only the I/O the shared module needs, reusing the
// SAME machinery the rest of build-trust already uses. This deletes the former local
// verifyAndAuthorizeKeyEvent (a latent drift surface — one of the four per-site copies §13.1 removes).
//
//   verifySignature(ev) -> { ok, signerKeyId, signerNodeRepo }
//     ok          : the event's ed25519 signature verifies (canonicalHash recompute + crypto.verify)
//                   against the SIGNER node's advertised public key for sig.keyId.
//     signerKeyId : sig.keyId (the key that signed the event).
//     signerNodeRepo : the repo id of the node that advertises that key — the event's OWN repo when the
//                   signer is a same-node maintainer, ELSE the trustedPolicy node's repo (governance
//                   floor, §4.3). The shared module uses this to classify the signer as same-node
//                   (signerNodeRepo === ev.repo) vs governance (trustedPolicy.has(signerNodeRepo)).
//   The signature is checked against the same-node key first (the common case) and, only if that does
//   not verify, against a trustedPolicy node's key (so a governance recovery signer is honored). Reuses
//   computeCanonicalHash + resolveRepoBoundKey/resolveTrustedKey + verifyEd25519 — no new crypto path.
function verifyKeyEventSignature(ev, ctx) {
  const sig = ev?.signature;
  if (!sig || !sig.canonicalHash || !sig.value || !sig.keyId) {
    return { ok: false, signerKeyId: sig?.keyId ?? null, signerNodeRepo: null };
  }
  if (computeCanonicalHash(ev) !== sig.canonicalHash) {
    return { ok: false, signerKeyId: sig.keyId, signerNodeRepo: null };
  }
  // Same-node first: the signer is a maintainer of the event's OWN repo.
  const sameNode = resolveRepoBoundKey(ctx.nodesDir, ev.repo, sig.keyId);
  if (!sameNode.error && verifyEd25519(sameNode.pem, sig.canonicalHash, sig.value)) {
    return { ok: true, signerKeyId: sig.keyId, signerNodeRepo: ev.repo };
  }
  // Else a trustedPolicy node (governance floor, §4.3). FATAL keyId collisions are swallowed to a
  // non-match here (build-trust already halts on a genuine collision in verifyEventSignature).
  let policyNode;
  try {
    // #7: the governance-floor signer kinds for a key event come from the policy's PolicyViolation
    // node-kinds (the governance event class), resolved via ctx. v1 fallback = old POLICY_KINDS.
    const policyKinds = ctx.nodeKindsForEvent("PolicyViolation");
    policyNode = resolveTrustedKey(ctx.nodeManifests, sig.keyId, ctx.trustedPolicy, policyKinds, ev.type);
  } catch { policyNode = { error: "keyId collision among trusted policy nodes" }; }
  if (!policyNode.error && verifyEd25519(policyNode.pem, sig.canonicalHash, sig.value)) {
    return { ok: true, signerKeyId: sig.keyId, signerNodeRepo: policyNode.signerNode };
  }
  return { ok: false, signerKeyId: sig.keyId, signerNodeRepo: null };
}

// getMaintainer(keyId, nodeRepo) -> maintainer|null — load the maintainer carrying `keyId` from the
// relevant node.json (the signer node the resolver attributed: same-node = ev.repo, or a trustedPolicy
// node's repo). The shared module merges this with the derived-so-far window to decide whether the
// signer is itself VALID at the event's trusted time. Returns the raw maintainer object (with whatever
// window fields node.json carries) or null when the node/keyId is absent.
function getMaintainerFor(keyId, nodeRepo, ctx) {
  if (typeof nodeRepo !== "string" || !REPO_ID_RE.test(nodeRepo)) return null;
  const [org, repo] = nodeRepo.split("/");
  const nodePath = path.join(ctx.nodesDir, org, repo, "node.json");
  if (!fs.existsSync(nodePath)) return null;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(nodePath, "utf8")); }
  catch { return null; }
  return (manifest.maintainers || []).find((m) => m.keyId === keyId) || null;
}

// --- OFFLINE trusted-time ctx (contract §5.2) -------------------------------------------------
//
// build-trust runs OFFLINE over the local ledger, so the trusted clock is the bundled-trusted
// anchor EVENT's timestamp (rung 2). An anchor is an AttestationPublished carrying a `ledger.anchor`
// attestation whose `notes` end in a JSON metadata block with the partition `range` (the lexicographic
// [min,max] of leaf canonicalHashes the partition covers). An event's leaf is its signature.canonicalHash.
//
// This helper builds the `ctx` the SYNC resolver consumes:
//   findEarliestAnchorForLeaf(leaf) -> { anchor } | null   the EARLIEST (by timestamp) covering anchor
//   isBundledTrustedAnchor(anchorEvent) -> boolean         the rung-2 trust gate (§5.2)
//
// Rung-2 trust gate: the anchor event's signer must resolve to a TRUSTED attestor node (the same D18
// bundled-trusted-signer property build-trust already enforces — an anchor only survives signature
// verification if its keyId resolves to a trusted, attestor/registry-kinded node). We pre-verify the
// anchor pool here so a forged/untrusted anchor's timestamp is never used as a trusted clock.

function parseAnchorMeta(ev) {
  if (ev.type !== "AttestationPublished") return null;
  if (!(Array.isArray(ev.attestations) ? ev.attestations : []).some((a) => a.type === "ledger.anchor")) return null;
  // SEAM-PARSE-001: parse the trailing metadata via the canonical parser, then keep this site's own
  // range guard (an anchor with no valid [lo,hi] range is not usable as a clock here).
  const meta = parseAnchorPartitionMeta(ev.notes);
  if (!meta || !Array.isArray(meta.range) || meta.range.length !== 2) return null;
  return meta;
}

// Build the offline trusted-time ctx over the loaded events. `ctx` is the signature-verification ctx
// (it carries nodeManifests + trustedAttestors so we can reuse repo-bound/third-party key resolution
// to confirm an anchor event is itself trusted before we trust its timestamp).
function buildTimeCtx(events, ctx) {
  // Pre-filter to anchor events whose SIGNATURE verifies against a TRUSTED attestor node (rung-2).
  // We reuse resolveRepoBoundKey/resolveTrustedKey + the canonicalHash recompute + crypto.verify so
  // an untrusted or forged anchor never contributes a trusted clock. The set is small (anchors only).
  const trustedAnchors = [];
  for (const ev of events) {
    const meta = parseAnchorMeta(ev);
    if (!meta) continue;
    // The anchor AttestationPublished is third-party-signed: resolve its key from a TRUSTED attestor
    // (ATTESTOR_KINDS) node, then verify the signature end-to-end. Only then is its timestamp trusted.
    const sig = ev.signature;
    if (!sig || !sig.canonicalHash || !sig.value || !sig.keyId) continue;
    if (computeCanonicalHash(ev) !== sig.canonicalHash) continue;
    let resolved;
    try {
      // #7: an anchor is an AttestationPublished — its signer kinds come from the policy's
      // AttestationPublished node-kinds via ctx. v1 fallback = old ATTESTOR_KINDS.
      const attestorKinds = ctx.nodeKindsForEvent("AttestationPublished");
      resolved = resolveTrustedKey(ctx.nodeManifests, sig.keyId, ctx.trustedAttestors, attestorKinds, ev.type);
    } catch { continue; } // keyId collision among trusted nodes — not a trusted clock here.
    if (resolved.error || !verifyEd25519(resolved.pem, sig.canonicalHash, sig.value)) continue;
    trustedAnchors.push({ ev, meta, signerNode: resolved.signerNode });
  }
  const trustedSet = new Set(trustedAnchors.map((a) => a.ev));
  return {
    findEarliestAnchorForLeaf(leaf) {
      if (typeof leaf !== "string") return null;
      let best = null;
      for (const a of trustedAnchors) {
        const [lo, hi] = a.meta.range;
        if (typeof lo !== "string" || typeof hi !== "string") continue;
        if (leaf < lo || leaf > hi) continue; // partition range is the lexicographic leaf interval.
        if (best === null || new Date(a.ev.timestamp) < new Date(best.ev.timestamp)) best = a;
      }
      return best ? { anchor: best.ev } : null;
    },
    // Rung-2 gate: only anchors in the pre-verified trusted pool are a trusted clock.
    isBundledTrustedAnchor(anchorEvent) {
      return trustedSet.has(anchorEvent);
    },
  };
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
// #7: defaultWeights is now the RESOLVED assurance-check default map (assuranceWeights(policy) — v2
// per-check weights, v1 fallback = the historical DEFAULT_ASSURANCE_WEIGHTS). The profile/override merge
// that builds ON TOP of it is unchanged.
function resolveAssuranceWeights(defaultWeights, profileDef, repoOverrides) {
  const weights = {};
  for (const [k, v] of Object.entries(defaultWeights)) weights[k] = { ...v };
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

  // #7 verifier-plugin contract — resolve the check-kinds registry + node-kinds permission map ONCE from
  // verifier.policy.json (v2), each field falling back to the historical hardcoded default (v1). These
  // replace the former module-level ATTESTOR_KINDS / POLICY_KINDS / INTEGRITY_WEIGHTS (check-kind part) /
  // DEFAULT_ASSURANCE_WEIGHTS / ATTESTOR_GATED_INTEGRITY / SCOREABLE_RESULTS constants. With the shipped
  // v2 policy (values mirror the old constants) or any v1 policy, every resolution below is byte-identical
  // to pre-#7, which the regression test pins against the committed trust.json.
  //
  // The full integrity weight table = release-INTRINSIC (hardcoded; signed/hasArtifacts/noPolicyViolations
  // are NOT check kinds) + the resolved CHECK-KIND integrity weights (sbom.present/provenance.present/
  // signature.chain) from the policy.
  const integrityCheckW = integrityCheckWeights(verifierPolicy);
  const INTEGRITY_WEIGHTS = { ...INTRINSIC_INTEGRITY_WEIGHTS, ...integrityCheckW };
  const defaultAssuranceWeights = resolveAssuranceWeightDefaults(verifierPolicy);
  const ATTESTOR_GATED_INTEGRITY = attestorGatedIntegrity(verifierPolicy);
  const SCOREABLE_RESULTS = scoreableResults(verifierPolicy);

  const ctx = {
    nodesDir,
    nodeManifests,
    trustedAttestors: new Set(verifierPolicy?.trustedAttestors || []),
    trustedPolicy: new Set(verifierPolicy?.trustedPolicy || verifierPolicy?.trustedAttestors || []),
    // #7: which node KINDS may sign a given event type, resolved from the policy's nodeKinds map (v1
    // fallback reproduces ATTESTOR_KINDS for AttestationPublished and POLICY_KINDS for PolicyViolation).
    // Memoized per event type so the per-event verification loop does not re-scan the map each call.
    nodeKindsForEvent: (() => {
      const cache = new Map();
      return (eventType) => {
        if (cache.has(eventType)) return cache.get(eventType);
        const s = nodeKindsForEvent(verifierPolicy, eventType);
        cache.set(eventType, s);
        return s;
      };
    })(),
  };
  // Contract §5.2/§5.3 — the OFFLINE trusted-time ctx (anchor-event ladder over the loaded events).
  // Threaded into verifyEventSignature so the key-window predicate has a provable signature time.
  ctx.timeCtx = buildTimeCtx(events, ctx);

  // Contract §13.1 (Wave-B3) — derive-stricter constraints via the shared module's ORDER-AWARE single
  // forward pass, memoized per repo. The shared module replays the repo's KeyRotation/KeyRevocation
  // events in LEDGER (array) order, accumulating a derivedSoFar map; an event is applied iff its
  // signature verifies (verifySignature), its signer is a surviving same-node key OR a trustedPolicy
  // node, AND the signer is itself VALID at the event's trusted time (timeOf) per the SAME
  // derive-stricter predicate against the window state from STRICTLY-EARLIER events. The §4
  // authorization validity decision lives ENTIRELY in the shared module now (DECOMPOSE_BY_SECRETS) —
  // build-trust supplies only the I/O (verifySignature/getMaintainer/timeOf/trustedPolicy) from its
  // existing machinery. Single forward pass => terminates, NO recursion, NO fixpoint loop. This closes
  // residual ③: a stripped node.json can no longer re-authorize a key whose revocation event precedes
  // the rotation it tries to sign. GRANDFATHER stays byte-identical: a repo with NO key events => empty
  // map => mergeStricterWindow(maintainer, undefined) returns the maintainer unchanged.
  const constraintCache = new Map();
  ctx.deriveConstraintsForRepo = (repo) => {
    if (constraintCache.has(repo)) return constraintCache.get(repo);
    const m = deriveKeyWindowConstraints(events, repo, {
      verifySignature: (ev) => verifyKeyEventSignature(ev, ctx),
      getMaintainer: (keyId, nodeRepo) => getMaintainerFor(keyId, nodeRepo, ctx),
      timeOf: (ev) => resolveTrustedSignatureTimeSync(ev, ctx.timeCtx || {}),
      trustedPolicy: ctx.trustedPolicy,
    });
    constraintCache.set(repo, m);
    return m;
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
      const entry = { consensus: resolved.consensus, sources: resolved.sources };
      // #7 REGISTERED ≠ TRUSTED: a check kind that is NOT registered in verifier.policy.json earns ZERO
      // credit by construction (no weight is resolved for it below — integrityCheckWeights/
      // assuranceWeights only emit registered kinds), but it must be recorded LEGIBLY rather than mixed
      // in silently. We flag the source `registered:false` so a consumer sees the attestation EXISTS but
      // earned nothing because its kind is unregistered. We set the flag ONLY when false: a registered
      // kind's entry is byte-identical to pre-#7 (no new field), which the regression gate pins. (The
      // shipped/v1 policies register every kind this ledger uses, so this branch is never taken there.)
      if (!isRegisteredCheck(verifierPolicy, kind)) entry.registered = false;
      releases[key].attestationSources[kind] = entry;
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
    const assuranceWeights = resolveAssuranceWeights(defaultAssuranceWeights, profileDef, repoOverrides);

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
    const checksToScore = expectedAssurance.length > 0 ? expectedAssurance : Object.keys(defaultAssuranceWeights);

    let maxPossible = 0;
    for (const kind of checksToScore) {
      const weights = assuranceWeights[kind] || defaultAssuranceWeights[kind];
      if (!weights) continue;
      maxPossible += weights.pass;
    }
    for (const kind of checksToScore) {
      const weights = assuranceWeights[kind] || defaultAssuranceWeights[kind];
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
      // #7 REGISTERED ≠ TRUSTED: an UNregistered check kind can never be a completed check, even with a
      // `pass` attestation — it earned 0 (no weight) and must not be silently credited. It is reported
      // MISSING (and surfaced as registered:false in attestationSources/assuranceConsensus). A registered
      // check is unchanged, so this is byte-identical for the shipped/v1 policies that register every kind.
      if (att && SCOREABLE_RESULTS.has(att.result) && isRegisteredCheck(verifierPolicy, check)) {
        completedChecks.push(check);
      } else {
        missingChecks.push(check);
      }
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
      // SCORING-A-004: a dispute that caps integrity MUST also revisit assuranceScore. Before this, a
      // disputed release kept whatever assurance it earned, so it could still render a GREEN assurance
      // badge while the integrity badge was capped to the UNVERIFIED band — a disputed release showing
      // green assurance. A standing trusted dispute attacks the release's trustworthiness as a whole;
      // the assurance axis is capped to the SAME ceiling as integrity (DISPUTE_INTEGRITY_CAP = 39),
      // which is strictly below both the green (70) and yellow (40) tiers, so a disputed release can
      // never show green assurance. The assuranceScaling.disputed flag records WHY it was capped.
      if (entry.assuranceScore > DISPUTE_INTEGRITY_CAP) {
        entry.assuranceScaling = {
          ...(entry.assuranceScaling || {}),
          preDisputeAssurance: entry.assuranceScore,
          disputed: true,
        };
        entry.assuranceScore = DISPUTE_INTEGRITY_CAP;
      }
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
    // SCORING-A-003: verdict bands come from the shared INTEGRITY_BANDS (via integrityVerdict) so the
    // producer and both consumers map a score to the SAME band. (Disputed is a louder, distinct state.)
    entry.verdict = entry.disputed ? "DISPUTED" : integrityVerdict(entry.integrityScore);
    const failed = [];     // attestor RAN and said fail (a fail is a completed-but-failing check)
    const unscored = [];   // verifier could not certify (network/unbound) — 0 points, MISSING
    const untrusted = [];  // STGB-TRUST-002: attested, but ONLY by node(s) outside the per-check
                           //   trusted-set — 0 credit (registry is the stricter authority), but the
                           //   cause is "untrusted attestor", NOT a bare "missing".
    const absent = [];     // no attestation at all
    // Categorize EVERY required check (integrity + assurance) by its observed cause. A 'fail' result
    // lives in completedChecks (it ran), so scanning only missingChecks would hide it — we scan the
    // full expected set and look up each one's attestation result.
    const seen = new Set();
    // STGB-TRUST-002: name the node(s) that attested a check but were outside its trusted-set. The
    // node info already lives in attestationSources[check].sources (the resolveConsensus 'untrusted'
    // branch keeps ALL sources). Distinct, de-duplicated, sorted for a stable summary.
    const untrustedNodesFor = (check) => {
      const srcs = entry.attestationSources?.[check]?.sources || [];
      return [...new Set(srcs.map((s) => s.node).filter(Boolean))].sort();
    };
    const noteCause = (check) => {
      if (seen.has(check)) return;
      seen.add(check);
      // noPolicyViolations is a synthetic integrity check: a present violation is a FAILED cause.
      if (check === "noPolicyViolations" && entry.policyViolations.length > 0) { failed.push(check); return; }
      // STGB-TRUST-002: an 'untrusted' consensus is distinct from absent — surface it with the node(s).
      // (Read consensus from attestationSources, not entry.attestations, so a brand-new cause does not
      // depend on how the back-compat attestations[] result token was mapped.)
      if (entry.attestationSources?.[check]?.consensus === "untrusted") {
        const nodes = untrustedNodesFor(check);
        untrusted.push(nodes.length ? `${check} (attested by untrusted node ${nodes.join(", ")})` : check);
        return;
      }
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
    // STGB-TRUST-002: an actionable, distinct cause — the check WAS attested, just not by a node in
    // its trusted-set, so it earns no credit. Naming the node tells the operator to add it to the
    // check's trustedNodes (or get a trusted attestor to re-attest), not to "publish the missing check".
    if (untrusted.length) parts.push(`attested by untrusted node(s): ${untrusted.join(", ")}`);
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
        const c = {
          consensus: data.consensus,
          sourceCount: data.sources.length,
          // STGB-VER-003: KEEP each source's reason string so trust.json explains WHY a check
          // resolved to warn/unscored/fail — a result token alone ("warn") is not legible to a
          // consumer or CI. The reason is the verifier's own one-line cause (e.g. "moderate vuln").
          sources: data.sources.map((s) => ({ node: s.node, result: s.result, reason: s.reason || "" })),
        };
        // #7 REGISTERED ≠ TRUSTED: surface registered:false on an UNregistered kind so trust.json makes
        // it legible that the attestation exists but earned nothing because its kind is not registered in
        // verifier.policy.json. Added ONLY when false — a registered kind's entry is byte-identical to
        // pre-#7 (the regression gate pins this against the committed ledger, all of whose kinds register).
        if (data.registered === false) c.registered = false;
        assuranceConsensus[kind] = c;
      }
      return { ...entry, assuranceConsensus };
    })
    .sort((a, b) => {
      const cmp = a.repo.localeCompare(b.repo);
      if (cmp !== 0) return cmp;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

  if (write) {
    // STGB-TRUST-004: atomic write (same /100 2-space-indent + trailing-newline output as before).
    writeJsonAtomic(path.join(registryDir, "trust.json"), JSON.stringify(output, null, 2) + "\n");
    console.log(`Trust index built: ${output.length} release(s).`);
    for (const entry of output) {
      const iBadge = entry.disputed ? "⛔" : entry.integrityScore >= INTEGRITY_BANDS.VERIFIED ? "✅" : entry.integrityScore >= INTEGRITY_BANDS.PARTIAL ? "⚠️" : "❌";
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
