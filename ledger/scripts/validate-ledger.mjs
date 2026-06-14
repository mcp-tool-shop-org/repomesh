#!/usr/bin/env node
// RepoMesh Ledger Validator
// Enforces: append-only (immutability), schema-valid, signature-valid, attestor authorization,
// unique events, timestamp sanity.
//
// Immutability is enforced INDEPENDENT of BASE_LEDGER (LDG-001): when BASE_LEDGER is set we do the
// classic base/head prefix comparison; in addition (and unconditionally) we verify every committed
// XRPL anchor manifest's Merkle root against the actual ledger events, so a reorder/deletion of any
// anchored event is caught even by the documented local `npm run validate:ledger`.

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
// NODES_DIR is env-overridable (matches policy/check-policy.mjs) so the validator is testable.
const NODES_DIR = process.env.REPOMESH_NODES_PATH || path.join(ROOT, "nodes");
// Verifier policy is the source of truth for the trusted-attestor allowlist (D2).
const VERIFIER_POLICY_PATH =
  process.env.REPOMESH_VERIFIER_POLICY_PATH || path.join(REPO_ROOT, "verifier.policy.json");
// Committed anchor manifests pin partition Merkle roots for unconditional immutability (LDG-001).
const MANIFESTS_DIR =
  process.env.REPOMESH_MANIFESTS_PATH || path.join(REPO_ROOT, "anchor", "xrpl", "manifests");

// Directory names under nodes/ that are NOT real org dirs (fixtures, scaffolding) — LDG-006.
const FIXTURE_DIRS = new Set(["a", "fixtures", "__fixtures__", "test", "tests", "example", "examples"]);

// Allow override via env (for CI: base branch comparison)
const basePath = process.env.BASE_LEDGER || "";
const headPath = process.env.HEAD_LEDGER || LEDGER_PATH;

// Timestamp sanity: reject events more than 1 hour in the future or more than 1 year in the past
const MAX_FUTURE_MS = 60 * 60 * 1000;
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// LDG-004: reject interior blank / whitespace-only lines. Only a single trailing newline is allowed.
function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.length === 0) return [];
  // Strip exactly one trailing newline (\n or \r\n) — everything else must be a real line.
  const body = raw.replace(/\r?\n$/, "");
  if (body.length === 0) return [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, "").trim().length === 0) {
      fail(
        `Interior blank/whitespace-only line at ${path.relative(REPO_ROOT, filePath)}:${i + 1}. ` +
        `The ledger must contain one JSON event per line with only a single trailing newline.`
      );
    }
  }
  return lines.map((l) => l.replace(/\r$/, ""));
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.error(`⚠️  ${msg}`);
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

const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/; // path traversal guard

// --- LDG-002: ONE shared key-builder for base-seeding AND head-checking ---------------------
// For AttestationPublished the key is the composite of the sorted (type::uri) attestation pairs,
// so independent verifiers can attest different dimensions AND legitimately-distinct anchors
// (different txHash in the uri) do not collide, while a byte-identical re-publish does.
function attestationCompositeKey(e) {
  const list = Array.isArray(e.attestations) ? e.attestations : [];
  const pairs = list
    .map((a) => {
      if (!a || typeof a.type !== "string") return "";
      const type = a.type.trim();
      const uri = typeof a.uri === "string" ? a.uri.trim() : "";
      return `${type}::${uri}`;
    })
    .filter(Boolean)
    .sort();
  return pairs.join("|") || "none";
}

function buildEventKey(ev) {
  if (ev.type === "AttestationPublished") {
    return `${ev.repo}|${ev.version}|AttestationPublished|${attestationCompositeKey(ev)}`;
  }
  return `${ev.repo}|${ev.version}|${ev.type}`;
}

