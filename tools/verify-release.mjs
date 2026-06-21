#!/usr/bin/env node
// verify-release.mjs — Verify a release's trust chain, optionally including XRPL anchor proof.
//
// Usage:
//   node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.4
//   node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.4 --anchored
//   node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.4 --anchored --json
//   node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.4 --anchored-or-local
//
// Checks (post-amend, contract D1/D4/D5):
//   1. ReleasePublished event exists and is signed by a maintainer OF ITS OWN REPO (repo-bound, D1).
//   2. Profile-required attestations are present, signed by a TRUSTED attestor, selected-latest
//      result === pass; AND the release has >=1 INDEPENDENT witness (an attestor whose
//      signerNode !== the release signer, OR a verified/--anchored-or-local-accepted anchor)
//      UNCONDITIONALLY — regardless of profile. With no independent witness the verdict is
//      UNVERIFIED, never PASS (D5). Mirrors packages/repomesh-cli/src/verify/verify-release.mjs.
//   3. --anchored: the partition Merkle root is recomputed (algo-dispatched) and matched to the
//      manifest; when a txHash is present and the network is reachable, the on-chain XRPL tx is
//      fetched and asserted (validated / tesSUCCESS / Account allowlisted / memo binding) (D4).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { merkleRootForAlgo } from "../anchor/xrpl/scripts/merkle.mjs";
import { verifyAnchorTx } from "../anchor/xrpl/scripts/verify-anchor.mjs";
// Key-lifecycle trust predicate + trusted-time resolver (the shared stable secret, contract §5).
// tools/ runs OFFLINE over the local ledger => the SYNC resolver only (no XRPL close-time rung).
// Imported from the repo-root verifiers/lib mirror (byte-identical to the CLI copy).
import {
  isKeyValidForSignature,
  resolveTrustedSignatureTimeSync,
  deriveKeyWindowConstraints,
  mergeStricterWindow,
} from "../verifiers/lib/key-window.mjs";
// SEAM-PARSE-001: the ONE canonical anchor-note metadata parser (replaces this file's old greedy
// trailing-JSON regex in findAnchorForHash). Imported from the repo-root verifiers/lib mirror; the
// published CLI carries its own byte-identical copy (a drift test pins the two).
import { parseAnchorPartitionMeta } from "../verifiers/lib/anchor-notes.mjs";

const ROOT = process.env.REPOMESH_ROOT || path.resolve(import.meta.dirname, "..");
const LEDGER_PATH = process.env.REPOMESH_LEDGER_PATH || path.join(ROOT, "ledger", "events", "events.jsonl");
const NODES_DIR = process.env.REPOMESH_NODES_PATH || path.join(ROOT, "ledger", "nodes");
const PROFILES_DIR = process.env.REPOMESH_PROFILES_PATH || path.join(ROOT, "profiles");
const ANCHOR_CONFIG_PATH = path.join(ROOT, "anchor", "xrpl", "config.json");
// LEDGER-A-005: committed anchor manifests pin partition Merkle roots. They are the only defence that
// can catch a DELETED/reordered signed event (the derive-stricter window logic cannot see what is no
// longer in the ledger). The manifests MUST be resolved relative to the SAME checkout the ledger lives
// in — NOT a global install ROOT — so a verifier pointed at a custom ledger (REPOMESH_LEDGER_PATH) reads
// that ledger's OWN committed manifests. LEDGER_PATH is <checkout>/ledger/events/events.jsonl, so the
// checkout root is three dirs up. Env-overridable (REPOMESH_MANIFESTS_PATH) to match
// ledger/scripts/validate-ledger.mjs.
const LEDGER_CHECKOUT_ROOT = path.resolve(path.dirname(LEDGER_PATH), "..", "..");
const MANIFESTS_DIR = process.env.REPOMESH_MANIFESTS_PATH
  || path.join(LEDGER_CHECKOUT_ROOT, "anchor", "xrpl", "manifests");

// Treat third-party-signed event types per the contract (D1/D2). For these, the signer is NOT the
// event's own repo, so cross-node keyId resolution is correct (and gated by the attestor allowlist
// in the in-repo validator). For everything else (ReleasePublished, etc.) the signer must be the
// event's own repo.
const THIRD_PARTY_TYPES = new Set(["AttestationPublished", "PolicyViolation"]);

// D12 (CRITICAL #1): bundled trusted-attestor allowlist. tools/ has no remote-defaults module, so
// the constant is bundled locally here — byte-identical in MEANING to
// packages/repomesh-cli/src/remote-defaults.mjs BUNDLED_TRUSTED_ATTESTORS. The consumer/verifier
// re-verifies arbitrary ledgers WITHOUT loading verifier.policy.json, so the allowlist that
// validate-ledger.mjs + build-trust.mjs enforce MUST be carried here too. A node NOT in this set —
// even with a valid signature — is NOT a trusted attestor: its attestations are excluded from BOTH
// gate.satisfied AND independentSigners. A fetched verifier.policy.json may NARROW, never WIDEN.
const BUNDLED_TRUSTED_ATTESTORS = Object.freeze([
  "mcp-tool-shop-org/repomesh",                   // genesis attestor (kind: registry)
  "mcp-tool-shop-org/repomesh-license-verifier",  // kind: attestor
  "mcp-tool-shop-org/repomesh-security-verifier", // kind: attestor
  "mcp-tool-shop-org/repomesh-repro-verifier",    // kind: attestor
  "mcp-tool-shop-org/repomesh-xrpl-anchor",       // kind: attestor (signs anchor events)
]);
// Allowed node kinds for attestations — dedicated attestor nodes plus the genesis registry. Mirrors
// validate-ledger.mjs ATTESTOR_KINDS / build-trust.mjs ATTESTOR_KINDS exactly.
const BUNDLED_ATTESTOR_KINDS = new Set(["attestor", "registry"]);

// D12: the EFFECTIVE trusted-attestor allowlist. Bundled set is the non-removable floor; a LOCAL
// verifier.policy.json may NARROW (intersection only), never widen. Mirrors the packages copy's
// effectiveTrustedAttestors(). Absence of policy => bundled set.
function effectiveTrustedAttestors() {
  const bundled = new Set(BUNDLED_TRUSTED_ATTESTORS);
  const policyPath = path.join(ROOT, "verifier.policy.json");
  if (fs.existsSync(policyPath)) {
    try {
      const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
      const fetched = Array.isArray(policy?.trustedAttestors) ? policy.trustedAttestors : null;
      if (fetched) return new Set([...bundled].filter(id => fetched.includes(id)));
    } catch (e) {
      console.error(`Warning: verifier.policy.json read failed (using bundled allowlist): ${e.message}`);
    }
  }
  return bundled;
}

