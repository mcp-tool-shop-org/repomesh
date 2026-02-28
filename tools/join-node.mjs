#!/usr/bin/env node
// RepoMesh Join Tool — Register a repo as a network node.
//
// Usage:
//   node join-node.mjs --node-json path/to/node.json
//   node join-node.mjs --node-json path/to/node.json --pr  (also open PR)
//
// This script:
//   1. Validates node.json against the schema
//   2. Copies it to ledger/nodes/<org>/<repo>/node.json
//   3. Optionally opens a PR to register the node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = path.resolve(import.meta.dirname, "..");
const NODES_DIR = path.join(ROOT, "ledger", "nodes");
const SCHEMA_PATH = path.join(ROOT, "schemas", "node.schema.json");

const args = process.argv.slice(2);
const nodeJsonIdx = args.indexOf("--node-json");
const openPR = args.includes("--pr");

if (nodeJsonIdx === -1 || !args[nodeJsonIdx + 1]) {
  console.error("Usage: node join-node.mjs --node-json <path> [--pr]");
  process.exit(1);
}

const nodeJsonPath = path.resolve(args[nodeJsonIdx + 1]);

if (!fs.existsSync(nodeJsonPath)) {
  console.error(`File not found: ${nodeJsonPath}`);
  process.exit(1);
}

// Load and validate
const nodeJson = JSON.parse(fs.readFileSync(nodeJsonPath, "utf8"));
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(nodeJson)) {
  console.error("\u274C node.json validation failed:");
  for (const err of validate.errors) {
    console.error(`  ${err.instancePath || "/"} ${err.message}`);
  }
  process.exit(1);
}

console.log(`\u2705 node.json valid: ${nodeJson.id} (${nodeJson.kind})`);

// Check required fields
if (!nodeJson.id.includes("/")) {
  console.error("\u274C id must be org/repo format");
  process.exit(1);
}

const [org, repo] = nodeJson.id.split("/");
const destDir = path.join(NODES_DIR, org, repo);
const destPath = path.join(destDir, "node.json");

// Check if already registered
if (fs.existsSync(destPath)) {
  console.log(`\u26A0\uFE0F Node ${nodeJson.id} is already registered. Updating...`);
}

// Copy to ledger/nodes/
fs.mkdirSync(destDir, { recursive: true });
fs.writeFileSync(destPath, JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
console.log(`\u2705 Copied to ${path.relative(ROOT, destPath)}`);

// Summary
console.log(`\n  Node:       ${nodeJson.id}`);
console.log(`  Kind:       ${nodeJson.kind}`);
console.log(`  Provides:   ${(nodeJson.provides || []).join(", ")}`);
console.log(`  Consumes:   ${(nodeJson.consumes || []).join(", ") || "(none)"}`);
console.log(`  Maintainer: ${nodeJson.maintainers.map((m) => `${m.name} (${m.keyId})`).join(", ")}`);

if (openPR) {
  console.log("\nOpening PR...");
  try {
    const branch = `join/${org}/${repo}`;
    execSync(`git checkout -b ${branch}`, { cwd: ROOT, stdio: "pipe" });
    execSync(`git add ${path.relative(ROOT, destPath)}`, { cwd: ROOT, stdio: "pipe" });
    execSync(`git commit -m "join: register ${nodeJson.id} as ${nodeJson.kind} node"`, { cwd: ROOT, stdio: "pipe" });
    execSync(`git push origin ${branch}`, { cwd: ROOT, stdio: "pipe" });

    const prUrl = execSync(
      `gh pr create --title "join: ${nodeJson.id}" --body "Register ${nodeJson.id} as a ${nodeJson.kind} node in the RepoMesh network.\n\nProvides: ${(nodeJson.provides || []).join(", ")}"`,
      { cwd: ROOT, encoding: "utf8" }
    ).trim();

    console.log(`\u2705 PR created: ${prUrl}`);
  } catch (e) {
    console.error(`\u274C PR creation failed: ${e.message}`);
    console.log("You can manually commit and push the changes.");
    process.exit(1);
  }
} else {
  console.log("\nNext steps:");
  console.log("  1. git add ledger/nodes/");
  console.log("  2. git commit -m \"join: register " + nodeJson.id + "\"");
  console.log("  3. git push and open a PR");
  console.log("\n  Or re-run with --pr to automate.");
}
