#!/usr/bin/env node
// RepoMesh Init — One command to join the network.
//
// Usage:
//   node init-node.mjs --repo org/repo --profile open-source
//   node init-node.mjs --repo org/repo --profile open-source --target-dir /path/to/repo
//   node init-node.mjs --repo org/repo --profile baseline --no-pr
//
// What it does:
//   1. Generates an ed25519 keypair (prints paths; never commits private key)
//   2. Creates node.json for the target repo
//   3. Creates repomesh.profile.json + repomesh.overrides.json from templates
//   4. Creates/updates .github/workflows/repomesh-broadcast.yml
//   5. Prints the exact secrets to add
//   6. Opens a registration PR to RepoMesh (unless --no-pr)

import fs from "node:fs";
import path from "node:path";
import { generateKeypair } from "./keygen.mjs";
import { registerNode } from "./register-node.mjs";

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

export async function initNode({ repo, profile, targetDir, ledgerRepo, keyId, noPr }) {
  const [org, repoName] = repo.split("/");
  if (!org || !repoName) {
    console.error("\u274C --repo must be org/repo format");
    process.exit(1);
  }

  const profileId = profile || "open-source";
  const validProfiles = ["baseline", "open-source", "regulated"];
  if (!validProfiles.includes(profileId)) {
    console.error(`\u274C Invalid profile: ${profileId}. Choose: ${validProfiles.join(", ")}`);
    process.exit(1);
  }

  const target = targetDir || ".";
  const resolvedKeyId = keyId || `ci-${repoName}-${new Date().getFullYear()}`;
  const ledger = ledgerRepo || "mcp-tool-shop-org/repomesh";

  console.log(`\nRepoMesh Init`);
  console.log(`  Repo:    ${repo}`);
  console.log(`  Profile: ${profileId}`);
  console.log(`  KeyId:   ${resolvedKeyId}`);
  console.log(`  Target:  ${path.resolve(target)}`);
  console.log();

  // 1. Generate keypair
  const keysDir = path.join(target, "repomesh-keys", `${org}-${repoName}`);
  const keys = generateKeypair(keysDir);
  if (!keys) {
    console.error("\u274C Key generation failed. Cannot continue.");
    process.exit(1);
  }

  // 2. Create node.json
  const nodeJsonPath = path.join(target, "node.json");
  let nodeJson;

  if (fs.existsSync(nodeJsonPath)) {
    console.log(`\u2705 Existing node.json found, validating...`);
    nodeJson = JSON.parse(fs.readFileSync(nodeJsonPath, "utf8"));
    // Update public key if needed
    const maintainer = nodeJson.maintainers?.find(m => m.keyId === resolvedKeyId);
    if (!maintainer) {
      nodeJson.maintainers = nodeJson.maintainers || [];
      nodeJson.maintainers.push({
        name: org,
        keyId: resolvedKeyId,
        publicKey: keys.publicKeyPem,
        contact: ""
      });
      fs.writeFileSync(nodeJsonPath, JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
      console.log(`  Added maintainer with keyId=${resolvedKeyId}`);
    }
  } else {
    nodeJson = {
      id: repo,
      kind: "compute",
      description: "",
      provides: [`${repoName.replace(/[^a-z0-9]/g, "-")}.v1`],
      consumes: [],
      interfaces: [
        { name: `${repoName}-cli`, version: "v1", schemaPath: `./schemas/${repoName}.v1.json` }
      ],
      invariants: {
        deterministicBuild: true,
        signedReleases: true,
        semver: true,
        changelog: true
      },
      maintainers: [
        {
          name: org,
          keyId: resolvedKeyId,
          publicKey: keys.publicKeyPem,
          contact: ""
        }
      ]
    };
    fs.writeFileSync(nodeJsonPath, JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
    console.log(`\u2705 Created node.json`);
    console.log(`  \u2192 Edit the "description", "provides", and "interfaces" fields for your project`);
  }

  // 3. Create repomesh.profile.json
  const profileJsonPath = path.join(target, "repomesh.profile.json");
  const profileJson = {
    profileId,
    profileVersion: "v1",
    overridesPath: "repomesh.overrides.json"
  };
  fs.writeFileSync(profileJsonPath, JSON.stringify(profileJson, null, 2) + "\n", "utf8");
  console.log(`\u2705 Created repomesh.profile.json (profile: ${profileId})`);

  // 4. Create repomesh.overrides.json (empty starter)
  const overridesJsonPath = path.join(target, "repomesh.overrides.json");
  if (!fs.existsSync(overridesJsonPath)) {
    fs.writeFileSync(overridesJsonPath, JSON.stringify({}, null, 2) + "\n", "utf8");
    console.log(`\u2705 Created repomesh.overrides.json (empty \u2014 customize as needed)`);
  }

  // 5. Create broadcast workflow
  const workflowDir = path.join(target, ".github", "workflows");
  const workflowPath = path.join(workflowDir, "repomesh-broadcast.yml");

  // Read template from RepoMesh repo
  const templatePath = path.join(import.meta.dirname, "..", "templates", "repomesh-broadcast.yml");
  let workflowContent;

  if (fs.existsSync(templatePath)) {
    workflowContent = fs.readFileSync(templatePath, "utf8");
    // Fill in placeholders
    workflowContent = workflowContent.replace(
      /REPOMESH_KEY_ID:\s*"[^"]*"/,
      `REPOMESH_KEY_ID: "${resolvedKeyId}"`
    );
    workflowContent = workflowContent.replace(
      /REPOMESH_LEDGER_REPO:\s*"[^"]*"/,
      `REPOMESH_LEDGER_REPO: "${ledger}"`
    );
  } else {
    // Fallback: generate a minimal workflow
    workflowContent = generateMinimalBroadcast(resolvedKeyId, ledger);
  }

  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(workflowPath, workflowContent, "utf8");
  console.log(`\u2705 Created .github/workflows/repomesh-broadcast.yml`);

  // 6. Print secrets checklist
  const privateKeyPem = fs.readFileSync(keys.privatePath, "utf8").trim();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ADD THESE SECRETS TO ${repo}`);
  console.log(`${"=".repeat(60)}`);
  console.log();
  console.log(`  Secret 1: REPOMESH_SIGNING_KEY`);
  console.log(`  Value: (contents of ${keys.privatePath})`);
  console.log();
  console.log(`  ${privateKeyPem.split("\n").join("\n  ")}`);
  console.log();
  console.log(`  Secret 2: REPOMESH_LEDGER_TOKEN`);
  console.log(`  Value: GitHub PAT (fine-grained) with these scopes on ${ledger}:`);
  console.log(`    \u2022 Contents: Read and write`);
  console.log(`    \u2022 Pull requests: Read and write`);
  console.log(`    \u2022 Nothing else needed`);
  console.log();
  console.log(`  Create at: https://github.com/settings/tokens?type=beta`);
  console.log(`${"=".repeat(60)}`);

  // 7. Register with RepoMesh (open PR)
  console.log(`\n\u2192 Registering node with RepoMesh...`);
  const result = registerNode({
    repoId: repo,
    nodeJsonPath,
    profileJsonPath,
    overridesJsonPath,
    ledgerRepo: ledger,
    noPr: noPr || false
  });

  // 8. Print next steps
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  NEXT STEPS`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  1. Add the two secrets above to ${repo}`);
  console.log(`  2. Edit node.json: set description, provides, and interfaces`);
  console.log(`  3. Commit the generated files:`);
  console.log(`     git add node.json repomesh.profile.json repomesh.overrides.json .github/workflows/repomesh-broadcast.yml`);
  console.log(`  4. Cut a release (e.g., v1.0.0)`);
  console.log(`  5. Trust will converge automatically within one attestor cycle`);
  console.log();
  console.log(`  Check trust anytime:`);
  console.log(`     node registry/scripts/verify-trust.mjs --repo ${repo}`);
  console.log(`${"=".repeat(60)}\n`);

  // Add .gitignore for private keys
  const gitignorePath = path.join(target, ".gitignore");
  const gitignoreEntry = "repomesh-keys/";
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(gitignoreEntry)) {
      fs.appendFileSync(gitignorePath, `\n# RepoMesh private keys (NEVER commit)\n${gitignoreEntry}\n`, "utf8");
      console.log(`\u2705 Added repomesh-keys/ to .gitignore`);
    }
  } else {
    fs.writeFileSync(gitignorePath, `# RepoMesh private keys (NEVER commit)\n${gitignoreEntry}\n`, "utf8");
    console.log(`\u2705 Created .gitignore with repomesh-keys/`);
  }

  return { nodeJson, profileJson, keys, result };
}