// A resolved third-party signer is trusted iff its node id is in the effective allowlist AND its
// node kind is one of {attestor, registry} (D12).
function isTrustedAttestorNode(key, allowlist) {
  if (!key || !key.nodeId) return false;
  if (!allowlist.has(key.nodeId)) return false;
  if (!BUNDLED_ATTESTOR_KINDS.has(key.kind)) return false;
  return true;
}

// Map profile check names (profiles/*.json requiredChecks) to attestation `type` values.
// Most check names ARE the attestation type already (license.audit, security.scan, sbom.present,
// provenance.present). The ones that aren't are intrinsic to the release event, handled separately.
// D19: keep this set ALIGNED with packages/repomesh-cli NON_ATTESTATION_CHECKS so the reported
// gate.satisfied array matches across the two copies for identical input. `signature.chain` is NOT
// listed here (it stays a required type) — it is satisfied STRUCTURALLY by the valid repo-bound
// release signature in the gate loop below, and therefore reported in gate.satisfied like the
// packages copy does. (Previously it was excluded here, which dropped it from satisfied in tools
// only — the LOW #9 cosmetic divergence.)
const INTRINSIC_CHECKS = new Set(["signed", "hasArtifacts", "noPolicyViolations"]);

function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  }
  return v;
}

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const raw = fs.readFileSync(LEDGER_PATH, "utf8");
  const lines = raw.split("\n").filter(l => l.trim().length > 0);
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]));
    } catch (e) {
      console.error(`Warning: skipping bad JSONL at line ${i + 1} in ${LEDGER_PATH}: ${e.message}`);
    }
  }
  console.error(`Ledger has ${events.length} events`);
  return events;
}

// D1: load + extract a maintainer public key from ONE repo's node.json (mirrors
// validate-ledger.mjs findNodeManifest + extractPublicKey). Returns null on any miss.
// keyCtx (contract §5.3, OPTIONAL): { ev, ctx } for the key-lifecycle window gate. When provided,
// the resolved key is gated at its trusted (offline) signature time AFTER the maintainer is found
// by keyId and BEFORE it is returned. A windowed key out of window => null. Grandfathered keys pass.
function findPublicKeyInRepo(repoId, keyId, keyCtx) {
  const [org, repo] = (repoId || "").split("/");
  if (!org || !repo) return null;
  const nodePath = path.join(NODES_DIR, org, repo, "node.json");
  if (!fs.existsSync(nodePath)) return null;
  let node;
  try {
    node = JSON.parse(fs.readFileSync(nodePath, "utf8"));
  } catch (e) {
    console.error("Invalid JSON in " + nodePath + ": " + e.message);
    return null;
  }
  const m = (node.maintainers || []).find(m => m.keyId === keyId);
  if (m?.publicKey) return gateKeyByWindow({ publicKey: m.publicKey, nodeId: node.id, maintainer: m }, keyCtx);
  return null;
}

// D12: resolve a third-party (attestation / policy) signer's key ONLY from a node in the bundled
// trusted-attestor allowlist (narrowed by a local verifier.policy.json, never widened) and of an
// allowed kind {attestor, registry}. A valid signature from a non-allowlisted / wrong-kind node
// resolves to NO key — its attestation is excluded from the gate AND from independent witnesses.
// Replaces the old promiscuous cross-node scan that accepted ANY registered node.
function findPublicKeyAcrossNodes(keyId, keyCtx) {
  if (!fs.existsSync(NODES_DIR)) return null;
  const allowlist = effectiveTrustedAttestors();
  for (const nodeId of allowlist) {
    const [org, repo] = nodeId.split("/");
    const nodePath = path.join(NODES_DIR, org, repo, "node.json");
    if (!fs.existsSync(nodePath)) continue;
    let node;
    try {
      node = JSON.parse(fs.readFileSync(nodePath, "utf8"));
    } catch (e) {
      console.error("Invalid JSON in " + nodePath + ": " + e.message);
      continue;
    }
    const m = (node.maintainers || []).find(m => m.keyId === keyId);
    if (m?.publicKey) {
      const key = { publicKey: m.publicKey, nodeId: node.id, kind: node.kind, maintainer: m };
      // D12 allowlist/kind gate first, then the key-lifecycle window gate (contract §5.3).
      if (isTrustedAttestorNode(key, allowlist)) return gateKeyByWindow(key, keyCtx);
    }
  }
  return null;
}

// --- Derive-the-stricter-window hardening (contract §12.1) ------------------------------------
// Finding ① (node.json-tamper / grandfather-strip bypass): this site reads window state from
// node.json and (unlike validate-ledger) does NOT run the §8 binding check, so a tampered node.json
// that STRIPS a revoked key's window fields re-grandfathers it (isWindowed=false => VALID). The
// defence: derive the window INDEPENDENTLY from the signed KeyRotation/KeyRevocation events and merge
// the STRICTER of node.json + derived. A tampered node.json can then only ADD restriction, never
// remove what the signed events assert. tools/ is OFFLINE — everything here is sync. This mirrors
// packages/repomesh-cli/src/verify/verify-release.mjs behaviorally (the two copies stay identical).

// Read trustedPolicy node ids from the LOCAL verifier.policy.json at ROOT (the governance floor,
// §4.3). Absence => no governance signer; only Path A (surviving same-node) authorizes.
function readTrustedPolicyNodes() {
  const policyPath = path.join(ROOT, "verifier.policy.json");
  if (!fs.existsSync(policyPath)) return new Set();
  try {
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    const ids = Array.isArray(policy?.trustedPolicy) ? policy.trustedPolicy : [];
    return new Set(ids.filter(id => typeof id === "string"));
  } catch (e) {
    console.error(`Warning: verifier.policy.json read failed (trustedPolicy ignored): ${e.message}`);
    return new Set();
  }
}

// Resolve a maintainer object by keyId from a node.json under NODES_DIR. Returns the maintainer or null.
function findMaintainerInNode(orgRepo, keyId) {
  if (typeof orgRepo !== "string") return null;
  const [org, repo] = orgRepo.split("/");
  if (!org || !repo) return null;
  const nodePath = path.join(NODES_DIR, org, repo, "node.json");
  if (!fs.existsSync(nodePath)) return null;
  let node;
  try { node = JSON.parse(fs.readFileSync(nodePath, "utf8")); } catch { return null; }
  return (node.maintainers || []).find(m => m.keyId === keyId) || null;
}

// Verify a signed key-lifecycle event's signature against a PEM public key (own canonical-hash
// check; mirrors verifySignature's core without re-entering the window gate).
function verifyKeyEventSig(keyEvent, pem) {
  try {
    const ev = JSON.parse(JSON.stringify(keyEvent));
    const sig = ev.signature;
    if (!sig || !sig.canonicalHash || !sig.value) return false;
    delete ev.signature;
    const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
    if (canonHash !== sig.canonicalHash) return false;
    return crypto.verify(null, Buffer.from(canonHash, "hex"), pem, Buffer.from(sig.value, "base64"));
  } catch { return false; }
}

