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

function checkSignatureChain(releaseEvent) {
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
export function computeGatedChecks(release) {
  const sbom = checkSbomPresent(release);
  const provenance = checkProvenancePresent(release);
  const signature = checkSignatureChain(release);

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

export { checkSbomPresent, checkProvenancePresent, checkSignatureChain };

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

for (const release of targets) {
  console.log(`\nAttesting: ${release.repo}@${release.version}`);

  const checks = computeGatedChecks(release);

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
