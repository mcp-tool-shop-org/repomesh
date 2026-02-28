#!/usr/bin/env node
// RepoMesh CLI — Single entrypoint for all RepoMesh tools.
//
// Usage:
//   node tools/repomesh.mjs init --repo org/repo --profile open-source
//   node tools/repomesh.mjs register-node --repo org/repo --node-json path
//   node tools/repomesh.mjs keygen --output-dir ./keys
//   node tools/repomesh.mjs print-secrets --key-dir ./repomesh-keys/org-repo

import path from "node:path";
import fs from "node:fs";

const command = process.argv[2];

const HELP = `
RepoMesh CLI

Commands:
  init              Join the RepoMesh network (generates keys, node.json, workflow, registration PR)
  register-node     Register an existing node.json with the RepoMesh ledger
  keygen            Generate an ed25519 signing keypair
  print-secrets     Print the secrets checklist for a generated keypair
  verify-release    Verify a release's trust chain and anchor status

Quick start:
  node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source

Options for init:
  --repo <org/repo>          Target repository (required)
  --profile <id>             baseline | open-source | regulated (default: open-source)
  --target-dir <path>        Local clone of target repo (default: .)
  --ledger-repo <org/repo>   RepoMesh ledger repo (default: mcp-tool-shop-org/repomesh)
  --key-id <id>              Signing key ID (default: ci-<repo>-<year>)
  --no-pr                    Skip PR creation, print manual instructions

Options for verify-release:
  --repo <org/repo>          Target repository (required)
  --version <semver>         Release version (required)
  --anchored                 Also verify XRPL anchor inclusion
`;

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  // Forward to subcommand
  const toolsDir = import.meta.dirname;

  switch (command) {
    case "init": {
      const { initNode } = await import("./init-node.mjs");
      const args = parseArgs(process.argv.slice(1)); // skip 'node', keep rest
      if (!args.repo) {
        console.error("Error: --repo is required");
        console.error("Usage: node tools/repomesh.mjs init --repo org/repo --profile open-source");
        process.exit(1);
      }
      await initNode({
        repo: args.repo,
        profile: args.profile,
        targetDir: args["target-dir"],
        ledgerRepo: args["ledger-repo"],
        keyId: args.keyId || args["key-id"],
        noPr: Boolean(args["no-pr"])
      });
      break;
    }

    case "register-node": {
      const { registerNode } = await import("./register-node.mjs");
      const args = parseArgs(process.argv.slice(1));
      if (!args.repo || !args["node-json"]) {
        console.error("Usage: node tools/repomesh.mjs register-node --repo org/repo --node-json path");
        process.exit(1);
      }
      registerNode({
        repoId: args.repo,
        nodeJsonPath: args["node-json"],
        profileJsonPath: args["profile-json"],
        overridesJsonPath: args["overrides-json"],
        ledgerRepo: args["ledger-repo"],
        noPr: Boolean(args["no-pr"])
      });
      break;
    }

    case "keygen": {
      const { generateKeypair } = await import("./keygen.mjs");
      const args = parseArgs(process.argv.slice(1));
      const outputDir = args["output-dir"] || "./repomesh-keys";
      const result = generateKeypair(outputDir);
      if (!result) process.exit(1);
      console.log(`\nPublic key PEM (for node.json):\n${result.publicKeyPem}`);
      break;
    }

    case "verify-release": {
      const { verifyRelease } = await import("./verify-release.mjs");
      const args = parseArgs(process.argv.slice(1));
      if (!args.repo || !args.version) {
        console.error("Usage: node tools/repomesh.mjs verify-release --repo org/repo --version X.Y.Z [--anchored]");
        process.exit(1);
      }
      verifyRelease({
        repo: args.repo,
        version: args.version,
        anchored: Boolean(args.anchored)
      });
      break;
    }

    case "print-secrets": {
      const args = parseArgs(process.argv.slice(1));
      const keyDir = args["key-dir"];
      if (!keyDir) {
        console.error("Usage: node tools/repomesh.mjs print-secrets --key-dir ./repomesh-keys/org-repo");
        process.exit(1);
      }
      const privatePath = path.join(keyDir, "private.pem");
      if (!fs.existsSync(privatePath)) {
        console.error(`Private key not found at ${privatePath}`);
        process.exit(1);
      }
      const pem = fs.readFileSync(privatePath, "utf8").trim();
      console.log("\nREPOMESH_SIGNING_KEY value:\n");
      console.log(pem);
      console.log("\nREPOMESH_LEDGER_TOKEN:");
      console.log("  Create a fine-grained PAT at: https://github.com/settings/tokens?type=beta");
      console.log("  Scopes needed on the ledger repo:");
      console.log("    - Contents: Read and write");
      console.log("    - Pull requests: Read and write");
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
