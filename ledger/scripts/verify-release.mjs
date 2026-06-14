#!/usr/bin/env node
// RepoMesh Release Verifier
// Usage: node verify-release.mjs --repo org/repo --version 1.2.3

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalizeForHash } from "./canonicalize.mjs";
import {
  isKeyValidForSignature,
  resolveTrustedSignatureTimeSync,
  deriveKeyWindowConstraints,
  mergeStricterWindow,
} from "../../verifiers/lib/key-window.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");

const LEDGER_PATH = path.join(ROOT, "events", "events.jsonl");
const NODES_DIR = path.join(ROOT, "nodes");
// Verifier policy supplies the bundled-trusted-anchor allowlist (D18 rung-2 gate). Absence simply
// means no anchor's timestamp is trusted as a clock → the offline resolver falls through to 'self'.
const VERIFIER_POLICY_PATH =
  process.env.REPOMESH_VERIFIER_POLICY_PATH || path.join(REPO_ROOT, "verifier.policy.json");

// --- Offline trusted-time ctx (contract §5.2/§5.3) --------------------------------------------
// Builds the `ctx` the sync resolver consumes from the already-loaded ledger + the bundled-trusted
// anchor allowlist. No network: the OFFLINE rungs are 'anchor-event' (rung-2) and 'self' (rung-3).
//
//   findEarliestAnchorForLeaf(leafHash): the earliest AttestationPublished ledger.anchor event whose
//     pinned partition range [firstLeaf..lastLeaf] contains leafHash (the leaf is the contiguous
//     slice between the two range endpoints in ledger order — the same leaves the Merkle tree commits
//     to). Earliest = the anchor that appears first in the ledger, an upper bound on the leaf's time.
//   isBundledTrustedAnchor(anchorEvent): the anchor's signer keyId resolves to a node in the verifier
//     policy's trustedAttestors allowlist AND the anchor's own signature verifies (D18 rung-2 gate).
//     A forged/untrusted anchor's timestamp is NOT a trusted clock.
function buildOfflineTrustCtx(events) {
  let trustedAttestors = new Set();
  let trustedPolicy = new Set();
  const nodeCache = new Map();
  try {
    if (fs.existsSync(VERIFIER_POLICY_PATH)) {
      const policy = JSON.parse(fs.readFileSync(VERIFIER_POLICY_PATH, "utf8"));
      trustedAttestors = new Set(policy.trustedAttestors || []);
      // trustedPolicy = the governance-floor allowlist (§4.3). A node here may sign a
      // KeyRotation/KeyRevocation for ANY node. Falls back to trustedAttestors when absent, matching
      // validate-ledger's resolution.
      trustedPolicy = new Set(policy.trustedPolicy || policy.trustedAttestors || []);
    }
  } catch {
    // No/invalid policy → empty allowlist → no anchor is trusted → resolver falls to 'self'.
  }

  // canonicalHash list in ledger order (the leaf order the Merkle tree commits to).
  const leafOrder = events.map((e) => e?.signature?.canonicalHash);

  // Index ledger.anchor AttestationPublished events with their parsed [firstLeaf, lastLeaf] range.
  const anchors = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev?.type !== "AttestationPublished") continue;
    const isAnchor = Array.isArray(ev.attestations) &&
      ev.attestations.some((a) => a?.type === "ledger.anchor");
    if (!isAnchor) continue;
    let range = null;
    try {
      // The partition meta (incl. range) is the JSON object embedded after the first newline in notes.
      const nl = typeof ev.notes === "string" ? ev.notes.indexOf("{") : -1;
      if (nl !== -1) {
        const meta = JSON.parse(ev.notes.slice(nl));
        if (Array.isArray(meta.range) && meta.range.length === 2) range = meta.range;
      }
    } catch {
      // unparseable anchor notes → not usable as a clock
    }
    if (range) anchors.push({ index: i, ev, range });
  }

  function loadNode(repoId) {
    if (nodeCache.has(repoId)) return nodeCache.get(repoId);
    const [org, repoName] = (repoId || "").split("/");
    let node = null;
    if (org && repoName && SAFE_SEGMENT.test(org) && SAFE_SEGMENT.test(repoName)) {
      const p = path.join(NODES_DIR, org, repoName, "node.json");
      if (fs.existsSync(p)) {
        try { node = JSON.parse(fs.readFileSync(p, "utf8")); } catch { node = null; }
      }
    }
    nodeCache.set(repoId, node);
    return node;
  }

  function findEarliestAnchorForLeaf(leafHash) {
    for (const { ev, range } of anchors) {
      const start = leafOrder.indexOf(range[0]);
      const end = leafOrder.indexOf(range[1]);
      if (start === -1 || end === -1 || end < start) continue;
      // leaf is covered iff it lies within the contiguous [start..end] slice.
      for (let j = start; j <= end; j++) {
        if (leafOrder[j] === leafHash) return ev;
      }
    }
    return null;
  }

  function isBundledTrustedAnchor(anchorEvent) {
    const keyId = anchorEvent?.signature?.keyId;
    if (!keyId) return false;
    // The signer must belong to a trustedAttestors node that advertises this keyId, and the anchor's
    // own signature must verify against that node's key.
    for (const id of trustedAttestors) {
      const node = loadNode(id);
      const m = (node?.maintainers || []).find((x) => x.keyId === keyId);
      if (!m?.publicKey) continue;
      const pem = String(m.publicKey).trim();
      if (!pem.includes("BEGIN PUBLIC KEY")) continue;
      try {
        const ok = crypto.verify(
          null,
          Buffer.from(anchorEvent.signature.canonicalHash, "hex"),
          pem,
          Buffer.from(anchorEvent.signature.value, "base64")
        );
        if (ok) return true;
      } catch {
        // try the next candidate node
      }
    }
    return false;
  }

  return { findEarliestAnchorForLeaf, isBundledTrustedAnchor, loadNode, trustedPolicy };
}

