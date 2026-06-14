#!/usr/bin/env node
// RepoMesh Attestor — Scans ReleasePublished events and emits AttestationPublished.
// Checks: sbom.present, provenance.present, signature.chain
//
// Usage:
//   node attest-release.mjs --repo org/repo --version 1.2.3
//   node attest-release.mjs --scan-new   (process all unattested releases)
//   node attest-release.mjs --scan-new --sign --output /tmp/attestations.jsonl
//     (sign with REPOMESH_SIGNING_KEY env + REPOMESH_KEY_ID env, write to file)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  isKeyValidForSignature,
  resolveTrustedSignatureTimeSync,
  deriveKeyWindowConstraints,
  mergeStricterWindow,
} from "../../verifiers/lib/key-window.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
// REPOMESH_LEDGER_PATH / REPOMESH_NODES_PATH allow tests (and alternate ledgers) to
// point the attestor at a crafted tree without mutating the repo's real ledger.
const LEDGER_PATH = process.env.REPOMESH_LEDGER_PATH || path.join(ROOT, "ledger", "events", "events.jsonl");
const NODES_DIR = process.env.REPOMESH_NODES_PATH || path.join(ROOT, "ledger", "nodes");

// --- helpers ---

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  let raw;
  try { raw = fs.readFileSync(LEDGER_PATH, "utf8"); } catch (e) { console.error("Failed to read " + LEDGER_PATH + ": " + e.message); process.exit(1); }
  // SEC-008: wrap per-line JSON.parse so a single malformed line yields a structured,
  // line-numbered error instead of a raw stack trace, and the corrupt ledger is rejected
  // rather than silently truncated.
  const lines = raw.split("\n");
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue;
    try {
      events.push(JSON.parse(lines[i]));
    } catch (e) {
      console.error(`Malformed JSON in ledger at ${LEDGER_PATH}:${i + 1}: ${e.message}`);
      process.exit(1);
    }
  }
  return events;
}

const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/; // path traversal guard

function findNodeManifest(repoId) {
  const [org, repo] = repoId.split("/");
  if (!org || !repo || !SAFE_SEGMENT.test(org) || !SAFE_SEGMENT.test(repo)) {
    console.error(`Invalid repoId "${repoId}": org and repo must match /^[a-zA-Z0-9_.-]+$/.`);
    return null;
  }
  const p = path.join(NODES_DIR, org, repo, "node.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.error("Failed to read " + p + ": " + e.message); return null; }
}

// --- key-lifecycle trusted-time ctx (contract site 10, §5.2/§5.3) ---
//
// This is the OFFLINE ctx the sig-chain check feeds to resolveTrustedSignatureTimeSync. It is built
// from the already-loaded ledger events + the existing bundled-trusted-anchor (D18) set, so the
// attestor stays fully offline + synchronous (no XRPL/network — that rung is the CLI's online path).
//
//   findEarliestAnchorForLeaf(leafHash) -> { anchor } | null
//     The EARLIEST bundled-trusted ledger.anchor AttestationPublished whose partition timestamp-range
//     covers the source event that owns `leafHash`. Partition membership is by timestamp range, the
//     same model registry/scripts/build-anchors.mjs uses (partitionStart/partitionEnd in the anchor's
//     notes JSON). Returns the anchor EVENT (an AttestationPublished) for the rung-2 trust gate.
//   isBundledTrustedAnchor(anchorEvent) -> boolean
//     true iff the anchor's repo is in verifier.policy.json trustedAttestors (the existing D18
//     bundled-trusted-signer check). A forged/untrusted anchor's timestamp is NOT a trusted clock.

function loadTrustedAttestors() {
  try {
    const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "verifier.policy.json"), "utf8"));
    return new Set(Array.isArray(policy?.trustedAttestors) ? policy.trustedAttestors : []);
  } catch {
    return new Set();
  }
}