// Resolve the signing PEM for a key-lifecycle event's signer keyId (§13.1 verifySignature I/O):
// same-node (the event's own repo) FIRST, then any trustedPolicy node. Returns { pem, nodeRepo } | null.
function resolveKeyEventSigner(keyEvent, trustedPolicy) {
  const signerKeyId = keyEvent?.signature?.keyId;
  if (typeof signerKeyId !== "string" || !signerKeyId) return null;
  const sameNode = findMaintainerInNode(keyEvent.repo, signerKeyId);
  if (sameNode?.publicKey && String(sameNode.publicKey).includes("BEGIN PUBLIC KEY")) {
    return { pem: String(sameNode.publicKey).trim(), nodeRepo: keyEvent.repo };
  }
  for (const policyNode of trustedPolicy) {
    const m = findMaintainerInNode(policyNode, signerKeyId);
    if (m?.publicKey && String(m.publicKey).includes("BEGIN PUBLIC KEY")) {
      return { pem: String(m.publicKey).trim(), nodeRepo: policyNode };
    }
  }
  return null;
}

// Build the NEW-shape opts for the shared module's ORDER-AWARE deriveKeyWindowConstraints (§13.1).
// The shared module now owns the §4 authorization VALIDITY decision (the order-aware forward pass);
// this site supplies only I/O, each from the site's EXISTING machinery. The local verifyAndAuthorize
// implementation is DELETED (a latent drift surface — the signer-validity ordering decision, residual
// ③, is no longer duplicated here). Behaviorally identical to the packages/repomesh-cli copy.
//   verifySignature(ev) -> { ok, signerKeyId, signerNodeRepo }
//       Reuses the site's canonical-hash + ed25519 verify + signer-key resolution (same-node FIRST,
//       then a trustedPolicy node). A non-resolvable / invalid signer => ok:false (fail-closed).
//   getMaintainer(keyId, nodeRepo) -> maintainer|null   — from the relevant node.json.
//   timeOf(ev) -> trustedTime   — the SYNC offline resolver (no anchor in the authorization pass =>
//       self time; sufficient for the ③ ordering — see the §13.1 note in the packages copy).
//   trustedPolicy: Set<nodeRepo>   — the governance floor from verifier.policy.json.
function makeDeriveOpts(events) {
  const trustedPolicy = readTrustedPolicyNodes();
  return {
    verifySignature: (ev) => {
      const signerKeyId = ev?.signature?.keyId ?? null;
      const signer = resolveKeyEventSigner(ev, trustedPolicy);
      if (!signer) return { ok: false, signerKeyId, signerNodeRepo: null };
      const ok = verifyKeyEventSig(ev, signer.pem);
      return { ok, signerKeyId, signerNodeRepo: ok ? signer.nodeRepo : null };
    },
    getMaintainer: (keyId, nodeRepo) => findMaintainerInNode(nodeRepo, keyId),
    timeOf: (ev) => resolveTrustedSignatureTimeSync(ev, {
      findEarliestAnchorForLeaf: () => null, isBundledTrustedAnchor: () => false,
    }),
    trustedPolicy,
  };
}

// --- Key-lifecycle trust gate (contract §5.3, OFFLINE/SYNC) -----------------------------------
// Apply the key-lifecycle predicate to a resolved key candidate. Returns the SAME key on valid, or
// null (the site's existing "no key" shape) on invalid. A window-less (grandfathered) maintainer
// always passes => byte-identical to today. `keyCtx` = { ev, ctx, events } carries the event + the
// SYNC resolver ctx + the loaded ledger. Without keyCtx (no events threaded), grandfather-only.
//
// §12.1 derive-stricter: BEFORE the predicate, the resolved maintainer's window is merged with the
// constraint derived from the signed ledger events — the MOST RESTRICTIVE of node.json + signed
// events. A tampered (stripped) node.json can only ADD restriction. GRANDFATHER stays byte-identical:
// no key events for key.nodeId => undefined constraint => mergeStricterWindow returns maintainer ===.
function gateKeyByWindow(key, keyCtx) {
  if (!key) return key;
  const maintainer = key.maintainer;
  if (!maintainer || !keyCtx) return key;
  const { ev, ctx, events } = keyCtx;
  let eff = maintainer;
  if (Array.isArray(events) && events.length) {
    // §13.1: the shared module runs the ORDER-AWARE forward pass + consolidated §4 authorization; we
    // supply only I/O via the NEW opts shape (verifySignature/getMaintainer/timeOf/trustedPolicy).
    const constraint = deriveKeyWindowConstraints(events, key.nodeId, makeDeriveOpts(events)).get(maintainer.keyId);
    eff = mergeStricterWindow(maintainer, constraint);
  }
  const tt = resolveTrustedSignatureTimeSync(ev, ctx);
  const dec = isKeyValidForSignature(eff, tt);
  if (!dec.valid) return null; // existing "no key" shape; the caller surfaces its no-key reason
  return key;
}

// Build the SYNC resolver ctx for the event being verified (contract §5.2). tools/ is offline-only,
// so the ctx exposes findEarliestAnchorForLeaf + isBundledTrustedAnchor (both sync) and NO
// anchorCloseTime (no rung-1). The anchor lookup + the rung-2 trust check use the local ledger.
function buildKeyWindowCtxSync(ev, events) {
  const leaf = ev?.signature?.canonicalHash;
  let anchorEvent = null;
  if (typeof leaf === "string" && /^[0-9a-fA-F]{64}$/.test(leaf) && Array.isArray(events)) {
    const found = findAnchorForHash(events, leaf);
    anchorEvent = found?.anchor || null;
  }
  // Rung-2 trust gate (§5.2): the anchor EVENT must be signed by a bundled trusted attestor/anchor
  // node, else its timestamp is not a trusted clock. verifySignature is sync here; the recursion
  // guard (no events threaded into the inner call) keeps it bounded.
  let anchorTrusted = false;
  if (anchorEvent) {
    const anchorSig = verifySignature(anchorEvent);
    anchorTrusted = anchorSig.ok && BUNDLED_TRUSTED_ATTESTORS.includes(anchorSig.nodeId);
  }
  return {
    findEarliestAnchorForLeaf: (l) => (anchorEvent && l === leaf ? { anchor: anchorEvent } : null),
    isBundledTrustedAnchor: () => anchorTrusted,
  };
}

