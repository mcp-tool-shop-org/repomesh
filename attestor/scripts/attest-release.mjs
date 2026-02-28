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

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const NODES_DIR = path.join(ROOT, "ledger", "nodes");

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
  return fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function findNodeManifest(repoId) {
  const [org, repo] = repoId.split("/");
  const p = path.join(NODES_DIR, org, repo, "node.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
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

function checkSignatureChain(releaseEvent) {
  const node = findNodeManifest(releaseEvent.repo);
  if (!node) {
    return {
      kind: "signature.chain",
      result: "fail",
      reason: `Node manifest not registered for ${releaseEvent.repo}`
    };
  }

  const maintainer = node.maintainers?.find(
    (m) => m.keyId === releaseEvent.signature.keyId
  );
  if (!maintainer) {
    return {
      kind: "signature.chain",
      result: "fail",
      reason: `No maintainer with keyId="${releaseEvent.signature.keyId}" in ${releaseEvent.repo}`
    };
  }

  try {
    const stripped = JSON.parse(JSON.stringify(releaseEvent));
    delete stripped.signature;
    const canonical = JSON.stringify(canonicalize(stripped));
    const computedHash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");

    if (computedHash !== releaseEvent.signature.canonicalHash) {
      return {
        kind: "signature.chain",
        result: "fail",
        reason: "Canonical hash mismatch during re-verification"
      };
    }

    const pk = maintainer.publicKey.trim();
    const msg = Buffer.from(computedHash, "hex");
    const sig = Buffer.from(releaseEvent.signature.value, "base64");
    const ok = crypto.verify(null, msg, pk, sig);

    return {
      kind: "signature.chain",
      result: ok ? "pass" : "fail",
      reason: ok
        ? `Signature verified against ${maintainer.name} (${maintainer.keyId})`
        : "Signature verification failed"
    };
  } catch (e) {
    return {
      kind: "signature.chain",
      result: "fail",
      reason: `Verification error: ${e.message}`
    };
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
    notes: checks.map((c) => `${c.kind}: ${c.result} — ${c.reason}`).join("\n"),
    signature: { alg: "ed25519", keyId: "UNSIGNED", value: "UNSIGNED", canonicalHash: "UNSIGNED" }
  };
}

// --- main ---

const args = process.argv.slice(2);
const scanNew = args.includes("--scan-new");
const doSign = args.includes("--sign");
const repoIdx = args.indexOf("--repo");
const versionIdx = args.indexOf("--version");
const outputIdx = args.indexOf("--output");
const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;

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
} else if (repoIdx !== -1 && versionIdx !== -1) {
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

  const checks = [
    checkSbomPresent(release),
    checkProvenancePresent(release),
    checkSignatureChain(release)
  ];

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
if (outputPath) {
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