// trustedPolicy nodes (§4.3 governance floor) — a node in this set MAY sign a KeyRevocation for ANY
// node. Falls back to trustedAttestors when the policy omits a dedicated trustedPolicy list, matching
// validate-ledger's resolution (`policy.trustedPolicy || policy.trustedAttestors`).
function loadTrustedPolicy() {
  try {
    const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "verifier.policy.json"), "utf8"));
    const list = Array.isArray(policy?.trustedPolicy)
      ? policy.trustedPolicy
      : (Array.isArray(policy?.trustedAttestors) ? policy.trustedAttestors : []);
    return new Set(list);
  } catch {
    return new Set();
  }
}

// Re-verify a key-lifecycle event's ed25519 signature against a candidate PEM (reuses the attestor's
// existing canonical-hash + crypto.verify machinery — the same operation checkSignatureChain runs).
function verifyEventSig(ev, pem) {
  try {
    const stripped = JSON.parse(JSON.stringify(ev));
    delete stripped.signature;
    const computed = crypto.createHash("sha256")
      .update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
    if (computed !== ev?.signature?.canonicalHash) return false;
    return crypto.verify(
      null,
      Buffer.from(computed, "hex"),
      String(pem).trim(),
      Buffer.from(ev?.signature?.value || "", "base64")
    );
  } catch {
    return false;
  }
}

// Build the NEW-shape deriveKeyWindowConstraints opts (contract §13.1). The §4 authorization VALIDITY
// decision now lives ENTIRELY in the shared module (the order-aware forward pass) — this site supplies
// only pure I/O, reusing its EXISTING machinery (findNodeManifest + verifyEventSig +
// resolveTrustedSignatureTimeSync). The old per-site makeVerifyAndAuthorize is DELETED (it was a latent
// drift surface; its surviving-signer / governance / self-revoke logic is subsumed by §13.1 clauses
// b+c in the shared module). The opts:
//   verifySignature(ev) -> { ok, signerKeyId, signerNodeRepo }
//     Resolve the signer's PEM (same-node via findNodeManifest(ev.repo), or a trustedPolicy node) and
//     verify the event's ed25519 signature with the site's verifyEventSig. signerNodeRepo is the repo
//     whose node.json holds the signer key (= ev.repo for same-node, or the policy repo).
//   getMaintainer(keyId, nodeRepo) -> maintainer|null
//     The node.json read surface: findNodeManifest(nodeRepo) then match by keyId.
//   timeOf(ev) -> trustedTime  — the OFFLINE sync resolver against THIS ctx (§5.2).
//   trustedPolicy: Set<nodeRepo> — the governance floor (§4.3), from verifier.policy.json.
function makeDeriveOpts(timeCtx, trustedPolicy) {
  const maintainerIn = (manifest, keyId) =>
    manifest?.maintainers?.find((m) => m.keyId === keyId) || null;

  const verifySignature = (ev) => {
    const signerKeyId = ev?.signature?.keyId;
    if (typeof signerKeyId !== "string" || signerKeyId === "") return { ok: false };
    // Same-node signer (the event's own repo).
    const sameNodeSigner = maintainerIn(findNodeManifest(ev?.repo), signerKeyId);
    if (sameNodeSigner?.publicKey && verifyEventSig(ev, sameNodeSigner.publicKey)) {
      return { ok: true, signerKeyId, signerNodeRepo: ev.repo };
    }
    // trustedPolicy node signer (governance floor, §4.3).
    for (const policyRepo of trustedPolicy) {
      const psigner = maintainerIn(findNodeManifest(policyRepo), signerKeyId);
      if (psigner?.publicKey && verifyEventSig(ev, psigner.publicKey)) {
        return { ok: true, signerKeyId, signerNodeRepo: policyRepo };
      }
    }
    return { ok: false };
  };

  return {
    verifySignature,
    getMaintainer: (keyId, nodeRepo) => maintainerIn(findNodeManifest(nodeRepo), keyId),
    timeOf: (ev) => resolveTrustedSignatureTimeSync(ev, timeCtx),
    trustedPolicy,
  };
}

function anchorPartitionRange(anchorEvent) {
  // The partition range is encoded as a trailing JSON metadata block in the anchor's notes
  // (emit-anchor-event.mjs). Parse it defensively — a malformed/absent block => no usable range.
  const notes = typeof anchorEvent?.notes === "string" ? anchorEvent.notes : "";
  const brace = notes.indexOf("{");
  if (brace === -1) return null;
  try {
    const meta = JSON.parse(notes.slice(brace));
    const start = meta?.partitionStart ? new Date(meta.partitionStart) : null;
    const end = meta?.partitionEnd ? new Date(meta.partitionEnd) : null;
    if (start && Number.isNaN(start.getTime())) return null;
    if (end && Number.isNaN(end.getTime())) return null;
    return { start, end };
  } catch {
    return null;
  }
}