// Verify a single event's signature.
//  - For ReleasePublished (and any non-third-party type): resolve the key ONLY from ev.repo's
//    node.json and assert the resolved node id === ev.repo (D1, repo-bound signer).
//  - For AttestationPublished / PolicyViolation: resolve the key across nodes (third-party signer).
//
// `events` (OPTIONAL): when the loaded ledger is threaded, the resolved key is gated at its trusted
// (offline) signature time via the key-lifecycle window predicate (contract §5.3). Without it, the
// gate degrades to grandfather-only — byte-identical to today (used for the inner anchor-trust
// check to avoid unbounded recursion).
function verifySignature(event, events) {
  const ev = JSON.parse(JSON.stringify(event));
  const sig = ev.signature;
  if (!sig || !sig.keyId) return { ok: false, reason: "event missing signature or keyId" };
  delete ev.signature;
  const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  if (canonHash !== sig.canonicalHash) return { ok: false, reason: "canonical hash mismatch" };

  // Build the key-lifecycle window gate ctx (contract §5.3) when ledger events are threaded. §12.1:
  // also carry `events` so gateKeyByWindow can derive the stricter window from the signed
  // KeyRotation/KeyRevocation events (independent of a possibly-tampered node.json).
  const keyCtx = events ? { ev: event, ctx: buildKeyWindowCtxSync(event, events), events } : null;

  let key;
  if (THIRD_PARTY_TYPES.has(event.type)) {
    key = findPublicKeyAcrossNodes(sig.keyId, keyCtx);
    if (!key) return { ok: false, reason: `no public key for keyId=${sig.keyId} in any registered node` };
  } else {
    // Repo-bound: the key MUST belong to a maintainer of the event's own repo.
    key = findPublicKeyInRepo(event.repo, sig.keyId, keyCtx);
    if (!key) {
      return {
        ok: false,
        reason: `no maintainer with keyId=${sig.keyId} registered for repo ${event.repo} ` +
                `(a release must be signed by a key registered to its OWN repo)`,
      };
    }
  }

  try {
    const ok = crypto.verify(null, Buffer.from(canonHash, "hex"), key.publicKey, Buffer.from(sig.value, "base64"));
    if (!ok) return { ok: false, reason: "signature invalid" };
    // D1: bind the verified signer node to the event's repo for non-third-party events.
    if (!THIRD_PARTY_TYPES.has(event.type) && key.nodeId !== event.repo) {
      return { ok: false, reason: `signer node ${key.nodeId} does not match event repo ${event.repo}` };
    }
    return { ok: true, nodeId: key.nodeId };
  } catch (e) {
    return { ok: false, reason: `verify error: ${e.message}` };
  }
}

function findAnchorForHash(events, canonicalHash) {
  const anchors = events.filter(ev =>
    ev.type === "AttestationPublished" &&
    (ev.attestations || []).some(a => a.type === "ledger.anchor")
  );

  for (const anchor of anchors) {
    try {
      // SEAM-PARSE-001: canonical parse (fail-closed → skip). This site needs manifestPath.
      const meta = parseAnchorPartitionMeta(anchor.notes);
      if (!meta || !meta.manifestPath) continue;

      // Validate manifestPath against path traversal using resolve + startsWith.
      const manifestFullPath = path.resolve(ROOT, meta.manifestPath);
      if (!manifestFullPath.startsWith(path.resolve(ROOT) + path.sep)) continue;
      if (!fs.existsSync(manifestFullPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestFullPath, "utf8"));
      } catch (e) {
        console.error("Invalid JSON in " + manifestFullPath + ": " + e.message);
        continue;
      }

      const leaves = resolveLeavesForManifest(events, manifest);
      if (leaves && leaves.includes(canonicalHash)) {
        return { anchor, manifest, meta, leaves };
      }
    } catch {}
  }
  return null;
}

// Resolve the exact ordered leaf list a manifest pins. Prefer the manifest's own
// `range` + `count` to slice a contiguous window (drift-proof — mirrors
// ledger/scripts/validate-ledger.mjs verifyAnchorManifests, which slices
// hashes.slice(start, start+count) rather than re-filtering by date/partition).
// Falls back to the partition-id resolver only for legacy manifests with no range.
function resolveLeavesForManifest(events, manifest) {
  const hashes = events
    .map(ev => ev.signature?.canonicalHash)
    .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));

  if (Array.isArray(manifest.range) && manifest.range.length === 2 && Number.isInteger(manifest.count)) {
    const start = hashes.indexOf(manifest.range[0]);
    if (start === -1) return null; // pinned start no longer present → not anchored here
    const slice = hashes.slice(start, start + manifest.count);
    if (slice.length !== manifest.count) return null; // partition truncated
    if (slice[slice.length - 1] !== manifest.range[1]) return null; // reordered/replaced
    return slice;
  }

  // Legacy fallback: resolve by partition id.
  return getPartitionEvents(events, manifest.partitionId)
    .map(ev => ev.signature?.canonicalHash)
    .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));
}

function getPartitionEvents(events, partitionId) {
  if (partitionId === "all" || partitionId === "genesis") return events;
  if (partitionId.startsWith("since:")) {
    const sinceTs = partitionId.slice(6);
    const idx = events.findIndex(ev =>
      ev.type === "AttestationPublished" &&
      ev.timestamp === sinceTs &&
      (ev.attestations || []).some(a => a.type === "ledger.anchor")
    );
    return idx >= 0 ? events.slice(idx + 1) : events;
  }
  return events.filter(ev => ev.timestamp?.startsWith(partitionId));
}

// D5: resolve the repo's trust profile. Reads the profile pointer from the repo's node dir if
// present (repomesh.profile.json), else falls back to the baseline profile. Missing profile dir
// means "no profile" → baseline (require nothing) so the gate degrades gracefully but honestly.
function loadProfileForRepo(repoId) {
  const [org, repo] = (repoId || "").split("/");
  let profileId = "baseline";
  if (org && repo) {
    const pointer = path.join(NODES_DIR, org, repo, "repomesh.profile.json");
    if (fs.existsSync(pointer)) {
      try {
        const p = JSON.parse(fs.readFileSync(pointer, "utf8"));
        if (p.profileId) profileId = p.profileId;
      } catch (e) {
        console.error(`Warning: failed to parse profile pointer for ${repoId}: ${e.message}`);
      }
    }
  }
  const profilePath = path.join(PROFILES_DIR, `${profileId}.json`);
  if (!fs.existsSync(profilePath)) {
    return { profileId, requiredAttestationTypes: [] };
  }
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch (e) {
    console.error(`Warning: failed to parse profile ${profileId}: ${e.message}`);
    return { profileId, requiredAttestationTypes: [] };
  }
  const rc = profile.requiredChecks || {};
  const allChecks = [...(rc.integrity || []), ...(rc.assurance || [])];
  // Only attestation-backed checks gate here; intrinsic checks (signed/hasArtifacts/...) are
  // satisfied by the release event itself and verified above.
  const requiredAttestationTypes = [...new Set(allChecks.filter(c => !INTRINSIC_CHECKS.has(c)))];
  return { profileId, requiredAttestationTypes };
}

