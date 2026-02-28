#!/usr/bin/env node
// RepoMesh Dependency Graph — Generates registry/dependencies.json
// Maps: node → consumed capabilities → which nodes provide them.
// Exposes role redundancy and unmet dependencies.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const NODES_DIR = path.join(ROOT, "ledger", "nodes");
const REGISTRY_DIR = path.join(ROOT, "registry");

function walkNodeJsons(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const org of fs.readdirSync(dir)) {
    const orgDir = path.join(dir, org);
    if (!fs.statSync(orgDir).isDirectory()) continue;

    for (const repo of fs.readdirSync(orgDir)) {
      const nodeJsonPath = path.join(orgDir, repo, "node.json");
      if (fs.existsSync(nodeJsonPath)) {
        try {
          results.push(JSON.parse(fs.readFileSync(nodeJsonPath, "utf8")));
        } catch (e) {
          console.warn(`Skipping ${nodeJsonPath}: ${e.message}`);
        }
      }
    }
  }
  return results;
}

const nodes = walkNodeJsons(NODES_DIR);

// Build capability → providers map
const providers = {};
for (const node of nodes) {
  for (const cap of node.provides || []) {
    if (!providers[cap]) providers[cap] = [];
    providers[cap].push(node.id);
  }
}

// Build dependency graph
const graph = [];
const warnings = [];

for (const node of nodes) {
  const deps = [];

  for (const cap of node.consumes || []) {
    const resolvedTo = providers[cap] || [];
    deps.push({
      capability: cap,
      providers: resolvedTo
    });

    if (resolvedTo.length === 0) {
      warnings.push({
        type: "unmet.dependency",
        node: node.id,
        capability: cap,
        detail: `${node.id} consumes "${cap}" but no node provides it`
      });
    }
  }

  graph.push({
    id: node.id,
    kind: node.kind,
    consumes: deps
  });
}

// Check for role redundancy (multiple nodes providing exact same capability set)
const capSets = {};
for (const node of nodes) {
  const key = (node.provides || []).sort().join(",");
  if (!capSets[key]) capSets[key] = [];
  capSets[key].push(node.id);
}

for (const [caps, nodeIds] of Object.entries(capSets)) {
  if (nodeIds.length > 1 && caps.length > 0) {
    warnings.push({
      type: "role.redundancy",
      nodes: nodeIds,
      capabilities: caps.split(","),
      detail: `Nodes ${nodeIds.join(", ")} provide identical capability sets`
    });
  }
}

// Write output
const output = {
  graph,
  warnings,
  stats: {
    totalNodes: nodes.length,
    totalCapabilities: Object.keys(providers).length,
    unmetDependencies: warnings.filter((w) => w.type === "unmet.dependency").length,
    roleRedundancies: warnings.filter((w) => w.type === "role.redundancy").length
  }
};

fs.writeFileSync(
  path.join(REGISTRY_DIR, "dependencies.json"),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(`Dependency graph built: ${output.stats.totalNodes} node(s), ${output.stats.totalCapabilities} capability(ies).`);

if (warnings.length > 0) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) {
    console.log(`  \u26A0\uFE0F [${w.type}] ${w.detail}`);
  }
}