function isLedgerAnchorEvent(ev) {
  return ev?.type === "AttestationPublished" &&
    Array.isArray(ev.attestations) &&
    ev.attestations.some(a => a?.type === "ledger.anchor");
}

export function buildAttestorTimeCtx(events) {
  const evs = Array.isArray(events) ? events : [];
  const trusted = loadTrustedAttestors();

  // Index source events by their leaf (signature.canonicalHash) so we can map a leaf -> its
  // self-asserted timestamp, which is what a partition-by-time-range anchor covers.
  const sourceByLeaf = new Map();
  for (const ev of evs) {
    const h = ev?.signature?.canonicalHash;
    if (typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h) && !sourceByLeaf.has(h)) {
      sourceByLeaf.set(h, ev);
    }
  }

  const anchorEvents = evs.filter(isLedgerAnchorEvent);

  function findEarliestAnchorForLeaf(leafHash) {
    const source = sourceByLeaf.get(leafHash);
    if (!source) return null;
    const sourceTime = source.timestamp ? new Date(source.timestamp) : null;
    if (!sourceTime || Number.isNaN(sourceTime.getTime())) return null;

    let earliest = null;
    let earliestTs = null;
    for (const a of anchorEvents) {
      const range = anchorPartitionRange(a);
      if (!range) continue;
      // The source event must fall inside this anchor's partition range (inclusive).
      if (range.start && sourceTime < range.start) continue;
      if (range.end && sourceTime > range.end) continue;
      const at = a.timestamp ? new Date(a.timestamp) : null;
      if (!at || Number.isNaN(at.getTime())) continue;
      if (earliestTs === null || at < earliestTs) {
        earliest = a;
        earliestTs = at;
      }
    }
    return earliest ? { anchor: earliest } : null;
  }

  function isBundledTrustedAnchor(anchorEvent) {
    return trusted.has(anchorEvent?.repo);
  }

  // Wave-B2 §12.1 + Wave-B3 §13.1: also expose the loaded events + the NEW-shape derive opts
  // (verifySignature/getMaintainer/timeOf/trustedPolicy) so checkSignatureChain can derive the
  // signed-event window floor via the ORDER-AWARE forward pass and merge the stricter window. The opts
  // close over `ctx` (this object) so timeOf resolves trusted time against the same anchor index.
  const trustedPolicy = loadTrustedPolicy();
  const ctx = { findEarliestAnchorForLeaf, isBundledTrustedAnchor, events: evs };
  ctx.deriveOpts = makeDeriveOpts(ctx, trustedPolicy);
  return ctx;
}

// --- attestation checks ---

function checkSbomPresent(releaseEvent) {
  const has = releaseEvent.attestations?.some((a) =>
    a.type === "sbom" || a.type === "sbom.present"
  );
  return {
    kind: "sbom.present",
    result: has ? "pass" : "fail",
    reason: has
      ? "Release includes SBOM attestation"
      : "No SBOM attestation found in release event"
  };
}

function checkProvenancePresent(releaseEvent) {
  const has = releaseEvent.attestations?.some((a) =>
    a.type === "provenance"
  );
  return {
    kind: "provenance.present",
    result: has ? "pass" : "fail",
    reason: has
      ? "Release includes build provenance"
      : "No build provenance attestation found in release event"
  };
}

// STGB-ATT-008: signature.chain previously lumped 5 structurally distinct failure causes under
// "fail" with similar prose, so an operator could not tell WHY a release was rejected. Each cause now
// carries a distinct machine-readable `code` plus a human `reason` and a `hint` on how to fix it.
// STGB-ATT-009: the release event's `signature` block may be absent (a release published without any
// signature). Guard its presence BEFORE dereferencing `.keyId` / `.value` / `.canonicalHash` so we
// emit a legible "signature-missing" verdict instead of a raw TypeError.
//
// Verdict correctness is UNCHANGED: every one of these causes still yields result "fail" (only a
// fully verified signature passes). This is additive legibility, not a gate change.
function sigChainFail(code, reason, hint) {
  return { kind: "signature.chain", result: "fail", code, reason, hint };
}