function findNodeManifest(repoId) {
  const [org, repo] = repoId.split("/");
  if (!org || !repo || !SAFE_SEGMENT.test(org) || !SAFE_SEGMENT.test(repo)) {
    fail(`Invalid repoId "${repoId}": org and repo must match /^[a-zA-Z0-9_.-]+$/.`);
  }
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

// Enumerate every registered node manifest, skipping fixture dirs (LDG-006).
function listNodeManifests() {
  if (!fs.existsSync(NODES_DIR)) return [];
  const out = [];
  const orgs = fs
    .readdirSync(NODES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !FIXTURE_DIRS.has(d.name))
    .map((d) => d.name);
  for (const org of orgs) {
    const orgDir = path.join(NODES_DIR, org);
    const repos = fs
      .readdirSync(orgDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !FIXTURE_DIRS.has(d.name))
      .map((d) => d.name);
    for (const repo of repos) {
      const manifestPath = path.join(orgDir, repo, "node.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        out.push({ id: `${org}/${repo}`, manifest: loadJson(manifestPath) });
      } catch (e) {
        fail(`Invalid JSON in node manifest ${path.relative(REPO_ROOT, manifestPath)}: ${e.message}`);
      }
    }
  }
  return out;
}

// D2 + LDG-007: resolve the verifying key for a third-party event from a TRUSTED, correctly-kinded
// node whose maintainer advertises this keyId. Fails on: not-allowlisted signer, wrong kind, or
// keyId collision across trusted nodes (ambiguous resolution).
function resolveTrustedKey(keyId, eventType, allowlist, allowedKinds) {
  const matches = [];
  for (const { id, manifest } of listNodeManifests()) {
    if (!allowlist.has(id)) continue;
    if (!allowedKinds.has(manifest.kind)) continue;
    const m = (manifest.maintainers || []).find((x) => x.keyId === keyId);
    if (m?.publicKey) {
      const pk = String(m.publicKey).trim();
      if (pk.includes("BEGIN PUBLIC KEY")) {
        // LDG-006: every maintainer key must be attributable to a non-empty contact.
        if (!m.contact || String(m.contact).trim().length === 0) {
          return {
            error:
              `Maintainer "${keyId}" in trusted node ${id} has an empty contact. ` +
              `Every maintainer key must have an attributable contact.`,
          };
        }
        matches.push({ id, pk });
      }
    }
  }
  if (matches.length === 0) {
    return {
      error:
        `No TRUSTED ${eventType} signer advertises keyId="${keyId}". ` +
        `The signing key must belong to a node in verifier.policy.json's ` +
        `${eventType === "PolicyViolation" ? "trustedPolicy" : "trustedAttestors"} allowlist ` +
        `whose kind is one of {${[...allowedKinds].join(", ")}}.`,
    };
  }
  if (matches.length > 1) {
    return {
      error:
        `keyId="${keyId}" collides across multiple trusted nodes ` +
        `(${matches.map((x) => x.id).join(", ")}). keyIds must resolve to a single node ` +
        `for ${eventType} — give each node its own keyId.`,
    };
  }
  return { pk: matches[0].pk, signerNode: matches[0].id };
}

function verifyEd25519(pubKeyPem, msgHex, sigB64) {
  const msg = Buffer.from(msgHex, "hex");
  const sig = Buffer.from(sigB64, "base64");
  try {
    return crypto.verify(null, msg, pubKeyPem, sig);
  } catch (e) {
    console.error("Signature verification error: " + e.message);
    return false;
  }
}

// --- LDG-001: immutability via committed anchor manifests (Merkle-root inclusion) -----------
// v1 Merkle: leaf = the event's canonicalHash bytes; internal node = sha256(left || right);
// a lone odd node is duplicated (sha256-merkle-v1, byte-identical to anchor/xrpl/scripts/merkle.mjs).
function merkleRootV1(leavesHex) {
  let level = leavesHex.map((h) => Buffer.from(h, "hex"));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(crypto.createHash("sha256").update(Buffer.concat([left, right])).digest());
    }
    level = next;
  }
  return level[0].toString("hex");
}

function loadManifests() {
  if (!fs.existsSync(MANIFESTS_DIR)) return [];
  return fs
    .readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "all.json")
    .map((f) => {
      try {
        return { file: f, manifest: loadJson(path.join(MANIFESTS_DIR, f)) };
      } catch (e) {
        fail(`Invalid JSON in anchor manifest ${f}: ${e.message}`);
      }
    });
}

