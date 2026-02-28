// init — Generate onboarding files for a repo joining RepoMesh.
// Works standalone (from npm install) — uses packaged templates/profiles.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

export async function init({ repo, profile, dir, keyId, noPr }) {
  const [org, repoName] = (repo || "").split("/");
  if (!org || !repoName) {
    console.error("Error: --repo must be org/repo format.");
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

  console.log(`\nRepoMesh Init`);
  console.log(`  Repo:    ${repo}`);
  console.log(`  Profile: ${profileId}`);
  console.log(`  KeyId:   ${resolvedKeyId}`);
  console.log(`  Target:  ${path.resolve(target)}`);
  console.log();

  // 1. Generate keypair
  const keysDir = path.join(target, "repomesh-keys", `${org}-${repoName}`);
  fs.mkdirSync(keysDir, { recursive: true });
  const privatePath = path.join(keysDir, "private.pem");
  const publicPath = path.join(keysDir, "public.pem");

  try {
    execSync(`openssl genpkey -algorithm ED25519 -out "${privatePath}"`, { stdio: "pipe" });
    execSync(`openssl pkey -in "${privatePath}" -pubout -out "${publicPath}"`, { stdio: "pipe" });
    console.log(`\u2705 Generated Ed25519 keypair in ${keysDir}`);
  } catch (e) {
    console.error("Error: openssl not found or keypair generation failed.");
    console.error("Hint: Install openssl, or generate keys manually:");
    console.error("  openssl genpkey -algorithm ED25519 -out private.pem");
    console.error("  openssl pkey -in private.pem -pubout -out public.pem");
    process.exit(2);
  }

  const publicKeyPem = fs.readFileSync(publicPath, "utf8").trim();

  // 2. Create node.json
  const nodeJsonPath = path.join(target, "node.json");
  let nodeJson;

  if (fs.existsSync(nodeJsonPath)) {
    console.log(`\u2705 Existing node.json found, validating...`);
    nodeJson = JSON.parse(fs.readFileSync(nodeJsonPath, "utf8"));
    const maintainer = nodeJson.maintainers?.find(m => m.keyId === resolvedKeyId);
    if (!maintainer) {
      nodeJson.maintainers = nodeJson.maintainers || [];
      nodeJson.maintainers.push({ name: org, keyId: resolvedKeyId, publicKey: publicKeyPem, contact: "" });
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
      interfaces: [{ name: `${repoName}-cli`, version: "v1", schemaPath: `./schemas/${repoName}.v1.json` }],
      invariants: { deterministicBuild: true, signedReleases: true, semver: true, changelog: true },
      maintainers: [{ name: org, keyId: resolvedKeyId, publicKey: publicKeyPem, contact: "" }],
    };
    fs.writeFileSync(nodeJsonPath, JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
    console.log(`\u2705 Created node.json`);
    console.log(`  \u2192 Edit the "description", "provides", and "interfaces" fields`);
  }

  // 3. Create profile + overrides
  const profileJsonPath = path.join(target, "repomesh.profile.json");
  fs.writeFileSync(profileJsonPath, JSON.stringify({ profileId, profileVersion: "v1", overridesPath: "repomesh.overrides.json" }, null, 2) + "\n", "utf8");
  console.log(`\u2705 Created repomesh.profile.json (profile: ${profileId})`);

  const overridesJsonPath = path.join(target, "repomesh.overrides.json");
  if (!fs.existsSync(overridesJsonPath)) {
    fs.writeFileSync(overridesJsonPath, "{}\n", "utf8");
    console.log(`\u2705 Created repomesh.overrides.json (empty)`);
  }

  // 4. Create broadcast workflow from packaged template
  const workflowDir = path.join(target, ".github", "workflows");
  const workflowPath = path.join(workflowDir, "repomesh-broadcast.yml");
  const templatePath = path.join(PKG_ROOT, "templates", "repomesh-broadcast.yml");

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
  console.log(`\u2705 Created .github/workflows/repomesh-broadcast.yml`);

  // 5. Print secrets checklist
  const privateKeyPem = fs.readFileSync(privatePath, "utf8").trim();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ADD THESE SECRETS TO ${repo}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\n  Secret 1: REPOMESH_SIGNING_KEY`);
  console.log(`  Value:\n\n  ${privateKeyPem.split("\n").join("\n  ")}\n`);
  console.log(`  Secret 2: REPOMESH_LEDGER_TOKEN`);
  console.log(`  Value: GitHub PAT (fine-grained) with these scopes on ${ledger}:`);
  console.log(`    \u2022 Contents: Read and write`);
  console.log(`    \u2022 Pull requests: Read and write`);
  console.log(`\n  Create at: https://github.com/settings/tokens?type=beta`);
  console.log(`${"=".repeat(60)}`);

  // 6. Register (PR) — only if not --no-pr and gh is available
  if (!noPr) {
    console.log(`\n\u2192 To register with the RepoMesh network, open a PR adding your node manifest to:`);
    console.log(`  ledger/nodes/${org}/${repoName}/node.json`);
    console.log(`  ledger/nodes/${org}/${repoName}/repomesh.profile.json`);
    console.log(`\n  Or run from inside a RepoMesh checkout:`);
    console.log(`  node tools/repomesh.mjs register-node --repo ${repo} --node-json ${nodeJsonPath}`);
  }

  // 7. .gitignore for private keys
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

  // 8. Next steps
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  NEXT STEPS`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  1. Add the two secrets above to ${repo}`);
  console.log(`  2. Edit node.json: description, provides, interfaces`);
  console.log(`  3. Commit: git add node.json repomesh.profile.json repomesh.overrides.json .github/workflows/repomesh-broadcast.yml`);
  console.log(`  4. Cut a release (e.g., v1.0.0)`);
  console.log(`  5. Trust converges automatically within one attestor cycle`);
  console.log(`\n  Check trust:`);
  console.log(`    npx @mcptoolshop/repomesh verify-release --repo ${repo} --version 1.0.0`);
  console.log(`${"=".repeat(60)}\n`);
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