// Parse args
const args = process.argv.slice(2);
const repoIdx = args.indexOf("--repo");
const versionIdx = args.indexOf("--version");

if (repoIdx === -1 || versionIdx === -1) {
  console.error("Usage: node verify-release.mjs --repo <org/repo> --version <semver>");
  process.exit(1);
}

const repo = args[repoIdx + 1];
const version = args[versionIdx + 1];

if (!repo || !version) {
  console.error("Both --repo and --version are required.");
  process.exit(1);
}

// Find matching event
const lines = fs.readFileSync(LEDGER_PATH, "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0);

let found = null;
for (const line of lines) {
  try {
    const ev = JSON.parse(line);
    if (ev.repo === repo && ev.version === version && ev.type === "ReleasePublished") {
      found = ev;
      break;
    }
  } catch {
    // skip malformed lines
  }
}

if (!found) {
  console.error(`No ReleasePublished event found for ${repo}@${version}`);
  process.exit(1);
}

console.log(`Found: ${found.type} ${found.repo}@${found.version}`);
console.log(`  Commit:    ${found.commit}`);
console.log(`  Timestamp: ${found.timestamp}`);
console.log(`  KeyId:     ${found.signature.keyId}`);
console.log();

// Verify canonical hash
function stripSignature(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.signature;
  return copy;
}

const canonical = canonicalizeForHash(stripSignature(found));
const computedHash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");

if (computedHash !== found.signature.canonicalHash) {
  console.error(`Canonical hash MISMATCH`);
  console.error(`  computed: ${computedHash}`);
  console.error(`  ledger:   ${found.signature.canonicalHash}`);
  process.exit(1);
}
console.log(`  Hash:      ${computedHash} (verified)`);

// Verify signature against registered node
const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/; // path traversal guard
const [org, repoName] = repo.split("/");
if (!org || !repoName || !SAFE_SEGMENT.test(org) || !SAFE_SEGMENT.test(repoName)) {
  console.error(`Invalid repo "${repo}": org and repo must match /^[a-zA-Z0-9_.-]+$/.`);
  process.exit(1);
}
const nodePath = path.join(NODES_DIR, org, repoName, "node.json");
if (!fs.existsSync(nodePath)) {
  console.error(`  Node manifest not found at ${path.relative(REPO_ROOT, nodePath)}`);
  process.exit(1);
}

const node = JSON.parse(fs.readFileSync(nodePath, "utf8"));
const maintainer = node.maintainers?.find((m) => m.keyId === found.signature.keyId);
if (!maintainer) {
  console.error(`  No maintainer with keyId="${found.signature.keyId}" in ${repo} node.json`);
  process.exit(1);
}

// --- Key-lifecycle time gate (contract §5.3) ---------------------------------------------
// AFTER finding the maintainer by keyId and BEFORE using its key: resolve the signature's TRUSTED
// time over the already-loaded ledger (OFFLINE → sync resolver) and apply the shared predicate. A
// grandfathered maintainer (no window fields) is byte-identical to today (the predicate returns
// valid immediately). A windowed key whose signature falls outside its valid window is rejected with
// the same "no key" exit shape this site already uses, carrying the predicate's reason.
const allEvents = [];
for (const line of lines) {
  try {
    allEvents.push(JSON.parse(line));
  } catch {
    // skip malformed lines (already tolerated above)
  }
}
const trustCtx = buildOfflineTrustCtx(allEvents);
const tt = resolveTrustedSignatureTimeSync(found, trustCtx);

// --- Derive-the-stricter-window hardening (contract §12.1 + §13.1) -----------------------------
// Finding ① (Wave-B2): this verifier reads window state from node.json and does NOT run the ledger
// binding check, so a tampered node.json that STRIPS a revoked key's window fields re-grandfathers it
// → VALID. Defence: derive the window independently from the SIGNED KeyRotation/KeyRevocation events,
// then merge the MOST RESTRICTIVE of node.json + derived. A tampered node.json can then only ADD
// restriction, never remove what the signed events assert. GRANDFATHER is byte-identical: no key
// events → empty constraints → the maintainer is returned UNCHANGED by mergeStricterWindow (===).
//
// Finding ③ (Wave-B3, §13.1): the §4 authorization *validity decision* now lives ENTIRELY inside the
// shared module's order-aware single forward pass. deriveKeyWindowConstraints replays the key-lifecycle
// events in LEDGER ORDER, and a key-event's SIGNER is validated against the window state derived from
// STRICTLY-EARLIER events (merged with node.json) — so a key whose compromise-revocation precedes the
// rotation it tries to sign can no longer authorize that rotation, even when node.json strips its
// window. This site supplies ONLY the I/O the module needs (the consolidation deletes the per-site
// verifyAndAuthorize authorization logic — the validity decision is no longer duplicated here):
//   • verifySignature(ev) → resolves the signer key from the SAME-node node.json OR a trustedPolicy
//        node (governance floor §4.3), runs THIS site's crypto.verify, and reports
//        { ok, signerKeyId, signerNodeRepo }. (Identity resolution only — NOT a validity decision.)
//   • getMaintainer(keyId, nodeRepo) → loads the maintainer from the relevant node.json.
//   • timeOf(ev) → THIS site's OFFLINE trusted-time resolver (sync).
//   • trustedPolicy → the verifier policy's governance-floor allowlist.
// The module decides authorization + signer-validity; a self-signed revocation, an unknown signer, a
// bad signature, or an already-revoked signer contributes NO derived constraint (fail-closed).
const deriveOpts = {
  // Resolve the signer's public key + report identity. The signer is a SAME-node maintainer (the
  // common case — repo-bound keys) OR a key advertised by a trustedPolicy node (governance floor).
  // No validity/authorization judgement here: that is the module's job via getMaintainer + timeOf.
  verifySignature(ev) {
    try {
      const sigKeyId = ev?.signature?.keyId;
      const canonicalHash = ev?.signature?.canonicalHash;
      const sigValue = ev?.signature?.value;
      if (!sigKeyId || !canonicalHash || !sigValue) return { ok: false, signerKeyId: null, signerNodeRepo: null };

      // Candidate signer nodes: the event's own repo first (same-node repo-bound key), then every
      // trustedPolicy node. The FIRST node that advertises this keyId AND verifies the signature wins.
      const candidateRepos = [ev.repo, ...trustCtx.trustedPolicy];
      for (const repoId of candidateRepos) {
        if (!repoId) continue;
        const node = trustCtx.loadNode(repoId);
        const m = (node?.maintainers || []).find((x) => x.keyId === sigKeyId);
        const pem = String(m?.publicKey || "").trim();
        if (!pem.includes("BEGIN PUBLIC KEY")) continue;
        let ok;
        try {
          ok = crypto.verify(
            null,
            Buffer.from(canonicalHash, "hex"),
            pem,
            Buffer.from(sigValue, "base64"),
          );
        } catch {
          continue; // bad key/sig encoding for this candidate — try the next node
        }
        if (ok) return { ok: true, signerKeyId: sigKeyId, signerNodeRepo: repoId };
      }
      return { ok: false, signerKeyId: null, signerNodeRepo: null };
    } catch {
      return { ok: false, signerKeyId: null, signerNodeRepo: null };
    }
  },
  // Load the maintainer (the node.json read surface) for the signer's resolved node.
  getMaintainer(keyId, nodeRepo) {
    const node = trustCtx.loadNode(nodeRepo);
    return (node?.maintainers || []).find((x) => x.keyId === keyId) ?? null;
  },
  // THIS site's offline trusted-time resolver (sync) — the same one used for the release itself.
  timeOf(ev) {
    return resolveTrustedSignatureTimeSync(ev, trustCtx);
  },
  // Governance-floor allowlist (§4.3): a node here may sign a KeyRotation/KeyRevocation for ANY node.
  trustedPolicy: trustCtx.trustedPolicy,
};

const constraint = deriveKeyWindowConstraints(allEvents, repo, deriveOpts).get(
  found.signature.keyId,
);
const eff = mergeStricterWindow(maintainer, constraint);
const dec = isKeyValidForSignature(eff, tt);
if (!dec.valid) {
  console.error(
    `  No usable key for keyId="${found.signature.keyId}" in ${repo} node.json: ${dec.reason}`
  );
  process.exit(1);
}

const pubKeyPem = maintainer.publicKey.trim();
if (!pubKeyPem.includes("BEGIN PUBLIC KEY")) { // PEM format validation
  console.error(`  Public key for ${repo} (keyId: ${found.signature.keyId}) is not valid PEM format.`);
  process.exit(1);
}
const msg = Buffer.from(found.signature.canonicalHash, "hex");
const sig = Buffer.from(found.signature.value, "base64");
let ok;
try {
  ok = crypto.verify(null, msg, pubKeyPem, sig);
} catch (e) {
  console.error("Signature verification error: " + e.message);
  process.exit(1);
}

if (!ok) {
  console.error(`  Signature: FAILED`);
  process.exit(1);
}
console.log(`  Signature: verified (signer: ${maintainer.name})`);

// Print artifacts
console.log();
console.log("Artifacts:");
for (const a of found.artifacts) {
  console.log(`  ${a.name}`);
  console.log(`    sha256: ${a.sha256}`);
  console.log(`    uri:    ${a.uri}`);
}

// Print attestations
if (found.attestations?.length > 0) {
  console.log();
  console.log("Attestations:");
  for (const att of found.attestations) {
    console.log(`  ${att.type}: ${att.uri}`);
  }
}

console.log();
console.log(`Release ${repo}@${version} is verified.`);
