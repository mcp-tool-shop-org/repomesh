#!/usr/bin/env node
// RepoMesh Verifier — Shared utilities for all verifier scripts.
// Extracted from attestor/scripts/attest-release.mjs patterns.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  isKeyValidForSignature,
  resolveTrustedSignatureTimeSync,
  deriveKeyWindowConstraints,
  mergeStricterWindow,
} from "./key-window.mjs";

export function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function readEvents(ledgerPath) {
  const p = ledgerPath || path.join(process.cwd(), "ledger/events/events.jsonl");
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").split("\n");
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (e) {
      // SEC-008: never let a malformed line throw a raw stack. Surface a structured,
      // line-numbered error and abort — a corrupt ledger must not be silently truncated.
      const err = new Error(
        `Malformed JSON in ledger at ${p}:${i + 1}: ${e.message}`
      );
      err.code = "REPOMESH_LEDGER_PARSE_ERROR";
      err.ledgerPath = p;
      err.lineNumber = i + 1;
      throw err;
    }
  }
  return events;
}

export function findReleaseEvent(events, repo, version) {
  return events.find(ev =>
    ev?.type === "ReleasePublished" &&
    ev?.repo === repo &&
    ev?.version === version
  );
}

export function hasAttestationEvent(events, repo, version, attestationType) {
  return events.some(ev => {
    if (ev?.type !== "AttestationPublished") return false;
    if (ev?.repo !== repo || ev?.version !== version) return false;
    const ats = Array.isArray(ev.attestations) ? ev.attestations : [];
    return ats.some(a => a?.type === attestationType);
  });
}