// --- LEDGER-A-005: local-ledger immutability via committed anchor manifests -------------------
// The exploit: drop a signed KeyRevocation event (+ strip node.json window fields) from a LOCAL
// checkout's ledger so a compromise-revoked key looks live, then verify a post-revocation release.
// The derive-stricter window defence CANNOT see a DELETED event. The committed anchor manifests
// (anchor/xrpl/manifests/*.json) pin each partition's Merkle root, so dropping/reordering ANY
// anchored event makes the recomputed root diverge — and that is unforgeable without the partition
// being re-anchored on-chain. This recomputes every committed manifest's root over the LOADED
// ledger and FAILS on the first mismatch/truncation/reorder. Byte-identical in behaviour to
// ledger/scripts/validate-ledger.mjs verifyAnchorManifests (v1+v2 aware) and to the published CLI
// copy. Returns { ok:true } or { ok:false, file, reason, category } — see the published copy for the
// category contract:
//   - "ledger-tamper" (start-not-found / slice-truncated / partition-end-moved): the LEDGER-A-005
//     exploit class; ALWAYS a hard early FAIL.
//   - "manifest-issue" (forged manifest root or unsupported algo, ledger slice intact): DEFERRED to the
//     per-release anchor path when that path will run (--anchored / --anchored-or-local), so its richer
//     verdict shape is preserved; otherwise still a hard FAIL.
// Absence of manifests => ok:true (nothing pinned to check).
function checkLedgerImmutability(events) {
  let manifestFiles;
  try {
    if (!fs.existsSync(MANIFESTS_DIR)) return { ok: true };
    manifestFiles = fs.readdirSync(MANIFESTS_DIR).filter(f => f.endsWith(".json"));
  } catch (e) {
    return { ok: true }; // no readable manifests dir => nothing pinned (matches validate-ledger warn)
  }
  if (manifestFiles.length === 0) return { ok: true };

  const hashes = events.map(e => e?.signature?.canonicalHash);
  for (const file of manifestFiles) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(MANIFESTS_DIR, file), "utf8"));
    } catch (e) {
      // A committed manifest that cannot be parsed is itself a corruption => fail closed.
      return { ok: false, file, category: "manifest-issue",
        reason: `anchor manifest ${file} is unreadable/corrupt: ${e.message}` };
    }
    // An absent algo means a legacy v1 manifest (matches validate-ledger.mjs); unknown algo fails
    // closed in merkleRootForAlgo below.
    const algo = manifest.algo || "sha256-merkle-v1";
    const { range, count, root } = manifest;
    if (!Array.isArray(range) || range.length !== 2 || typeof root !== "string" || !Number.isInteger(count)) {
      return { ok: false, file, category: "manifest-issue",
        reason: `anchor manifest ${file} is malformed (range/count/root missing)` };
    }
    const start = hashes.indexOf(range[0]);
    if (start === -1) {
      return { ok: false, file, category: "ledger-tamper", reason:
        `immutability violation: anchor manifest ${file} pins a partition starting at ${range[0]} ` +
        `which is no longer present in the ledger (an anchored event was removed)` };
    }
    const slice = hashes.slice(start, start + count);
    if (slice.length !== count || slice.some(h => !h)) {
      return { ok: false, file, category: "ledger-tamper", reason:
        `immutability violation: anchor manifest ${file} partition (count=${count}) is truncated` };
    }
    if (slice[slice.length - 1] !== range[1]) {
      return { ok: false, file, category: "ledger-tamper", reason:
        `immutability violation: anchor manifest ${file} partition end ${range[1]} does not match ` +
        `the ledger (events were reordered or replaced)` };
    }
    let computed;
    try {
      computed = merkleRootForAlgo(slice, algo);
    } catch (e) {
      // The ledger slice is intact; an unverifiable/future algo is a manifest-level issue.
      return { ok: false, file, category: "manifest-issue",
        reason: `anchor manifest ${file} has an unverifiable algo: ${e.message}` };
    }
    if (computed !== root) {
      return { ok: false, file, category: "manifest-issue", reason:
        `immutability violation: anchor manifest ${file} Merkle root mismatch ` +
        `(manifest.root=${root} recomputed=${computed}) — the manifest does not match the ledger slice ` +
        `(forged manifest root, or an anchored event was modified)` };
    }
  }
  return { ok: true };
}

