// Detect execution mode: standalone (npm install) vs dev (inside RepoMesh checkout).
import fs from "node:fs";
import path from "node:path";

/**
 * Check if cwd is inside a RepoMesh monorepo checkout.
 * Looks for the canonical directory structure.
 */
export function isRepoMeshCheckout(cwd = process.cwd()) {
  const ledger = path.join(cwd, "ledger", "events", "events.jsonl");
  const registry = path.join(cwd, "registry");
  const schemas = path.join(cwd, "schemas");
  return fs.existsSync(ledger) && fs.existsSync(registry) && fs.existsSync(schemas);
}

/**
 * Throw a friendly error if a dev-only command is run outside a checkout.
 */
export function requireRepoMeshCheckout(cmdName) {
  if (!isRepoMeshCheckout()) {
    console.error(`Error: "${cmdName}" requires a RepoMesh monorepo checkout.`);
    console.error(`Hint: Clone the repo first:`);
    console.error(`  git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh`);
    console.error(`  node tools/repomesh.mjs ${cmdName}`);
    process.exit(1);
  }
}
