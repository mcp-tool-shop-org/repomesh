#!/usr/bin/env node
// RepoMesh Policy Node — Enforces network-level invariants.
// Checks: semver monotonicity, artifact hash uniqueness, required capabilities.
//
// Usage:
//   node check-policy.mjs              (check all events)
//   node check-policy.mjs --repo org/repo  (check one repo)
//   node check-policy.mjs --sign --output /tmp/violations.jsonl
//     (sign violations with REPOMESH_SIGNING_KEY + REPOMESH_KEY_ID, write to file)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = process.env.REPOMESH_LEDGER_PATH || path.join(ROOT, "ledger", "events", "events.jsonl");
const NODES_DIR = process.env.REPOMESH_NODES_PATH || path.join(ROOT, "ledger", "nodes");

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
  const lines = fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]));
    } catch (e) {
      console.error(`Warning: skipping bad JSONL at line ${i + 1} in ${LEDGER_PATH}: ${e.message}`);
    }
  }
  return events;
}

function findNodeManifest(repoId) {
  const [org, repo] = repoId.split("/");
  const p = path.join(NODES_DIR, org, repo, "node.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error("Invalid JSON in " + p + ": " + e.message);
    return null;
  }
}

// Returns -1 | 0 | 1 for an orderable pair, or NaN when either side has a non-integer segment.
// LDG-005: a non-integer segment is NOT silently coerced to 0 (which would fabricate an ordering
// and emit a bogus monotonicity verdict). Callers must treat NaN as "unorderable — skip".
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i];
    const y = pb[i];
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      console.error(`Warning: skipping semver comparison "${a}" vs "${b}" — non-integer segment.`);
      return NaN;
    }
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

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

// --- policy checks ---

const violations = [];

function checkSemverMonotonicity(events) {
  const byRepo = {};
  for (const ev of events) {
    if (ev.type !== "ReleasePublished") continue;
    if (!byRepo[ev.repo]) byRepo[ev.repo] = [];
    byRepo[ev.repo].push(ev);
  }

  for (const [repo, releases] of Object.entries(byRepo)) {
    releases.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    for (let i = 1; i < releases.length; i++) {
      const prev = releases[i - 1];
      const curr = releases[i];
      const prevClean = prev.version.split(/[-+]/)[0];
      const currClean = curr.version.split(/[-+]/)[0];
      const cmp = compareSemver(currClean, prevClean);
      if (Number.isNaN(cmp)) continue; // unorderable (malformed version) — already warned, skip
      if (cmp <= 0) {
        violations.push({
          type: "semver.monotonicity",
          repo,
          version: curr.version,
          commit: curr.commit,
          detail: `Version ${curr.version} is not greater than ${prev.version} (published later at ${curr.timestamp})`,
          severity: "error"
        });
      }
    }
  }
}

function checkArtifactHashUniqueness(events) {
  const hashMap = {};

  for (const ev of events) {
    if (ev.type !== "ReleasePublished") continue;
    for (const art of ev.artifacts || []) {
      if (art.sha256 === "0".repeat(64)) continue;
      const key = art.sha256;
      if (hashMap[key]) {
        const existing = hashMap[key];
        if (existing.repo !== ev.repo || existing.version !== ev.version) {
          violations.push({
            type: "artifact.hash.collision",
            repo: ev.repo,
            version: ev.version,
            commit: ev.commit,
            detail: `Artifact "${art.name}" (${key.slice(0, 12)}...) collides with ${existing.repo}@${existing.version}`,
            severity: "warning"
          });
        }
      } else {
        hashMap[key] = { repo: ev.repo, version: ev.version };
      }
    }
  }
}

function checkRegistryNodeCapabilities(events) {
  for (const ev of events) {
    if (ev.type !== "ReleasePublished") continue;
    const node = findNodeManifest(ev.repo);
    if (!node || node.kind !== "registry") continue;

    const hasDiscovery = node.provides?.some(
      (p) => p.includes("registry") || p.includes("discovery") || p.includes("index")
    );
    if (!hasDiscovery) {
      violations.push({
        type: "registry.capability.missing",
        repo: ev.repo,
        version: ev.version,
        commit: ev.commit,
        detail: `Registry node "${ev.repo}" has no registry/discovery capability in provides[]`,
        severity: "warning"
      });
    }
  }
}

// --- build PolicyViolation event ---

