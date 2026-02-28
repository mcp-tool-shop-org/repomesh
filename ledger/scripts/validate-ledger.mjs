#!/usr/bin/env node
// RepoMesh Ledger Validator
// Enforces: append-only, schema-valid, signature-valid, unique events, timestamp sanity.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalizeForHash } from "./canonicalize.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");

const LEDGER_PATH = path.join(ROOT, "events", "events.jsonl");
const EVENT_SCHEMA_PATH = path.join(REPO_ROOT, "schemas", "event.schema.json");
const NODE_SCHEMA_PATH = path.join(REPO_ROOT, "schemas", "node.schema.json");
const NODES_DIR = path.join(ROOT, "nodes");

// Allow override via env (for CI: base branch comparison)
const basePath = process.env.BASE_LEDGER || "";
const headPath = process.env.HEAD_LEDGER || LEDGER_PATH;

// Timestamp sanity: reject events more than 1 hour in the future or more than 1 year in the past
const MAX_FUTURE_MS = 60 * 60 * 1000;
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

function fail(msg) {
  console.error(`\u274C ${msg}`);
  process.exit(1);
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function stripSignature(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.signature;
  return copy;
}

function computeCanonicalHash(ev) {
  const canonical = canonicalizeForHash(stripSignature(ev));
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function findNodeManifest(repoId) {
  const [org, repo] = repoId.split("/");
  const p = path.join(NODES_DIR, org, repo, "node.json");
  if (!fs.existsSync(p)) {
    fail(
      `No node manifest for ${repoId} at ${path.relative(REPO_ROOT, p)}. ` +
      `Register the repo by adding its node.json under ledger/nodes/${org}/${repo}/.`
    );
  }
  return loadJson(p);
}

function extractPublicKey(nodeManifest, keyId) {
  const maints = nodeManifest.maintainers || [];
  const m = maints.find((x) => x.keyId === keyId);

  if (!m) {
    const available = maints.map((x) => x.keyId).filter(Boolean).join(", ") || "(none)";
    fail(
      `No maintainer with keyId="${keyId}" in node.json for ${nodeManifest.id}. ` +
      `Available keyIds: ${available}`
    );
  }

  if (!m.publicKey) {
    fail(`Maintainer "${keyId}" in ${nodeManifest.id} has no publicKey.`);
  }

  const pk = String(m.publicKey).trim();
  if (!pk.includes("BEGIN PUBLIC KEY")) {
    fail(
      `Public key for ${nodeManifest.id} (keyId: ${keyId}) must be PEM format (BEGIN PUBLIC KEY). ` +
      `Update ledger/nodes/${nodeManifest.id}/node.json.`
    );
  }
  return pk;
}

function findKeyAcrossNodes(keyId) {
  // Search all registered nodes for a maintainer with the given keyId
  if (!fs.existsSync(NODES_DIR)) return null;
  const orgs = fs.readdirSync(NODES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const org of orgs) {
    const orgDir = path.join(NODES_DIR, org);
    const repos = fs.readdirSync(orgDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const repo of repos) {
      const manifestPath = path.join(orgDir, repo, "node.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = loadJson(manifestPath);
      const m = (manifest.maintainers || []).find((x) => x.keyId === keyId);
      if (m?.publicKey) {
        const pk = String(m.publicKey).trim();
        if (pk.includes("BEGIN PUBLIC KEY")) return pk;
      }
    }
  }
  return null;
}

function verifyEd25519(pubKeyPem, msgHex, sigB64) {
  const msg = Buffer.from(msgHex, "hex");
  const sig = Buffer.from(sigB64, "base64");
  return crypto.verify(null, msg, pubKeyPem, sig);
}

// --- main ---

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const eventSchema = loadJson(EVENT_SCHEMA_PATH);
const nodeSchema = loadJson(NODE_SCHEMA_PATH);
const validateEvent = ajv.compile(eventSchema);
const validateNode = ajv.compile(nodeSchema);

const headLines = readLines(headPath);
const baseLines = basePath ? readLines(basePath) : [];

// 1. Append-only check
if (baseLines.length > 0) {
  if (headLines.length < baseLines.length) {
    fail("Ledger shrank — append-only violation.");
  }
  for (let i = 0; i < baseLines.length; i++) {
    if (headLines[i] !== baseLines[i]) {
      fail(`Ledger modified at line ${i + 1}. Append-only violation.`);
    }
  }
}

const newLines = baseLines.length > 0 ? headLines.slice(baseLines.length) : headLines;
if (newLines.length === 0) {
  console.log("\u2705 No new ledger entries (append-only OK).");
  process.exit(0);
}

console.log(`Validating ${newLines.length} new event(s)...\n`);

// Build uniqueness set from existing (base) events
const seen = new Set();
for (const line of baseLines) {
  try {
    const ev = JSON.parse(line);
    seen.add(`${ev.repo}|${ev.version}|${ev.type}`);
  } catch {
    // Base lines already validated; skip parse errors
  }
}

const now = Date.now();

for (let idx = 0; idx < newLines.length; idx++) {
  const lineNo = baseLines.length + idx + 1;
  let ev;

  // Parse
  try {
    ev = JSON.parse(newLines[idx]);
  } catch (e) {
    fail(`Invalid JSON at line ${lineNo}: ${e.message}`);
  }

  // Schema validation
  if (!validateEvent(ev)) {
    fail(`Event schema failed at line ${lineNo}: ${ajv.errorsText(validateEvent.errors)}`);
  }

  // Uniqueness: (repo, version, type) must be unique across entire ledger
  const key = `${ev.repo}|${ev.version}|${ev.type}`;
  if (seen.has(key)) {
    fail(`Duplicate event at line ${lineNo}: (${ev.repo}, ${ev.version}, ${ev.type}) already exists.`);
  }
  seen.add(key);

  // Timestamp sanity
  const ts = new Date(ev.timestamp).getTime();
  if (isNaN(ts)) {
    fail(`Invalid timestamp at line ${lineNo}: ${ev.timestamp}`);
  }
  if (ts > now + MAX_FUTURE_MS) {
    fail(`Timestamp too far in the future at line ${lineNo}: ${ev.timestamp}`);
  }
  if (ts < now - MAX_AGE_MS) {
    fail(`Timestamp too old at line ${lineNo}: ${ev.timestamp} (>1 year ago)`);
  }

  // Canonical hash verification
  const computedHash = computeCanonicalHash(ev);
  if (computedHash !== ev.signature.canonicalHash) {
    fail(
      `canonicalHash mismatch at line ${lineNo}.\n` +
      `  computed: ${computedHash}\n` +
      `  ledger:   ${ev.signature.canonicalHash}`
    );
  }

  // Load + validate node manifest for the event's repo
  const node = findNodeManifest(ev.repo);
  if (!validateNode(node)) {
    fail(`node.json schema failed for ${ev.repo}: ${ajv.errorsText(validateNode.errors)}`);
  }

  // Signature verification
  // For ReleasePublished: signer must be a maintainer of the event's repo
  // For AttestationPublished/PolicyViolation: signer can be any registered node
  //   (attestors and policy nodes sign events about other repos)
  let pubKeyPem;
  const isThirdPartySigned = ["AttestationPublished", "PolicyViolation"].includes(ev.type);

  if (isThirdPartySigned) {
    pubKeyPem = findKeyAcrossNodes(ev.signature.keyId);
    if (!pubKeyPem) {
      fail(
        `No registered node has keyId="${ev.signature.keyId}" for ${ev.type} at line ${lineNo}. ` +
        `The signing key must belong to a registered network node.`
      );
    }
  } else {
    pubKeyPem = extractPublicKey(node, ev.signature.keyId);
  }

  const ok = verifyEd25519(pubKeyPem, ev.signature.canonicalHash, ev.signature.value);
  if (!ok) {
    fail(`Signature verification failed at line ${lineNo} for ${ev.repo} (keyId=${ev.signature.keyId}).`);
  }

  console.log(`  \u2705 line ${lineNo}: ${ev.type} ${ev.repo}@${ev.version} — verified`);
}

console.log(`\n\u2705 All ${newLines.length} event(s) validated. Append-only preserved. Signatures verified.`);
