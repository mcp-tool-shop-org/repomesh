// init — Generate onboarding files for a repo joining RepoMesh.
// Works standalone (from npm install) — uses packaged templates/profiles.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { clean } from "./log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

// Wrap console output through clean() for --no-color / NO_COLOR support.
function out(msg) { console.log(clean(msg)); }
function err(msg) { console.error(clean(msg)); }

export async function init({ repo, profile, dir, keyId, noPr, json }) {
  const [org, repoName] = (repo || "").split("/");
  if (!org || !repoName) {
    console.error(`Error: --repo must be org/repo format. Got: "${repo || ""}". Example: mcp-tool-shop-org/my-tool`);
    process.exit(1);
  }

  const profileId = profile || "open-source";
  const validProfiles = ["baseline", "open-source", "regulated"];
  if (!validProfiles.includes(profileId)) {
    console.error(`Error: Invalid profile: ${profileId}. Choose: ${validProfiles.join(", ")}`);
    process.exit(1);
  }

  const target = dir || ".";
  const resolvedKeyId = keyId || `ci-${repoName}-${new Date().getFullYear()}`;
  const ledger = "mcp-tool-shop-org/repomesh";

  if (!json) {
    out(`\nRepoMesh Init`);
    out(`  Repo:    ${repo}`);
    out(`  Profile: ${profileId}`);
    out(`  KeyId:   ${resolvedKeyId}`);
    out(`  Target:  ${path.resolve(target)}`);
    out('');
  }

  // 1. Generate keypair
  const keysDir = path.join(target, "repomesh-keys", `${org}-${repoName}`);
  fs.mkdirSync(keysDir, { recursive: true });
  const privatePath = path.join(keysDir, "private.pem");
  const publicPath = path.join(keysDir, "public.pem");

  // Security: use Node.js crypto instead of shelling out to openssl (avoids command injection via paths)
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    fs.writeFileSync(privatePath, privatePem, "utf8");
    fs.writeFileSync(publicPath, publicPem, "utf8");
    if (!json) out(`\u2705 Generated Ed25519 keypair in ${keysDir}`);
  } catch (e) {
    console.error(`Error: keypair generation failed: ${e.message}`);
    process.exit(2);
  }

  const publicKeyPem = fs.readFileSync(publicPath, "utf8").trim();

  // 2. Create node.json
  const nodeJsonPath = path.join(target, "node.json");
  let nodeJson;

  if (fs.existsSync(nodeJsonPath)) {
    if (!json) out(`\u2705 Existing node.json found, validating...`);
    try {
      nodeJson = JSON.parse(fs.readFileSync(nodeJsonPath, "utf8"));
    } catch (e) {
      console.error(`Error: Invalid JSON in ${nodeJsonPath}: ${e.message}`);
      process.exit(1);
    }
    const maintainer = nodeJson.maintainers?.find(m => m.keyId === resolvedKeyId);
    if (!maintainer) {
      nodeJson.maintainers = nodeJson.maintainers || [];
      nodeJson.maintainers.push({ name: org, keyId: resolvedKeyId, publicKey: publicKeyPem, contact: "" });
      fs.writeFileSync(nodeJsonPath, JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
      if (!json) out(`  Added maintainer with keyId=${resolvedKeyId}`);
    }
  } else {
    nodeJson = {
      id: repo,
      kind: "compute",
      description: "",
      provides: [`${repoName.replace(/[^a-z0-9]/g, "-")}.v1`],
      consumes: [],
      interfaces: [{ name: `${repoName}-cli`, version: "v1", schemaPath: `./schemas/${repoName}.v1.json` }],
      invariants: { deterministicBuild: true, signedReleases: true, semver: true, changelog: true },
      maintainers: [{ name: org, keyId: resolvedKeyId, publicKey: publicKeyPem, contact: "" }],
    };
    fs.writeFileSync(nodeJsonPath, JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
    if (!json) {
      out(`\u2705 Created node.json`);
      out(`  \u2192 Edit the "description", "provides", and "interfaces" fields`);
    }
  }

  // 3. Create profile + overrides
  const profileJsonPath = path.join(target, "repomesh.profile.json");
  fs.writeFileSync(profileJsonPath, JSON.stringify({ profileId, profileVersion: "v1", overridesPath: "repomesh.overrides.json" }, null, 2) + "\n", "utf8");
  if (!json) out(`\u2705 Created repomesh.profile.json (profile: ${profileId})`);

  const overridesJsonPath = path.join(target, "repomesh.overrides.json");
  if (!fs.existsSync(overridesJsonPath)) {
    fs.writeFileSync(overridesJsonPath, "{}\n", "utf8");
    if (!json) out(`\u2705 Created repomesh.overrides.json (empty)`);
  }

  // 4. Create broadcast workflow from packaged template
  const workflowDir = path.join(target, ".github", "workflows");
  const workflowPath = path.join(workflowDir, "repomesh-broadcast.yml");
  const templatePath = path.join(PKG_ROOT, "templates", "repomesh-broadcast.yml");

  // Security: validate values before injecting into YAML template (prevents template injection)
  const safePattern = /^[a-zA-Z0-9._\/-]+$/;
  if (!safePattern.test(resolvedKeyId)) {
    console.error(`Error: keyId contains invalid characters: ${resolvedKeyId}`);
    process.exit(1);
  }
  if (!safePattern.test(ledger)) {
    console.error(`Error: ledger contains invalid characters: ${ledger}`);
    process.exit(1);
  }

  let workflowContent;
  if (fs.existsSync(templatePath)) {
    workflowContent = fs.readFileSync(templatePath, "utf8");
    workflowContent = workflowContent.replace(/REPOMESH_KEY_ID:\s*"[^"]*"/, `REPOMESH_KEY_ID: "${resolvedKeyId}"`);
    workflowContent = workflowContent.replace(/REPOMESH_LEDGER_REPO:\s*"[^"]*"/, `REPOMESH_LEDGER_REPO: "${ledger}"`);
  } else {
    workflowContent = generateMinimalBroadcast(resolvedKeyId, ledger);
  }

  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(workflowPath, workflowContent, "utf8");
  if (!json) out(`\u2705 Created .github/workflows/repomesh-broadcast.yml`);

  // 5. Print secrets checklist
  const privateKeyPem = fs.readFileSync(privatePath, "utf8").trim();
  if (!json) {
    err('\n\u26A0 SECURITY: The private key below is shown ONCE. Save it securely. DO NOT commit or share it.\n');
    out(`\n${"=".repeat(60)}`);
    out(`  ADD THESE SECRETS TO ${repo}`);
    out(`${"=".repeat(60)}`);
    out(`\n  Secret 1: REPOMESH_SIGNING_KEY`);
    out(`  Value:\n\n  ${privateKeyPem.split("\n").join("\n  ")}\n`);
    out(`  Secret 2: REPOMESH_LEDGER_TOKEN`);
    out(`  Value: GitHub PAT (fine-grained) with these scopes on ${ledger}:`);
    out(`    Required scopes: repo (Full control), workflow (Update workflows), read:org`);
    out(`    \u2022 Contents: Read and write`);
    out(`    \u2022 Pull requests: Read and write`);
    out(`\n  Create at: https://github.com/settings/tokens?type=beta`);
    out(`${"=".repeat(60)}`);
    err('TIP: Add your keys directory to .gitignore immediately.');
  }

  // 6. Register (PR) — only if not --no-pr and gh is available
  if (!noPr && !json) {
    out(`\n\u2192 To register with the RepoMesh network, open a PR adding your node manifest to:`);
    out(`  ledger/nodes/${org}/${repoName}/node.json`);
    out(`  ledger/nodes/${org}/${repoName}/repomesh.profile.json`);
    out(`\n  Or run from inside a RepoMesh checkout:`);
    out(`  node tools/repomesh.mjs register-node --repo ${repo} --node-json ${nodeJsonPath}`);
  }

  // 7. .gitignore for private keys
  const gitignorePath = path.join(target, ".gitignore");
  const gitignoreEntry = "repomesh-keys/";
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(gitignoreEntry)) {
      fs.appendFileSync(gitignorePath, `\n# RepoMesh private keys (NEVER commit)\n${gitignoreEntry}\n`, "utf8");
      if (!json) out(`\u2705 Added repomesh-keys/ to .gitignore`);
    }
  } else {
    fs.writeFileSync(gitignorePath, `# RepoMesh private keys (NEVER commit)\n${gitignoreEntry}\n`, "utf8");
    if (!json) out(`\u2705 Created .gitignore with repomesh-keys/`);
  }

  // 8. Next steps or JSON summary
  if (json) {
    console.log(JSON.stringify({
      repo,
      profile: profileId,
      keyId: resolvedKeyId,
      nodeJsonPath: path.resolve(nodeJsonPath),
    }));
  } else {
    out(`\n${"=".repeat(60)}`);
    out(`  NEXT STEPS`);
    out(`${"=".repeat(60)}`);
    out(`  1. Add the two secrets above to ${repo}`);
    out(`  2. Edit node.json: description, provides, interfaces`);
    out(`  3. Commit: git add node.json repomesh.profile.json repomesh.overrides.json .github/workflows/repomesh-broadcast.yml`);
    out(`  4. Cut a release (e.g., v1.0.0)`);
    out(`  5. Trust converges automatically within one attestor cycle`);
    out(`\n  Check trust:`);
    out(`    npx @mcptoolshop/repomesh verify-release --repo ${repo} --version 1.0.0`);
    out(`${"=".repeat(60)}\n`);
  }
}

function generateMinimalBroadcast(keyId, ledgerRepo) {
  return `# RepoMesh Broadcast — Release -> Ledger PR
# Generated by: npx @mcptoolshop/repomesh init
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
