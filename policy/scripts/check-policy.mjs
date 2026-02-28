#!/usr/bin/env node
// RepoMesh Policy Node — Enforces network-level invariants.
// Checks: semver monotonicity, artifact hash uniqueness, required capabilities.
//
// Usage:
//   node check-policy.mjs              (check all events)
//   node check-policy.mjs --repo org/repo  (check one repo)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const NODES_DIR = path.join(ROOT, "ledger", "nodes");

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

// --- policy checks ---

const violations = [];

function checkSemverMonotonicity(events) {
  // Group releases by repo, check versions are monotonically increasing by timestamp
  const byRepo = {};
  for (const ev of events) {
    if (ev.type !== "ReleasePublished") continue;
    if (!byRepo[ev.repo]) byRepo[ev.repo] = [];
    byRepo[ev.repo].push(ev);
  }

  for (const [repo, releases] of Object.entries(byRepo)) {
    // Sort by timestamp
    releases.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    for (let i = 1; i < releases.length; i++) {
      const prev = releases[i - 1];
      const curr = releases[i];
      // Strip semver pre-release/build metadata for comparison
      const prevClean = prev.version.split(/[-+]/)[0];
      const currClean = curr.version.split(/[-+]/)[0];
      if (compareSemver(currClean, prevClean) <= 0) {
        violations.push({
          type: "semver.monotonicity",
          repo,
          detail: `Version ${curr.version} is not greater than ${prev.version} (published later at ${curr.timestamp})`,
          severity: "error"
        });
      }
    }
  }
}

function checkArtifactHashUniqueness(events) {
  // No two different releases should claim the same artifact hash
  const hashMap = {}; // sha256 → { repo, version }

  for (const ev of events) {
    if (ev.type !== "ReleasePublished") continue;
    for (const art of ev.artifacts || []) {
      if (art.sha256 === "0".repeat(64)) continue; // skip placeholder hashes
      const key = art.sha256;
      if (hashMap[key]) {
        const existing = hashMap[key];
        if (existing.repo !== ev.repo || existing.version !== ev.version) {
          violations.push({
            type: "artifact.hash.collision",
            repo: ev.repo,
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
  // Registry nodes must provide at least one discovery/registry capability
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
        detail: `Registry node "${ev.repo}" has no registry/discovery capability in provides[]`,
        severity: "warning"
      });
    }
  }
}

// --- main ---

const args = process.argv.slice(2);
const repoFilter = args.indexOf("--repo") !== -1 ? args[args.indexOf("--repo") + 1] : null;

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
  process.exit(0);
}

console.log(`Found ${violations.length} violation(s):\n`);
for (const v of violations) {
  const icon = v.severity === "error" ? "\u274C" : "\u26A0\uFE0F";
  console.log(`${icon} [${v.type}] ${v.repo}`);
  console.log(`  ${v.detail}\n`);
}

// Output as JSONL for machine consumption
console.log("--- Violations (JSONL) ---");
for (const v of violations) {
  console.log(JSON.stringify(v));
}

const errors = violations.filter((v) => v.severity === "error");
if (errors.length > 0) {
  console.log(`\n${errors.length} error(s) found. Network health compromised.`);
  process.exit(2);
}
