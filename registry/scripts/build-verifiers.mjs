#!/usr/bin/env node
// RepoMesh Verifier Index — Generates registry/verifiers.json
// Lists attestor nodes, their checks, last run times, and per-release coverage.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const NODES_DIR = path.join(ROOT, "ledger", "nodes");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const REGISTRY_DIR = path.join(ROOT, "registry");

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function walkNodes() {
  const nodes = [];
  if (!fs.existsSync(NODES_DIR)) return nodes;
  const orgs = fs.readdirSync(NODES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  for (const org of orgs) {
    const orgDir = path.join(NODES_DIR, org);
    const repos = fs.readdirSync(orgDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    for (const repo of repos) {
      const p = path.join(orgDir, repo, "node.json");
      if (fs.existsSync(p)) {
        nodes.push(JSON.parse(fs.readFileSync(p, "utf8")));
      }
    }
  }
  return nodes;
}

// Known assurance check types
const ASSURANCE_CHECKS = ["license.audit", "security.scan", "repro.build"];

function checksForNode(node) {
  const checks = [];
  for (const cap of node.provides || []) {
    for (const check of ASSURANCE_CHECKS) {
      if (cap.startsWith(check.replace(".", "."))) checks.push(check);
    }
  }
  return [...new Set(checks)];
}

function lastRunForVerifier(node, events) {
  const keyIds = new Set((node.maintainers || []).map(m => m.keyId).filter(Boolean));
  let last = null;
  for (const ev of events) {
    if (ev?.type !== "AttestationPublished") continue;
    if (!keyIds.has(ev?.signature?.keyId)) continue;
    // Check that this event contains attestation types the verifier provides
    const nodeChecks = checksForNode(node);
    const evTypes = (ev.attestations || []).map(a => a.type);
    const isRelevant = nodeChecks.some(c => evTypes.includes(c));
    if (!isRelevant) continue;

    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : 0;
    if (!last || ts > last.ts) last = { ts, timestamp: ev.timestamp };
  }
  return last?.timestamp || null;
}

const allNodes = walkNodes();
const events = readEvents();

// Only attestor nodes
const verifierNodes = allNodes.filter(n => n.kind === "attestor");

// Build coverage map: per (repo, version), which assurance checks completed
const coverage = {};
for (const ev of events) {
  if (ev?.type !== "AttestationPublished") continue;
  const repo = ev.repo;
  const version = ev.version;
  const ats = Array.isArray(ev.attestations) ? ev.attestations : [];
  const types = ats.map(a => a?.type).filter(Boolean);

  if (!coverage[repo]) coverage[repo] = {};
  if (!coverage[repo][version]) coverage[repo][version] = [];

  for (const t of types) {
    if (ASSURANCE_CHECKS.includes(t) && !coverage[repo][version].includes(t)) {
      coverage[repo][version].push(t);
    }
  }
}

const output = {
  verifiers: verifierNodes.map(n => ({
    id: n.id,
    description: n.description || "",
    checks: checksForNode(n),
    lastRun: lastRunForVerifier(n, events)
  })),
  coverage
};

fs.writeFileSync(
  path.join(REGISTRY_DIR, "verifiers.json"),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(`Verifier index built: ${output.verifiers.length} verifier(s), ${Object.keys(coverage).length} repo(s) covered.`);
for (const v of output.verifiers) {
  console.log(`  ${v.id}: checks=[${v.checks.join(", ")}], lastRun=${v.lastRun || "never"}`);
}
