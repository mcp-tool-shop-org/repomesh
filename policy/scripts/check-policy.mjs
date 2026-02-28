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

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const NODES_DIR = path.join(ROOT, "ledger", "nodes");

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

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
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
      if (compareSemver(currClean, prevClean) <= 0) {
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

function buildViolationEvent(v) {
  return {
    type: "PolicyViolation",
    repo: v.repo,
    version: v.version || "0.0.0",
    commit: v.commit || "0000000",
    timestamp: new Date().toISOString(),
    artifacts: [],
    attestations: [
      { type: "policy.check", uri: `repomesh:policy:${v.type}:${v.severity}` }
    ],
    notes: `[${v.type}] ${v.detail}`,
    signature: { alg: "ed25519", keyId: "UNSIGNED", value: "UNSIGNED", canonicalHash: "UNSIGNED" }
  };
}

// --- main ---

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

// Build and optionally sign violation events
const violationEvents = [];
for (const v of violations) {
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