// SPC-A-001: PolicyViolation is in the schema's release-shaped enum, so it inherits
// `required: [version, commit, artifacts, attestations]` AND `artifacts minItems:1`.
// An empty `artifacts: []` makes EVERY violation event schema-invalid, so the ledger
// validator rejects it and a genuine violation (e.g. a semver downgrade) can never be
// recorded — the entire enforcement path is silently dead. Fix at the emitter: every
// violation event carries exactly one schema-valid artifact that *describes the
// violation itself* (a content-addressed, verifiable receipt), so the event validates
// and the enforcement path is live.
function buildViolationArtifact(v) {
  // The artifact is the violation descriptor itself, content-addressed by sha256 of its
  // canonical JSON. This yields a deterministic, schema-valid `^[0-9a-f]{64}$` digest and
  // makes the receipt tamper-evident: anyone can recompute the digest from the descriptor.
  const descriptor = canonicalize({
    type: v.type,
    repo: v.repo,
    version: v.version || "0.0.0",
    commit: v.commit || "0000000",
    severity: v.severity,
    detail: v.detail,
  });
  const canonical = JSON.stringify(descriptor);
  const sha256 = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return {
    name: `policy-violation:${v.type}`,
    sha256,
    uri: `repomesh:policy-violation:${v.type}:${v.severity}`,
  };
}

function buildViolationEvent(v) {
  return {
    type: "PolicyViolation",
    repo: v.repo,
    version: v.version || "0.0.0",
    commit: v.commit || "0000000",
    timestamp: new Date().toISOString(),
    artifacts: [buildViolationArtifact(v)],
    attestations: [
      { type: "policy.check", uri: `repomesh:policy:${v.type}:${v.severity}` }
    ],
    notes: `[${v.type}] ${v.detail}`,
    signature: { alg: "ed25519", keyId: "UNSIGNED", value: "UNSIGNED", canonicalHash: "UNSIGNED" }
  };
}

// --- exports (SPC-A-005: importable for the schema-roundtrip regression test) ---
// Exporting the emitters lets the test build + sign a real violation event and assert it
// validates against schemas/event.schema.json — the regression guard proving enforcement
// is live. The CLI body below only runs when this file is executed directly, not on import.
export { buildViolationEvent, buildViolationArtifact, signEvent, canonicalize };

// --- main (CLI) ---
// Guard: only run the CLI when invoked directly (`node check-policy.mjs ...`), never on
// import. Without this, importing the module for tests would execute the whole pipeline
// (and `process.exit`) as a side effect.
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
const args = process.argv.slice(2);
const repoFilter = args.indexOf("--repo") !== -1 ? args[args.indexOf("--repo") + 1] : null;
const doSign = args.includes("--sign");
const outputIdx = args.indexOf("--output");
const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;

let events = readEvents();
if (repoFilter) {
  events = events.filter((ev) => ev.repo === repoFilter);
}

console.log(`Checking ${events.length} event(s)${repoFilter ? ` for ${repoFilter}` : ""}...\n`);

checkSemverMonotonicity(events);
checkArtifactHashUniqueness(events);
checkRegistryNodeCapabilities(events);

if (violations.length === 0) {
  console.log("\u2705 No policy violations found.");
  if (outputPath) {
    fs.writeFileSync(outputPath, "", "utf8");
  }
  process.exit(0);
}

console.log(`Found ${violations.length} violation(s):\n`);
for (const v of violations) {
  const icon = v.severity === "error" ? "\u274C" : "\u26A0\uFE0F";
  console.log(`${icon} [${v.type}] ${v.repo}`);
  console.log(`  ${v.detail}\n`);
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

// Build and optionally sign violation events (errors only — warnings are logged but not ledgered)
const violationEvents = [];
for (const v of violations) {
  if (v.severity !== "error") continue;
  let ev = buildViolationEvent(v);
  if (doSign) {
    ev = signEvent(ev, signingKey, signingKeyId);
  }
  violationEvents.push(ev);
}

if (outputPath) {
  const lines = violationEvents.map((ev) => JSON.stringify(ev)).join("\n") + "\n";
  fs.writeFileSync(outputPath, lines, "utf8");
  console.log(`${violationEvents.length} violation event(s) written to ${outputPath}`);
} else {
  console.log("--- Violations (JSONL) ---");
  for (const v of violations) {
    console.log(JSON.stringify(v));
  }
}

const errors = violations.filter((v) => v.severity === "error");
if (errors.length > 0) {
  console.log(`\n${errors.length} error(s) found. Network health compromised.`);
  process.exit(2);
}
} // end isDirectRun (CLI) guard
