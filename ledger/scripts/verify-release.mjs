#!/usr/bin/env node
// RepoMesh Release Verifier
// Usage: node verify-release.mjs --repo org/repo --version 1.2.3

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalizeForHash } from "./canonicalize.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");

const LEDGER_PATH = path.join(ROOT, "events", "events.jsonl");
const NODES_DIR = path.join(ROOT, "nodes");

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
const [org, repoName] = repo.split("/");
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

const pubKeyPem = maintainer.publicKey.trim();
const msg = Buffer.from(found.signature.canonicalHash, "hex");
const sig = Buffer.from(found.signature.value, "base64");
const ok = crypto.verify(null, msg, pubKeyPem, sig);

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