function checkSignatureChain(releaseEvent, ctx) {
  // STGB-ATT-009: presence guard — no signature block at all (or missing keyId) cannot be verified.
  const signature = releaseEvent?.signature;
  if (!signature || typeof signature !== "object") {
    return sigChainFail(
      "signature-missing",
      `Release event for ${releaseEvent?.repo} carries no signature block; nothing to verify`,
      "Re-publish the release signed with a registered maintainer key (the event must carry signature.keyId/value/canonicalHash)."
    );
  }
  if (!signature.keyId) {
    return sigChainFail(
      "signature-keyid-missing",
      `Release event for ${releaseEvent?.repo} has a signature block but no keyId`,
      "Sign the release with a maintainer key that sets signature.keyId so it can be matched to node.json."
    );
  }

  const node = findNodeManifest(releaseEvent.repo);
  if (!node) {
    return sigChainFail(
      "node-not-registered",
      `Node manifest not registered for ${releaseEvent.repo}`,
      `Register ${releaseEvent.repo} by committing ledger/nodes/<org>/<repo>/node.json with its maintainer public keys.`
    );
  }

  const maintainer = node.maintainers?.find(
    (m) => m.keyId === signature.keyId
  );
  if (!maintainer) {
    return sigChainFail(
      "keyid-not-found",
      `No maintainer with keyId="${signature.keyId}" in ${releaseEvent.repo}`,
      "Add this keyId to the repo's node.json maintainers, or re-sign with a key that is already registered."
    );
  }

  // Contract site 10 (§5.3): AFTER the maintainer is found by keyId and BEFORE its key material is
  // used, apply the key-window time gate. Resolve the signature's trusted time OFFLINE (sync resolver,
  // §5.2) from the ctx built off the already-loaded events + the bundled-trusted-anchor set, then call
  // the shared predicate. On !valid, fail in the SAME structured shape as the other causes, carrying
  // dec.reason. A GRANDFATHERED (window-less) maintainer is always valid => byte-identical to today,
  // even when ctx is absent (the resolver yields a time, the predicate short-circuits on grandfather).
  //
  // Wave-B2 §12.1 (node.json-STRIP hardening) + Wave-B3 §13.1 (order-aware authorization): derive the
  // window from the SIGNED, AUTHORIZED KeyRotation/KeyRevocation events in the ledger and merge the
  // MOST RESTRICTIVE of node.json + derived BEFORE the predicate. The derive is an ORDER-AWARE single
  // forward pass: a key-lifecycle event counts only if its signature verifies AND its signer is BOTH
  // authorized (surviving same-node key OR trustedPolicy node) AND itself currently valid at the
  // event's trusted time against STRICTLY-EARLIER events — closing residual ③ (a compromise-revoked,
  // node.json-STRIPPED key cannot authorize a LATER rotation that precedes nothing). A tampered
  // node.json that strips a revoked key's window fields therefore cannot re-grandfather it. With no
  // key-lifecycle events (or no ctx) the derived map is EMPTY, so mergeStricterWindow(maintainer,
  // undefined) returns the maintainer UNCHANGED => grandfather stays byte-identical. The events + the
  // NEW-shape opts (verifySignature/getMaintainer/timeOf/trustedPolicy) come from the ctx
  // buildAttestorTimeCtx returns — this site carries NO local authorization logic.
  const c = ctx || {};
  const constraint = deriveKeyWindowConstraints(
    c.events,
    releaseEvent.repo,
    c.deriveOpts || {}
  ).get(signature.keyId);
  const eff = mergeStricterWindow(maintainer, constraint);
  const tt = resolveTrustedSignatureTimeSync(releaseEvent, c);
  const dec = isKeyValidForSignature(eff, tt);
  if (!dec.valid) {
    return sigChainFail(
      "key-time-invalid",
      `Signing key "${signature.keyId}" for ${releaseEvent.repo} is not valid for this signature's trusted time: ${dec.reason}`,
      "This key was rotated out or revoked before/at this signature's provable time. Re-sign with a currently-valid maintainer key, or (for a routine rotation) verify the signature predates the rotation."
    );
  }

  try {
    const stripped = JSON.parse(JSON.stringify(releaseEvent));
    delete stripped.signature;
    const canonical = JSON.stringify(canonicalize(stripped));
    const computedHash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");

    if (computedHash !== signature.canonicalHash) {
      return sigChainFail(
        "hash-mismatch",
        "Canonical hash mismatch during re-verification — the event body differs from what was signed",
        "The event was altered after signing (or the committed canonicalHash is wrong); re-sign the exact event body."
      );
    }

    const pk = maintainer.publicKey.trim();
    const msg = Buffer.from(computedHash, "hex");
    const sig = Buffer.from(signature.value || "", "base64");
    const ok = crypto.verify(null, msg, pk, sig);

    if (ok) {
      return {
        kind: "signature.chain",
        result: "pass",
        code: "verified",
        reason: `Signature verified against ${maintainer.name} (${maintainer.keyId})`
      };
    }
    return sigChainFail(
      "sig-invalid",
      "Signature verification failed — the signature does not match the maintainer's registered public key",
      "The signature value does not verify against the registered public key; re-sign with the correct private key for this keyId."
    );
  } catch (e) {
    return sigChainFail(
      "verification-error",
      `Verification error: ${e.message}`,
      "An unexpected error occurred during verification (e.g. malformed public key or signature encoding); check the node.json key material and the event's signature.value encoding."
    );
  }
}