export async function verifyRelease({ repo, version, anchored, anchoredOrLocal, json }) {
  const events = readEvents();
  if (events.length === 0) {
    const exists = fs.existsSync(LEDGER_PATH);
    const reason = exists ? "Ledger file exists but contains no valid events (possibly corrupt)." : "Ledger file not found at " + LEDGER_PATH;
    if (json) { console.log(JSON.stringify({ ok: false, error: reason })); }
    else { console.error(reason); }
    process.exit(1);
  }

  const result = {
    ok: true,
    repo,
    version,
    release: null,
    attestations: [],
    gate: null,
    anchor: null,
  };

  if (!json) {
    console.log(`\nVerifying release: ${repo}@${version}`);
    console.log(`  Anchored check: ${anchored ? "yes" : "no"}\n`);
  }

  // LEDGER-A-005: BEFORE any trust logic, assert the LOCAL ledger has not been truncated/reordered
  // relative to the committed anchor manifests. Runs independent of --anchored because the exploit
  // accepts a post-revocation release WITHOUT --anchored — the derive-stricter window defence cannot
  // see a DELETED KeyRevocation event, but a dropped/reordered anchored event breaks the pinned Merkle
  // root. tools/ is always local + offline. Composition mirrors the published copy: a "ledger-tamper"
  // category always hard-fails early; a "manifest-issue" (forged manifest root / unsupported algo, with
  // the ledger slice intact) is deferred to the per-release anchor path when --anchored / --anchored-or-
  // local will run, so its established verdict shape is preserved (no double-fail / no preemption).
  const immutability = checkLedgerImmutability(events);
  const deferToAnchorPath = immutability.category === "manifest-issue" && (anchored || anchoredOrLocal);
  if (!immutability.ok && !deferToAnchorPath) {
    result.ok = false;
    result.gate = { verdict: "FAIL", failed: ["ledger.immutability"], reason: immutability.reason };
    result.anchor = { immutabilityValid: false, manifest: immutability.file, reason: immutability.reason };
    if (json) { console.log(JSON.stringify(result, null, 2)); }
    else { console.error(`  Ledger immutability: FAIL — ${immutability.reason}`); }
    process.exit(1);
  }

  // 1. Find ReleasePublished event
  const release = events.find(ev =>
    ev.type === "ReleasePublished" && ev.repo === repo && ev.version === version
  );
  if (!release) {
    if (json) { console.log(JSON.stringify({ ok: false, error: `ReleasePublished event not found for ${repo}@${version}` })); }
    else { console.error(`  ReleasePublished event not found for ${repo}@${version}`); }
    process.exit(1);
  }

  result.release = {
    timestamp: release.timestamp,
    commit: release.commit,
    artifacts: (release.artifacts || []).length,
    canonicalHash: release.signature?.canonicalHash,
  };

  // 2. Verify signature (repo-bound, D1). Thread `events` so the key-lifecycle window gate
  // (contract §5.3) rejects a windowed (rotated / revoked / compromised) signing key at its
  // trusted (offline) signature time. tools/ is offline => the SYNC resolver ladder.
  const sigResult = verifySignature(release, events);
  result.release.signatureValid = sigResult.ok;
  result.release.signerNode = sigResult.ok ? sigResult.nodeId : null;
  result.release.keyId = release.signature?.keyId;

  if (!sigResult.ok) {
    result.ok = false;
    result.release.signatureReason = sigResult.reason;
    if (json) { console.log(JSON.stringify(result)); }
    else { console.error(`    Signature: FAILED (${sigResult.reason})`); }
    process.exit(1);
  }

  if (!json) {
    console.log(`  Release event found: ${release.timestamp}`);
    console.log(`    Commit:    ${release.commit}`);
    console.log(`    Artifacts: ${(release.artifacts || []).length}`);
    console.log(`    Signature: VALID (keyId=${release.signature.keyId}, node=${sigResult.nodeId})`);
  }

  // 3. Find + verify attestations, then run the profile-driven gate (D5).
  const attestationEvents = events.filter(ev =>
    ev.type === "AttestationPublished" && ev.repo === repo && ev.version === version
  );

  // Index every (type, signerNode) → list of {result, signatureValid, timestamp}. Verify each
  // attestation's signature (third-party path). Select LATEST by timestamp per (type, signerNode)
  // (fixes first-match masking, CLI-003).
  const byTypeSigner = new Map(); // key: `${type}|${signerNode}` -> selected record
  const attestTypes = new Set();
  // Track the set of INDEPENDENT signers (valid signature, node !== release signer).
  // Mirrors the published packages copy: independence is decided over verified
  // attestation signers, not just the presence of attestation records.
  const independentSigners = new Set();
  for (const att of attestationEvents) {
    // Key-lifecycle window gate also applies to attestation signers (contract §5.3).
    const sigOk = verifySignature(att, events);
    const signerNode = sigOk.ok ? sigOk.nodeId : null;
    if (sigOk.ok && signerNode && signerNode !== result.release.signerNode) {
      independentSigners.add(signerNode);
    }
    const noteMatch = att.notes?.match(/^([^:]+):\s*(pass|warn|fail)/);
    const attResult = noteMatch ? noteMatch[2] : "unknown";
    for (const a of (att.attestations || [])) {
      if (a.type === "ledger.anchor") continue; // anchor handled separately
      attestTypes.add(a.type);
      const key = `${a.type}|${signerNode}`;
      const prev = byTypeSigner.get(key);
      const rec = {
        type: a.type,
        result: attResult,
        signatureValid: sigOk.ok,
        signerNode,
        timestamp: att.timestamp || "",
      };
      if (!prev || String(rec.timestamp) >= String(prev.timestamp)) {
        byTypeSigner.set(key, rec);
      }
    }
  }

  const selected = [...byTypeSigner.values()];
  result.attestations = selected;

  if (!json) {
    console.log(`\n  Attestations (${attestTypes.size}):`);
    for (const rec of selected) {
      const signer = rec.signatureValid ? ` (${rec.signerNode})` : "";
      console.log(`    ${rec.signatureValid ? "VALID" : "FAIL"}  ${rec.type}: ${rec.result}${signer}`);
    }
  }

  // The gate, driven by the repo's profile.
  const { profileId, requiredAttestationTypes } = loadProfileForRepo(repo);
  const gate = {
    profile: profileId,
    requiredAttestationTypes,
    satisfied: [],
    missing: [],
    failed: [],
    independentAttestor: false,
    verdict: "PASS",
  };

  // Does any selected attestation come from an independent attestor (valid sig,
  // signerNode !== release signer)? Computed over verified attestation signers.
  const hasIndependentAttestor = independentSigners.size > 0;
  gate.independentAttestor = hasIndependentAttestor;

  for (const type of requiredAttestationTypes) {
    // `signature.chain` is satisfied STRUCTURALLY by a valid release signature that
    // chains to a key registered under the release's OWN repo (D1) — the release's
    // own signature IS the signature chain. It does not require a separate attestation
    // event. (An explicit signature.chain attestation, if one exists, is honored below.)
    if (type === "signature.chain" && result.release.signatureValid &&
        !selected.some(r => r.type === type)) {
      gate.satisfied.push(type);
      continue;
    }
    // Candidate selected attestations of this type with a valid signature.
    const candidates = selected.filter(r => r.type === type && r.signatureValid);
    if (candidates.length === 0) {
      gate.missing.push(type);
      continue;
    }
    // Any selected result === fail → hard fail. Otherwise require at least one pass.
    if (candidates.some(c => c.result === "fail")) {
      gate.failed.push(type);
    } else if (candidates.some(c => c.result === "pass")) {
      gate.satisfied.push(type);
    } else {
      // Only warn/unknown present — not satisfied.
      gate.missing.push(type);
    }
  }

  // ATT-A-001: also surface ANY selected attestation (even a NON-required type) that is a hard fail
  // — a validly-signed trusted-attestor attestation with result "fail". Mirrors the published copy's
  // post-required-gate loop (which pushes a gate.failures entry); here we use this copy's local
  // gate.failed shape so the BEHAVIOR is identical: a baseline-profile release carrying a
  // trusted-attestor security.scan:fail can no longer return PASS from tools/ while the published
  // CLI returns FAIL. De-dup against gate.failed so a required type already hard-failed above is not
  // listed twice.
  for (const a of selected) {
    if (a.signatureValid && a.result === "fail" && !gate.failed.includes(a.type)) {
      gate.failed.push(a.type);
    }
  }

  // Hard failures are FAIL regardless of independence. The independence/PASS decision
  // is FINALIZED AFTER the anchor step (below) so a self-signed release + a verified
  // (or --anchored-or-local accepted) anchor can legitimately PASS — exactly like the
  // published packages copy. A self-signed release with no independent witness and no
  // anchor is reported UNVERIFIED, never PASS — UNCONDITIONALLY (profile-independent).
  if (gate.failed.length > 0 || gate.missing.length > 0) {
    gate.verdict = "FAIL";
    result.ok = false;
  } else {
    // Provisional: pending the independence/anchor finalization below.
    gate.verdict = "PENDING";
  }

  result.gate = gate;

  if (!json) {
    console.log(`\n  Attestation gate (profile: ${profileId}):`);
    if (requiredAttestationTypes.length === 0) {
      console.log(`    No attestation checks required by this profile.`);
    } else {
      console.log(`    Required:    ${requiredAttestationTypes.join(", ")}`);
      console.log(`    Satisfied:   ${gate.satisfied.join(", ") || "(none)"}`);
      if (gate.missing.length) console.log(`    MISSING:     ${gate.missing.join(", ")}`);
      if (gate.failed.length) console.log(`    FAILED:      ${gate.failed.join(", ")}`);
    }
    console.log(`    Independent attestor: ${gate.independentAttestor ? "yes" : "NO"}`);
    console.log(`    Gate verdict: ${gate.verdict === "PENDING" ? "(pending independence/anchor)" : gate.verdict}`);
  }

  // If the gate already failed, surface it before anchor work (fail-closed).
  if (!result.ok && gate.verdict === "FAIL") {
    if (json) { console.log(JSON.stringify(result, null, 2)); }
    else { console.error(`\n  Verification: FAIL (attestation gate)\n`); }
    process.exit(1);
  }

  // 4. Anchor verification (if --anchored / --anchored-or-local)
  // D18: tracks whether the anchor EVENT carried a valid signature from a bundled trusted
  // attestor/anchor node. The --anchored-or-local witness path requires this so a forged
  // (non-trusted-signer) anchor cannot flip UNVERIFIED->PASS. Mirrors the packages copy.
  let anchorSignerTrusted = false;
  const wantAnchor = anchored || anchoredOrLocal;
  if (wantAnchor) {
    const releaseHash = release.signature.canonicalHash;

    if (!json) {
      console.log(`\n  Anchor verification:`);
      console.log(`    Release canonicalHash: ${releaseHash}`);
    }

    const anchorResult = findAnchorForHash(events, releaseHash);
    if (!anchorResult) {
      // D4 #1: --anchored + no anchor found → FAIL (no silent PASS).
      result.anchor = { anchored: false };
      result.ok = false;
      if (json) { console.log(JSON.stringify(result, null, 2)); }
      else {
        console.error(`    Not anchored (no anchor partition contains this release).`);
        console.error(`    --anchored was requested but the release is not anchored — FAIL.`);
      }
      process.exit(1);
    }

    const { anchor: anchorEvent, manifest, meta, leaves } = anchorResult;

    // D18: the anchor EVENT itself (an AttestationPublished signed by the xrpl-anchor node) must
    // carry a valid signature from a node in the bundled trusted attestor/anchor set. verifySignature
    // runs the third-party path, which already enforces the D12 allowlist + kind — so an unsigned or
    // locally-forged anchor (signed by a non-allowlisted key) resolves to no key and is NOT trusted.
    // NOTE: no `events` threaded — the anchor signer's trust is the D18 concern, not the key-window
    // gate (the gate's own ctx separately trust-checks the anchor); this also bounds the recursion.
    const anchorSig = verifySignature(anchorEvent);
    anchorSignerTrusted = anchorSig.ok && BUNDLED_TRUSTED_ATTESTORS.includes(anchorSig.nodeId);

    // Verify the manifestHash binds to the manifest body.
    const { manifestHash: mh, ...base } = manifest;
    const recomputedMh = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
    if (recomputedMh !== mh) {
      result.ok = false;
      result.anchor = { anchored: true, manifestValid: false, expected: recomputedMh, got: mh };
      if (json) { console.log(JSON.stringify(result, null, 2)); }
      else { console.error(`    ManifestHash: MISMATCH (expected ${recomputedMh})`); }
      process.exit(1);
    }

    // D4 #2: recompute the partition Merkle root (algo-dispatched) and assert === manifest.root.
    const algo = manifest.algo || "sha256-merkle-v1";
    let recomputedRoot;
    try {
      recomputedRoot = merkleRootForAlgo(leaves, algo);
    } catch (e) {
      result.ok = false;
      result.anchor = { anchored: true, manifestValid: true, rootValid: false, reason: e.message };
      if (json) { console.log(JSON.stringify(result, null, 2)); }
      else { console.error(`    Root recompute failed: ${e.message}`); }
      process.exit(1);
    }
    if (recomputedRoot !== manifest.root) {
      result.ok = false;
      result.anchor = {
        anchored: true, manifestValid: true, rootValid: false,
        expectedRoot: recomputedRoot, manifestRoot: manifest.root, algo,
      };
      if (json) { console.log(JSON.stringify(result, null, 2)); }
      else { console.error(`    Merkle root MISMATCH (recomputed ${recomputedRoot} != manifest ${manifest.root})`); }
      process.exit(1);
    }

    // Anchor base assertions passed: local manifest + root are internally consistent.
    result.anchor = {
      anchored: true,
      manifestValid: true,
      rootValid: true,
      partition: manifest.partitionId,
      root: manifest.root,
      manifestHash: manifest.manifestHash,
      manifestPath: meta.manifestPath,
      algo,
      txHash: null,        // only surfaced after on-chain verification
      network: meta.network || null,
      xrplVerified: false,
      signerTrusted: anchorSignerTrusted, // D18: anchor event signed by a bundled trusted node
      ...(anchorSig.ok ? { signerNode: anchorSig.nodeId } : {}),
    };

    // D4 #3 + #4: on-chain XRPL verification when a txHash is present.
    // Offline is forced by either env name — REPOMESH_FORCE_OFFLINE (the standardized name,
    // matching packages/repomesh-cli) or the legacy REPOMESH_OFFLINE — so both CLI copies honor
    // the same operator signal regardless of which one is set.
    const offline = process.env.REPOMESH_FORCE_OFFLINE === "1" || process.env.REPOMESH_OFFLINE === "1";
    if (meta.txHash) {
      let config = {};
      try { config = JSON.parse(fs.readFileSync(ANCHOR_CONFIG_PATH, "utf8")); } catch { /* use bundled fallback in verifyAnchorTx via empty list */ }
      const trustedAnchorAccounts = Array.isArray(config.trustedAnchorAccounts)
        ? config.trustedAnchorAccounts
        : ["rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W"];
      const wsUrl = process.env.XRPL_WS_URL || config.rippledUrl;

      let onchain = null;
      if (!offline && wsUrl) {
        try {
          onchain = await fetchAndVerifyAnchorTx({
            txHash: meta.txHash,
            wsUrl,
            localRoot: recomputedRoot,
            localManifestHash: mh,
            leafCount: leaves.length,
            trustedAnchorAccounts,
          });
        } catch (e) {
          onchain = { ok: false, reason: `XRPL fetch failed: ${e.message}`, networkError: true };
        }
      }

      if (onchain && onchain.ok) {
        result.anchor.xrplVerified = true;
        result.anchor.txHash = meta.txHash;
        if (!json) {
          console.log(`    XRPL tx:      ${meta.txHash} (VERIFIED on-chain)`);
          console.log(`    Partition:    ${manifest.partitionId}`);
          console.log(`    Root:         ${manifest.root}`);
          console.log(`    ManifestHash: VERIFIED`);
          console.log(`    Release INCLUDED in XRPL-anchored partition`);
        }
      } else if (onchain && !onchain.networkError) {
        // Reached XRPL, but the on-chain assertions failed → hard FAIL.
        result.ok = false;
        result.anchor.xrplVerified = false;
        result.anchor.txReason = onchain.reason;
        if (json) { console.log(JSON.stringify(result, null, 2)); }
        else { console.error(`    XRPL verification FAILED: ${onchain.reason}`); }
        process.exit(1);
      } else {
        // Offline or network unreachable: do NOT print a fake "tx=" line. The local manifest +
        // root are verified, but the on-chain anchor is NOT. Strict --anchored fails; the explicit
        // --anchored-or-local opt-in downgrades to a local-manifest-only PASS.
        result.anchor.xrplVerified = false;
        result.anchor.anchored = "local-manifest-only";
        if (!json) {
          console.log(`    Partition:    ${manifest.partitionId}`);
          console.log(`    Root:         ${manifest.root} (local recompute MATCH)`);
          console.log(`    ManifestHash: VERIFIED (local)`);
          console.log(`    XRPL NOT verified — network unavailable; on-chain tx ${meta.txHash} was not fetched.`);
        }
        if (anchored && !anchoredOrLocal) {
          result.ok = false;
          if (json) { console.log(JSON.stringify(result, null, 2)); }
          else { console.error(`\n  Verification: FAIL — strict --anchored requires on-chain XRPL proof (XRPL NOT verified offline). Use --anchored-or-local to accept local-manifest-only.\n`); }
          process.exit(1);
        }
      }
    } else {
      // No txHash recorded — the partition is anchored locally only (no on-chain claim).
      if (!json) {
        console.log(`    Partition:    ${manifest.partitionId}`);
        console.log(`    Root:         ${manifest.root} (local recompute MATCH)`);
        console.log(`    ManifestHash: VERIFIED (local)`);
        console.log(`    XRPL NOT verified — no on-chain txHash recorded for this partition.`);
      }
      result.anchor.anchored = "local-manifest-only";
      if (anchored && !anchoredOrLocal) {
        result.ok = false;
        if (json) { console.log(JSON.stringify(result, null, 2)); }
        else { console.error(`\n  Verification: FAIL — strict --anchored requires an on-chain anchor; this partition has none. Use --anchored-or-local to accept local-manifest-only.\n`); }
        process.exit(1);
      }
    }
  }

  // Finalize the gate verdict now that anchor status is known. Mirrors the published
  // packages copy: a release needs >=1 INDEPENDENT witness — either an attestation
  // signed by a node other than the release signer, OR a verified on-chain anchor (the
  // XRPL anchor account is itself an independent third party), OR a --anchored-or-local
  // accepted local manifest whose root recomputed AND whose anchor EVENT was signed by a
  // bundled trusted attestor/anchor node (D18). With no independent witness the release is
  // UNVERIFIED, never PASS — UNCONDITIONALLY, regardless of profile. A forged/unsigned
  // anchor whose local manifest happens to recompute is NOT a witness.
  if (gate.verdict !== "FAIL") {
    const anchorWitness = result.anchor?.xrplVerified === true ||
      (anchoredOrLocal && result.anchor?.rootValid === true && anchorSignerTrusted === true);
    const hasIndependentWitness = gate.independentAttestor || anchorWitness;
    if (!hasIndependentWitness) {
      gate.verdict = "UNVERIFIED";
      result.ok = false;
    } else {
      gate.verdict = "PASS";
    }
    result.gate = gate;
  }

  // Final output
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (wantAnchor && result.anchor?.xrplVerified) {
      const a = result.anchor;
      console.log(`\n  Anchored: YES (partition=${a.partition}, root=${a.root.slice(0, 12)}..., tx=${a.txHash})`);
    } else if (wantAnchor) {
      console.log(`\n  Anchored: LOCAL-MANIFEST-ONLY (XRPL NOT verified)`);
    }
    console.log(`\n  Verification: ${gate.verdict === "PASS" && result.ok ? "PASS" : gate.verdict}\n`);
  }

  if (!result.ok) process.exit(1);
}