export function findNodeManifest(repoId) {
  const [org, repo] = repoId.split("/");
  const p = path.join(process.cwd(), "ledger/nodes", org, repo, "node.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Node manifest not found for ${repoId} at ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Re-verify a key-lifecycle event's ed25519 signature against a candidate PEM. Reuses this module's
// canonical-hash machinery (computeCanonicalHash) + crypto.verify — the SAME operation the verifier
// uses for release signatures. Returns false on any structural/crypto miss (fail-closed).
function verifyEventSignatureWith(ev, pem) {
  try {
    const stripped = JSON.parse(JSON.stringify(ev));
    delete stripped.signature;
    const computed = computeCanonicalHash(stripped);
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

// Build the NEW-shape deriveKeyWindowConstraints opts (contract §13.1) from THIS site's existing
// machinery, with NO per-site authorization logic (the §4 validity decision now lives entirely in the
// shared module). Each opt is pure I/O:
//   verifySignature(ev) -> { ok, signerKeyId, signerNodeRepo }
//     Resolve the signer's PEM (same-node from nodeManifest, or a trustedPolicy node via the optional
//     ctx.loadNodeManifest loader) and verify the event's ed25519 signature — reusing this module's
//     canonical-hash + crypto.verify. signerNodeRepo is the repo whose node.json holds the signer key.
//   getMaintainer(keyId, nodeRepo) -> maintainer|null
//     Same-node (nodeRepo === nodeManifest.id) reads from nodeManifest; a trustedPolicy node reads via
//     ctx.loadNodeManifest. This is the node.json read surface the signer-validity check merges with
//     derivedSoFar.
//   timeOf(ev) -> trustedTime   — the OFFLINE sync trusted-time resolver (§5.2), unchanged.
//   trustedPolicy: Set<nodeRepo> — the governance floor (§4.3), supplied by the caller via ctx.
// GRANDFATHER: when ctx omits events (or there are no key-lifecycle events) the derived map is EMPTY =>
// mergeStricterWindow(m, undefined) returns the maintainer UNCHANGED => byte-identical to today.
function buildDeriveOpts(nodeManifest, ctx) {
  const c = ctx || {};
  const selfRepo = nodeManifest?.id ?? null;
  const trustedPolicy =
    c.trustedPolicy && typeof c.trustedPolicy.has === "function" ? c.trustedPolicy : new Set();
  const loadNodeManifest =
    typeof c.loadNodeManifest === "function" ? c.loadNodeManifest : () => null;

  // Resolve a maintainer object by keyId from the node.json that owns it (same-node OR a policy node).
  const maintainerIn = (manifest, keyId) =>
    (manifest?.maintainers || []).find((x) => x?.keyId === keyId) || null;
  const getMaintainer = (keyId, nodeRepo) => {
    if (nodeRepo && selfRepo && nodeRepo === selfRepo) return maintainerIn(nodeManifest, keyId);
    if (nodeRepo) return maintainerIn(loadNodeManifest(nodeRepo), keyId);
    // No nodeRepo hint: same-node first, then any trustedPolicy node.
    return (
      maintainerIn(nodeManifest, keyId) ||
      [...trustedPolicy].map((r) => maintainerIn(loadNodeManifest(r), keyId)).find(Boolean) ||
      null
    );
  };

  const verifySignature = (event) => {
    const signerKeyId = event?.signature?.keyId;
    if (typeof signerKeyId !== "string" || signerKeyId === "") return { ok: false };
    // Same-node signer (the event's own repo).
    const sameNode = maintainerIn(nodeManifest, signerKeyId);
    if (event?.repo && selfRepo && event.repo === selfRepo && sameNode?.publicKey) {
      if (verifyEventSignatureWith(event, sameNode.publicKey)) {
        return { ok: true, signerKeyId, signerNodeRepo: selfRepo };
      }
      return { ok: false };
    }
    // trustedPolicy node signer (governance).
    for (const policyRepo of trustedPolicy) {
      const psigner = maintainerIn(loadNodeManifest(policyRepo), signerKeyId);
      if (psigner?.publicKey && verifyEventSignatureWith(event, psigner.publicKey)) {
        return { ok: true, signerKeyId, signerNodeRepo: policyRepo };
      }
    }
    return { ok: false };
  };

  return {
    verifySignature,
    getMaintainer,
    timeOf: (event) => resolveTrustedSignatureTimeSync(event, c),
    trustedPolicy,
  };
}

// getPublicKeyForKeyId(nodeManifest, keyId [, ev, ctx]) — contract site 9 (§5.3 + §13.1).
//
// Bare 2-arg call (signing / non-verification paths): unchanged — finds the maintainer by keyId and
// returns its trimmed PEM, throwing on no-key exactly as before. NO time gate is applied, because
// signing is not verifying a historical signature (per the B-verifiers NOTE).
//
// Timed call (the real verification path supplies `ev` + `ctx`): AFTER the maintainer is found and
// BEFORE the key is returned, resolve the signature's trusted time OFFLINE (sync resolver, contract
// §5.2) and apply isKeyValidForSignature. On !valid, THROW carrying dec.reason — consistent with this
// function's existing throw-on-no-key contract (callers that catch a missing-key throw also catch a
// time-invalid throw). A GRANDFATHERED (window-less) maintainer is always valid => byte-identical to
// today. ev/ctx are OPTIONAL; omit them and the function behaves exactly as the pre-window version.
//
// Wave-B2 §12.1 (node.json-STRIP hardening) + Wave-B3 §13.1 (order-aware authorization): BEFORE the
// predicate, derive the window from the SIGNED, AUTHORIZED KeyRotation/KeyRevocation events in the
// ledger and merge in the MOST RESTRICTIVE of node.json + derived. The derive is now an ORDER-AWARE
// single forward pass (the consolidated §4 authorization lives in the shared module): a key-lifecycle
// event counts only if its signature verifies AND its signer is BOTH authorized (surviving same-node
// key OR trustedPolicy node) AND itself currently valid at the event's trusted time per the same
// derive-stricter predicate against STRICTLY-EARLIER events. This closes residual ③: a compromise-
// revoked key whose window was STRIPPED from node.json can no longer authorize a LATER rotation
// (its revocation precedes the rotation in ledger order => it is invalid at rotation time). The site
// supplies only I/O — verifySignature/getMaintainer/timeOf/trustedPolicy — built by buildDeriveOpts
// from nodeManifest + ctx (NO per-site authorization logic). When ctx omits events (or there are no
// key-lifecycle events for the repo) the derived map is EMPTY, so mergeStricterWindow(m, undefined)
// returns `m` UNCHANGED => GRANDFATHER stays byte-identical.
export function getPublicKeyForKeyId(nodeManifest, keyId, ev, ctx) {
  const ms = nodeManifest?.maintainers || [];
  const m = ms.find(x => x?.keyId === keyId);
  if (!m?.publicKey) throw new Error(`No maintainer publicKey for keyId=${keyId} in ${nodeManifest.id}`);
  if (ev !== undefined && ev !== null) {
    const c = ctx || {};
    // Derive-stricter (§12.1 + §13.1): the signed-event floor for THIS keyId via the order-aware
    // forward pass. No events / no verifiable signer => empty map => undefined constraint =>
    // mergeStricterWindow returns the maintainer untouched (grandfather byte-identical).
    const constraint = deriveKeyWindowConstraints(
      c.events,
      c.repo ?? ev?.repo ?? nodeManifest?.id,
      buildDeriveOpts(nodeManifest, c)
    ).get(keyId);
    const eff = mergeStricterWindow(m, constraint);
    const tt = resolveTrustedSignatureTimeSync(ev, c);
    const dec = isKeyValidForSignature(eff, tt);
    if (!dec.valid) {
      throw new Error(`Key keyId=${keyId} is not valid for this signature in ${nodeManifest.id}: ${dec.reason}`);
    }
  }
  return String(m.publicKey).trim();
}

export function computeCanonicalHash(evWithoutSignature) {
  const canon = canonicalize(evWithoutSignature);
  return crypto.createHash("sha256").update(canon, "utf8").digest("hex");
}

export function signEvent(event, privateKeyPem, keyId) {
  const ev = JSON.parse(JSON.stringify(event));
  delete ev.signature;

  const canonicalHash = computeCanonicalHash(ev);
  const sig = crypto.sign(null, Buffer.from(canonicalHash, "hex"), privateKeyPem).toString("base64");

  return {
    ...ev,
    signature: {
      alg: "ed25519",
      keyId,
      value: sig,
      canonicalHash
    }
  };
}

export function buildAttestationEvent({ repo, version, commit, artifacts, attestations, notes }) {
  return {
    type: "AttestationPublished",
    repo,
    version,
    commit,
    timestamp: new Date().toISOString(),
    artifacts: artifacts || [],
    attestations,
    notes: notes || "",
    signature: { alg: "ed25519", keyId: "", value: "", canonicalHash: "" }
  };
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

export function writeJsonlLine(outPath, obj) {
  if (!outPath) return;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.appendFileSync(outPath, JSON.stringify(obj) + "\n", "utf8");
}

export function loadSigningKeyFromEnvOrFile({ envVar = "REPOMESH_SIGNING_KEY", filePath }) {
  if (process.env[envVar]) return process.env[envVar];
  if (!filePath) throw new Error(`Missing signing key: set ${envVar} or pass --signing-key <path>`);
  return fs.readFileSync(filePath, "utf8");
}

export function getOverridesForRepo(repoId) {
  const [org, repo] = repoId.split("/");
  const p = path.join(process.cwd(), "ledger/nodes", org, repo, "repomesh.overrides.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return null; }
}