// --- signing ---

function signEvent(ev, signingKeyPem, keyId) {
  ev.signature = { alg: "ed25519", keyId, value: "", canonicalHash: "" };

  const stripped = JSON.parse(JSON.stringify(ev));
  delete stripped.signature;
  const canonical = JSON.stringify(canonicalize(stripped));
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");

  const privKey = crypto.createPrivateKey(signingKeyPem);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privKey);

  ev.signature.value = sig.toString("base64");
  ev.signature.canonicalHash = hash;
  return ev;
}

// --- build attestation event ---

function buildAttestationEvent(releaseEvent, checks) {
  return {
    type: "AttestationPublished",
    repo: releaseEvent.repo,
    version: releaseEvent.version,
    commit: releaseEvent.commit,
    timestamp: new Date().toISOString(),
    artifacts: releaseEvent.artifacts,
    attestations: checks.map((c) => ({
      type: c.kind,
      uri: `repomesh:attestor:${c.kind}:${c.result}`
    })),
    // Surface the distinct cause code (STGB-ATT-008) and the fix hint (when present) so the
    // attestation notes are legible to an operator, not just a bare result token.
    notes: checks.map((c) => {
      const codePart = c.code ? ` [${c.code}]` : "";
      const hintPart = c.hint ? `\n    hint: ${c.hint}` : "";
      return `${c.kind}: ${c.result}${codePart} — ${c.reason}${hintPart}`;
    }).join("\n"),
    signature: { alg: "ed25519", keyId: "UNSIGNED", value: "UNSIGNED", canonicalHash: "UNSIGNED" }
  };
}

// --- SEC-005: gate presence on signature.chain ---
//
// sbom.present / provenance.present are read from the RELEASE EVENT's own attestation list, which is
// only trustworthy if the release event's signature verifies. If signature.chain does NOT pass, the
// release event's claims (including its sbom/provenance entries) cannot be trusted — so a "present"
// presence check must NOT award pass on the strength of an unverified event. We force such presence
// checks to "fail" and annotate why. signature.chain itself is reported as-is.
export function computeGatedChecks(release, ctx) {
  const sbom = checkSbomPresent(release);
  const provenance = checkProvenancePresent(release);
  const signature = checkSignatureChain(release, ctx);

  if (signature.result !== "pass") {
    for (const c of [sbom, provenance]) {
      if (c.result === "pass") {
        c.result = "fail";
        c.reason = `${c.reason} — but withheld: release signature.chain did not verify (presence unverifiable)`;
      }
    }
  }
  return [sbom, provenance, signature];
}