// Fetch the on-chain tx and run the pure verifyAnchorTx core (reused from the anchor domain, D4).
async function fetchAndVerifyAnchorTx({ txHash, wsUrl, localRoot, localManifestHash, leafCount, trustedAnchorAccounts }) {
  const xrpl = (await import("xrpl")).default;
  const client = new xrpl.Client(wsUrl);
  await client.connect();
  let txObj, memo;
  try {
    const response = await client.request({ command: "tx", transaction: txHash });
    txObj = response.result;
    const memos = txObj.Memos || [];
    const anchorMemo = memos.find(m =>
      Buffer.from(m.Memo?.MemoType || "", "hex").toString("utf8") === "repomesh-anchor-v1"
    );
    if (!anchorMemo) return { ok: false, reason: "no repomesh-anchor-v1 memo in tx" };
    memo = JSON.parse(Buffer.from(anchorMemo.Memo.MemoData, "hex").toString("utf8"));
  } finally {
    await client.disconnect();
  }
  return verifyAnchorTx({ tx: txObj, memo, localRoot, localManifestHash, leafCount, trustedAnchorAccounts });
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf("--repo");
  const versionIdx = args.indexOf("--version");
  const repo = repoIdx !== -1 ? args[repoIdx + 1] : null;
  const version = versionIdx !== -1 ? args[versionIdx + 1] : null;
  const anchored = args.includes("--anchored");
  const anchoredOrLocal = args.includes("--anchored-or-local");
  const json = args.includes("--json");
  if (!repo || !version) {
    console.error("Usage: verify-release.mjs --repo org/repo --version X.Y.Z [--anchored | --anchored-or-local] [--json]");
    process.exit(1);
  }
  verifyRelease({ repo, version, anchored, anchoredOrLocal, json }).catch(e => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