function generateMinimalBroadcast(keyId, ledgerRepo) {
  return `# RepoMesh Broadcast — Release -> Ledger PR
# Generated by: node tools/repomesh.mjs init
name: repomesh-broadcast

on:
  release:
    types: [published]

env:
  REPOMESH_KEY_ID: "${keyId}"
  REPOMESH_LEDGER_REPO: "${ledgerRepo}"

jobs:
  broadcast:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - name: Hash artifacts
        run: |
          mkdir -p /tmp/repomesh
          sha256sum package.json > /tmp/repomesh/artifact-hashes.txt
      - name: Generate SBOM
        run: npm sbom --sbom-format cyclonedx > /tmp/repomesh/sbom.json 2>/dev/null || echo '{"bomFormat":"CycloneDX","specVersion":"1.4","components":[]}' > /tmp/repomesh/sbom.json
      - name: Broadcast to ledger
        env:
          SIGNING_KEY: \${{ secrets.REPOMESH_SIGNING_KEY }}
          GH_TOKEN: \${{ secrets.REPOMESH_LEDGER_TOKEN }}
        run: echo "See templates/repomesh-broadcast.yml for full implementation"
`;
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = parseArgs(process.argv);
  initNode({
    repo: args.repo,
    profile: args.profile,
    targetDir: args["target-dir"],
    ledgerRepo: args["ledger-repo"],
    keyId: args.keyId || args["key-id"],
    noPr: Boolean(args["no-pr"])
  });
}