// --- main (only when invoked directly, not when imported by tests) ---

export { checkSbomPresent, checkProvenancePresent, checkSignatureChain, signEvent };

function main() {
const args = process.argv.slice(2);
const scanNew = args.includes("--scan-new");
const doSign = args.includes("--sign");
const dryRun = process.argv.includes("--dry-run");
const repoIdx = args.indexOf("--repo");
const versionIdx = args.indexOf("--version");
const outputIdx = args.indexOf("--output");
const outputPath = (outputIdx !== -1 && outputIdx + 1 < args.length) ? args[outputIdx + 1] : null;

const events = readEvents();

// Find which releases have already been attested
const attested = new Set();
for (const ev of events) {
  if (ev.type === "AttestationPublished") {
    attested.add(`${ev.repo}|${ev.version}`);
  }
}

let targets = [];

if (scanNew) {
  targets = events.filter(
    (ev) => ev.type === "ReleasePublished" && !attested.has(`${ev.repo}|${ev.version}`)
  );
  if (targets.length === 0) {
    console.log("No unattested releases found.");
    process.exit(0);
  }
} else if (repoIdx !== -1 && repoIdx + 1 < args.length && versionIdx !== -1 && versionIdx + 1 < args.length) {
  const repo = args[repoIdx + 1];
  const version = args[versionIdx + 1];
  const found = events.find(
    (ev) => ev.type === "ReleasePublished" && ev.repo === repo && ev.version === version
  );
  if (!found) {
    console.error(`No ReleasePublished event found for ${repo}@${version}`);
    process.exit(1);
  }
  targets = [found];
} else {
  console.error("Usage:");
  console.error("  node attest-release.mjs --repo <org/repo> --version <semver>");
  console.error("  node attest-release.mjs --scan-new");
  console.error("  node attest-release.mjs --scan-new --sign --output <path>");
  console.error("  node attest-release.mjs --scan-new --dry-run");
  process.exit(1);
}

// Resolve signing key if --sign
let signingKey = null;
let signingKeyId = null;
if (doSign) {
  signingKey = process.env.REPOMESH_SIGNING_KEY;
  signingKeyId = process.env.REPOMESH_KEY_ID;
  if (!signingKey || !signingKeyId) {
    console.error("--sign requires REPOMESH_SIGNING_KEY and REPOMESH_KEY_ID env vars.");
    process.exit(1);
  }
}

const results = [];

// Build the offline trusted-time ctx ONCE from the full loaded ledger (contract site 10). It maps a
// release's leaf to the earliest bundled-trusted anchor whose partition covers it, so the sig-chain
// check can time-gate a rotated/revoked key against a PROVABLE (anchored) signature time.
const timeCtx = buildAttestorTimeCtx(events);

for (const release of targets) {
  console.log(`\nAttesting: ${release.repo}@${release.version}`);

  const checks = computeGatedChecks(release, timeCtx);

  for (const c of checks) {
    const mark = c.result === "pass" ? "\u2705" : "\u274C";
    console.log(`  ${mark} ${c.kind}: ${c.reason}`);
  }

  let attestEvent = buildAttestationEvent(release, checks);

  if (doSign) {
    attestEvent = signEvent(attestEvent, signingKey, signingKeyId);
    console.log(`  Signed with keyId: ${signingKeyId}`);
  }

  results.push(attestEvent);
}

// Output
if (dryRun) {
  console.log("\n--- DRY RUN: Attestation events (not written) ---");
  for (const ev of results) {
    console.log(JSON.stringify(ev, null, 2));
  }
  console.log(`\n${results.length} attestation(s) computed (dry run — nothing written).`);
} else if (outputPath) {
  const lines = results.map((ev) => JSON.stringify(ev)).join("\n") + "\n";
  fs.writeFileSync(outputPath, lines, "utf8");
  console.log(`\n${results.length} attestation(s) written to ${outputPath}`);
} else {
  console.log("\n--- Attestation events (JSONL) ---");
  for (const ev of results) {
    console.log(JSON.stringify(ev));
  }
  console.log(`\n${results.length} attestation(s) generated.${doSign ? "" : " Sign and append to ledger to publish."}`);
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
