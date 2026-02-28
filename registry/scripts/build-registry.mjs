#!/usr/bin/env node
// Builds registry/nodes.json and registry/capabilities.json
// from ledger/nodes/**/node.json manifests.

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
          const manifest = JSON.parse(fs.readFileSync(nodeJsonPath, "utf8"));
          results.push(manifest);
        } catch (e) {
          console.warn(`Skipping ${nodeJsonPath}: ${e.message}`);
        }
      }
    }
  }
  return results;
}

// Build nodes index
const nodes = walkNodeJsons(NODES_DIR);

const nodesIndex = nodes.map((n) => ({
  id: n.id,
  kind: n.kind,
  description: n.description || "",
  provides: n.provides || [],
  consumes: n.consumes || [],
  tags: n.tags || [],
  homepage: n.homepage || ""
}));

// Build capabilities reverse index
const capabilities = {};
for (const node of nodes) {
  for (const cap of node.provides || []) {
    if (!capabilities[cap]) capabilities[cap] = [];
    capabilities[cap].push(node.id);
  }
}

// Write outputs
fs.writeFileSync(
  path.join(REGISTRY_DIR, "nodes.json"),
  JSON.stringify(nodesIndex, null, 2) + "\n",
  "utf8"
);

fs.writeFileSync(
  path.join(REGISTRY_DIR, "capabilities.json"),
  JSON.stringify(capabilities, null, 2) + "\n",
  "utf8"
);

console.log(`Registry built: ${nodesIndex.length} node(s), ${Object.keys(capabilities).length} capability(ies).`);