// For each committed manifest, find the contiguous slice of ledger events whose canonicalHash
// range + count match, recompute the v1 Merkle root, and assert it equals manifest.root.
function verifyAnchorManifests(events) {
  const manifests = loadManifests();
  if (manifests.length === 0) {
    warn("No anchor manifests found — immutability is only enforced via BASE_LEDGER prefix check.");
    return;
  }
  const hashes = events.map((e) => e?.signature?.canonicalHash);
  let verified = 0;
  for (const { file, manifest } of manifests) {
    if (manifest.algo && manifest.algo !== "sha256-merkle-v1") {
      // v2 manifests are handled by the anchor domain; skip here (non-destructive).
      continue;
    }
    const { range, count, root } = manifest;
    if (!Array.isArray(range) || range.length !== 2 || typeof root !== "string") {
      fail(`Anchor manifest ${file} is malformed (range/root missing).`);
    }
    const start = hashes.indexOf(range[0]);
    if (start === -1) {
      fail(
        `Immutability violation: anchor manifest ${file} pins a partition starting at ` +
        `canonicalHash ${range[0]} which is no longer present in the ledger.`
      );
    }
    const slice = hashes.slice(start, start + count);
    if (slice.length !== count || slice.some((h) => !h)) {
      fail(`Immutability violation: anchor manifest ${file} partition (count=${count}) is truncated.`);
    }
    if (slice[slice.length - 1] !== range[1]) {
      fail(
        `Immutability violation: anchor manifest ${file} partition end ${range[1]} does not match ` +
        `the ledger (events were reordered or replaced).`
      );
    }
    const computed = merkleRootV1(slice);
    if (computed !== root) {
      fail(
        `Immutability violation: anchor manifest ${file} Merkle root mismatch.\n` +
        `  manifest.root: ${root}\n  recomputed:    ${computed}\n` +
        `  An anchored event was modified, reordered, or removed.`
      );
    }
    verified++;
  }
  if (verified > 0) {
    console.log(`✅ ${verified} anchor manifest(s) verified — anchored partitions are immutable.`);
  }
}

// --- main ---

console.error("[validate] Loading schemas...");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const eventSchema = loadJson(EVENT_SCHEMA_PATH);
const nodeSchema = loadJson(NODE_SCHEMA_PATH);
const validateEvent = ajv.compile(eventSchema);
const validateNode = ajv.compile(nodeSchema);

// Load the trusted-attestor allowlist (D2). Absence is a hard error — there is no implicit trust.
let verifierPolicy = {};
if (fs.existsSync(VERIFIER_POLICY_PATH)) {
  try {
    verifierPolicy = loadJson(VERIFIER_POLICY_PATH);
  } catch (e) {
    fail(`Invalid JSON in verifier policy ${path.relative(REPO_ROOT, VERIFIER_POLICY_PATH)}: ${e.message}`);
  }
} else {
  fail(
    `Verifier policy not found at ${path.relative(REPO_ROOT, VERIFIER_POLICY_PATH)}. ` +
    `It defines trustedAttestors/trustedPolicy — third-party events cannot be authorized without it.`
  );
}
const trustedAttestors = new Set(verifierPolicy.trustedAttestors || []);
const trustedPolicy = new Set(verifierPolicy.trustedPolicy || verifierPolicy.trustedAttestors || []);
// Nodes that may sign attestations: dedicated attestor nodes plus the network registry (which
// bootstraps attestations + anchors at genesis). PolicyViolation may be signed by policy/registry.
const ATTESTOR_KINDS = new Set(["attestor", "registry"]);
const POLICY_KINDS = new Set(["policy", "registry"]);

const headLines = readLines(headPath);
const baseLines = basePath ? readLines(basePath) : [];
console.error(`[validate] Base: ${baseLines.length} events, Head: ${headLines.length} events`);

// 1. Append-only check (prefix comparison when a base is supplied)
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

// 1b. Immutability INDEPENDENT of BASE_LEDGER (LDG-001): verify committed anchor manifests against
// the FULL head ledger. This runs even when BASE_LEDGER is unset (the documented local path).
const allHeadEvents = [];
for (let i = 0; i < headLines.length; i++) {
  try {
    allHeadEvents.push(JSON.parse(headLines[i]));
  } catch (e) {
    fail(`Invalid JSON at line ${i + 1}: ${e.message}`);
  }
}
verifyAnchorManifests(allHeadEvents);

const newLines = baseLines.length > 0 ? headLines.slice(baseLines.length) : headLines;
if (newLines.length === 0) {
  console.log("✅ No new ledger entries (append-only OK).");
  process.exit(0);
}

console.error(`[validate] Checking ${newLines.length} events...`);
console.log(`Validating ${newLines.length} new event(s)...\n`);

// Build uniqueness set from existing (base) events using the SAME key-builder (LDG-002).
const seen = new Set();
for (const line of baseLines) {
  try {
    const ev = JSON.parse(line);
    seen.add(buildEventKey(ev));
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

  // Uniqueness via the shared key-builder (LDG-002)
  const key = buildEventKey(ev);
  if (seen.has(key)) {
    fail(`Duplicate event at line ${lineNo}: key="${key}" already exists.`);
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

  // D6: warn (do not reject) when an sbom attestation lacks a sha256 digest (grandfather old events;
  // new ones SHOULD carry it — verifiers refuse to award trust credit without it).
  for (const att of ev.attestations || []) {
    if (att && att.type === "sbom" && !att.sha256) {
      warn(
        `line ${lineNo}: sbom attestation has no sha256 digest — verifiers will not award trust ` +
        `credit (D6). New events should bind the SBOM by digest.`
      );
    }
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

  // Signature verification
  console.error(`[validate] Verifying signature for line ${lineNo}...`);
  // For ReleasePublished (and any non-third-party type): signer must be a maintainer of the event's
  //   OWN repo (repo-bound).
  // For AttestationPublished/PolicyViolation: signer must be a TRUSTED, correctly-kinded node
  //   (D2 allowlist) and the keyId must resolve to exactly one such node (LDG-007).
  let pubKeyPem;
  const isThirdPartySigned = ["AttestationPublished", "PolicyViolation"].includes(ev.type);

  if (isThirdPartySigned) {
    const allowlist = ev.type === "PolicyViolation" ? trustedPolicy : trustedAttestors;
    const kinds = ev.type === "PolicyViolation" ? POLICY_KINDS : ATTESTOR_KINDS;
    const resolved = resolveTrustedKey(ev.signature.keyId, ev.type, allowlist, kinds);
    if (resolved.error) {
      fail(`${resolved.error} (line ${lineNo})`);
    }
    pubKeyPem = resolved.pk;
  } else {
    // Repo-bound: load + validate the event's own repo node manifest.
    const node = findNodeManifest(ev.repo);
    if (!validateNode(node)) {
      fail(`node.json schema failed for ${ev.repo}: ${ajv.errorsText(validateNode.errors)}`);
    }
    // LDG-006: every maintainer must carry a non-empty contact.
    for (const m of node.maintainers || []) {
      if (!m.contact || String(m.contact).trim().length === 0) {
        fail(
          `Maintainer "${m.keyId}" in ${ev.repo} node.json has an empty contact. ` +
          `Every maintainer key must have an attributable contact.`
        );
      }
    }
    pubKeyPem = extractPublicKey(node, ev.signature.keyId);
  }

  const ok = verifyEd25519(pubKeyPem, ev.signature.canonicalHash, ev.signature.value);
  if (!ok) {
    fail(`Signature verification failed at line ${lineNo} for ${ev.repo} (keyId=${ev.signature.keyId}).`);
  }

  console.log(`  ✅ line ${lineNo}: ${ev.type} ${ev.repo}@${ev.version} — verified`);
}

console.log(`\n✅ All ${newLines.length} event(s) validated. Append-only preserved. Signatures verified.`);
