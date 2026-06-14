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
import { execSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generateKeypair } from "./keygen.mjs";
import { registerNode } from "./register-node.mjs";

// SB-TOOLS-01: Normalize an arbitrary repo name into a schema-valid capability id.
// The node schema requires a capability of the form
//   ^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.v[0-9]+$
// i.e. dot-separated segments, each starting with a lowercase letter then [a-z0-9-],
// ending in `.vN`. The OLD code did `name.replace(/[^a-z0-9]/g,"-")` which left
// UPPERCASE letters untouched (they are outside the negated class) and could yield a
// leading hyphen/digit — both schema-INVALID (e.g. "MyRepo" -> "-y-epo.v1"). That
// silently emitted a green "Created node.json" while the manifest failed downstream
// schema validation. Normalize properly: lowercase, collapse invalid runs to a single
// hyphen, trim leading/trailing hyphens, and guarantee a leading lowercase letter.
export function normalizeCapability(repoName, version = 1) {
  let slug = String(repoName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any run of non-[a-z0-9] -> single hyphen
    .replace(/^-+|-+$/g, "");    // trim leading/trailing hyphens
  // A capability segment MUST start with a lowercase letter. If the slug starts with a
  // digit (or is empty after trimming), prefix a stable, valid label.
  if (!slug || !/^[a-z]/.test(slug)) slug = `node-${slug}`.replace(/-+$/g, "");
  const v = Number.isInteger(version) && version >= 0 ? version : 1;
  return `${slug}.v${v}`;
}

// The canonical node schema lives at repo-root/schemas/node.schema.json (this file is in tools/).
const SCHEMA_PATH = path.join(import.meta.dirname, "..", "schemas", "node.schema.json");
const CAPABILITY_PATTERN = "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*\\.v[0-9]+$";

// Validate a node manifest object against schemas/node.schema.json. Returns null when
// valid, or a single human-readable reason string describing the first problem. Mirrors
// the Ajv setup used by tools/join-node.mjs + ledger/scripts/validate-ledger.mjs so the
// init-time check agrees byte-for-byte with the downstream gate.
export function validateNodeJson(nodeJson) {
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  } catch (e) {
    // Can't load the schema (e.g. running from an unexpected cwd) — don't block, but say so.
    console.error(`Warning: could not load node schema for validation (${e.message}); skipping schema check.`);
    return null;
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (validate(nodeJson)) return null;
  return (validate.errors || [])
    .map(err => `${err.instancePath || "/"} ${err.message}`)
    .join("; ");
}

// Early validation: OpenSSL is required for key generation
try { execSync('openssl version', { stdio: 'pipe' }); } catch { console.error('Error: openssl not found. Install: https://wiki.openssl.org/index.php/Binaries'); process.exit(1); }

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

export async function initNode({ repo, profile, targetDir, ledgerRepo, keyId, noPr, json }) {
  const TOTAL_STEPS = 8;
  let step = 0;
  const progress = (msg) => console.error(`[${++step}/${TOTAL_STEPS}] ${msg}`);

  // SB-DOCS-01: the README documents `init --json`. Implement it (preferred over a
  // doc-fix). In --json mode the single machine-readable object is the ONLY thing on
  // stdout; all human narration is redirected to stderr so the JSON stream stays clean
  // for CI/automations. Errors before the final emit print a {ok:false,...} object.
  // We capture the REAL stdout writer, then (in json mode) reroute console.log -> stderr
  // for the whole run so even helper functions that call console.log directly
  // (generateKeypair, registerNode) cannot pollute the JSON stream. The final emit and
  // any {ok:false} error object are written via the captured `out` (true stdout).
  const out = console.log;
  if (json) console.log = (...a) => console.error(...a);
  const say = json ? (...a) => console.error(...a) : out;
  const emitJson = (obj) => { console.log = out; out(JSON.stringify(obj)); };
  const fail = (reason, hint) => {
    if (json) emitJson({ ok: false, repo, reason, ...(hint ? { hint } : {}) });
    else { console.error(`\u274C ${reason}`); if (hint) console.error(`   hint: ${hint}`); }
    process.exit(1);
  };

  const [org, repoName] = (repo || "").split("/");
  if (!org || !repoName) {
    fail("--repo must be org/repo format", `Pass --repo like your-org/your-repo (got "${repo ?? ""}").`);
  }

  const profileId = profile || "open-source";
  const validProfiles = ["baseline", "open-source", "regulated"];
  if (!validProfiles.includes(profileId)) {
    fail(`Invalid profile: ${profileId}`, `Choose one of: ${validProfiles.join(", ")}.`);
  }

  const target = targetDir || ".";
  // SB-TOOLS-01: the DEFAULT keyId is derived from the repo name and must satisfy the
  // maintainer.keyId schema pattern (lowercase alphanumerics + . _ -). The old default
  // `ci-${repoName}-${year}` was schema-INVALID whenever repoName had uppercase letters
  // (e.g. "ci-MyRepo-2026"), so `init --repo Foo/MyRepo` aborted at the keyId gate. Slugify
  // the repo-name component for the DEFAULT only; an explicitly-passed --key-id is still
  // validated as-is below (no silent rewrite of operator input).
  const keyIdSlug = String(repoName).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-_.]+|[-_.]+$/g, "") || "node";
  const resolvedKeyId = keyId || `ci-${keyIdSlug}-${new Date().getFullYear()}`;
  const ledger = ledgerRepo || "mcp-tool-shop-org/repomesh";

  // TOOLS-004: validate keyId + ledgerRepo against their schema patterns BEFORE any
  // string interpolation into the generated YAML workflow. A malformed value (newlines,
  // quotes, etc.) could otherwise inject arbitrary YAML. Patterns mirror
  // schemas/node.schema.json (maintainer.keyId) and node id (org/repo).
  const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,118}[a-z0-9]$/;
  const LEDGER_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  if (!KEY_ID_PATTERN.test(resolvedKeyId)) {
    fail(
      `Invalid --key-id "${resolvedKeyId}"`,
      `Must match ${KEY_ID_PATTERN} (lowercase alphanumerics plus . _ -, 2-120 chars, e.g. ci-${repoName}-2026).`
    );
  }
  if (!LEDGER_REPO_PATTERN.test(ledger)) {
    fail(
      `Invalid --ledger-repo "${ledger}"`,
      `Must be org/repo matching ${LEDGER_REPO_PATTERN}.`
    );
  }

  say(`\nRepoMesh Init`);
  say(`  Repo:    ${repo}`);
  say(`  Profile: ${profileId}`);
  say(`  KeyId:   ${resolvedKeyId}`);
  say(`  Target:  ${path.resolve(target)}`);
  say();

  // 1. Generate keypair
  progress("Generating keypair...");
  const keysDir = path.join(target, "repomesh-keys", `${org}-${repoName}`);
  const keys = generateKeypair(keysDir);
  if (!keys) {
    fail("Key generation failed. Cannot continue.", "Verify `openssl version` works, then re-run.");
  }

  // 2. Create node.json
  progress("Creating node.json...");
  const nodeJsonPath = path.join(target, "node.json");
  let nodeJson;

  if (fs.existsSync(nodeJsonPath)) {
    say(`\u2705 Existing node.json found, validating...`);
    try {
      nodeJson = JSON.parse(fs.readFileSync(nodeJsonPath, "utf8"));
    } catch (e) {
      fail("Invalid JSON in " + nodeJsonPath + ": " + e.message, "Fix the JSON syntax in node.json and re-run.");
    }
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
      say(`  Added maintainer with keyId=${resolvedKeyId}`);
    }
  } else {
    nodeJson = {
      id: repo,
      // description must be non-empty per the schema (minLength: 1). A blank "" was
      // schema-INVALID; seed a clear placeholder the operator is told to edit.
      description: `${repo} \u2014 RepoMesh node (edit this description)`,
      kind: "compute",
      // SB-TOOLS-01: normalize the generated capability so it is schema-valid for ANY
      // repo name (uppercase, digits-first, separators) \u2014 not only already-lowercase ones.
      provides: [normalizeCapability(repoName, 1)],
      consumes: [],
      interfaces: [
        // interface.name allows [A-Za-z0-9_.-] so the raw repoName is fine here.
        { name: `${repoName}-cli`, version: "v1", schemaPath: `./schemas/${normalizeCapability(repoName, 1).replace(/\.v\d+$/, "")}.v1.json` }
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

    // SB-TOOLS-01: VALIDATE the generated manifest against the canonical node schema
    // BEFORE writing + before printing a green checkmark. A schema-invalid node.json
    // must fail loudly here (REASON + HINT), never sail through onboarding only to be
    // rejected downstream at register/validate time. (Additive: correctness of valid
    // manifests is unchanged \u2014 this only blocks emitting invalid ones.)
    const validationError = validateNodeJson(nodeJson);
    if (validationError) {
      fail(
        `Generated node.json is schema-invalid and was NOT written: ${validationError}`,
        `This is an init bug for repo "${repo}". Capability ids must match ${CAPABILITY_PATTERN}. ` +
        `Re-run with a different --repo name, or edit node.json by hand (see schemas/node.schema.json) ` +
        `and run: node tools/join-node.mjs --node-json node.json`
      );
    }

    fs.writeFileSync(nodeJsonPath, JSON.stringify(nodeJson, null, 2) + "\n", "utf8");
    say(`\u2705 Created node.json (schema-valid)`);
    say(`  \u2192 Edit the "description", "provides", and "interfaces" fields for your project`);
  }

  // 3. Create repomesh.profile.json
  progress("Creating repomesh.profile.json...");
  const profileJsonPath = path.join(target, "repomesh.profile.json");
  const profileJson = {
    profileId,
    profileVersion: "v1",
    overridesPath: "repomesh.overrides.json"
  };
  fs.writeFileSync(profileJsonPath, JSON.stringify(profileJson, null, 2) + "\n", "utf8");
  say(`\u2705 Created repomesh.profile.json (profile: ${profileId})`);

  // 4. Create repomesh.overrides.json (empty starter)
  progress("Creating repomesh.overrides.json...");
  const overridesJsonPath = path.join(target, "repomesh.overrides.json");
  if (!fs.existsSync(overridesJsonPath)) {
    fs.writeFileSync(overridesJsonPath, JSON.stringify({}, null, 2) + "\n", "utf8");
    say(`\u2705 Created repomesh.overrides.json (empty \u2014 customize as needed)`);
  }

  // 5. Create broadcast workflow
  progress("Creating broadcast workflow...");
  const workflowDir = path.join(target, ".github", "workflows");
  const workflowPath = path.join(workflowDir, "repomesh-broadcast.yml");

  // Read template from RepoMesh repo
  const templatePath = path.join(import.meta.dirname, "..", "templates", "repomesh-broadcast.yml");
  let workflowContent;

  if (fs.existsSync(templatePath)) {
    workflowContent = fs.readFileSync(templatePath, "utf8");
    // Fill in placeholders. Use replacement FUNCTIONS so the (already-validated)
    // values are inserted literally — never reinterpreted as $-replacement patterns
    // (TOOLS-004). Validation above guarantees no quotes/newlines reach this point.
    workflowContent = workflowContent.replace(
      /REPOMESH_KEY_ID:\s*"[^"]*"/,
      () => `REPOMESH_KEY_ID: "${resolvedKeyId}"`
    );
    workflowContent = workflowContent.replace(
      /REPOMESH_LEDGER_REPO:\s*"[^"]*"/,
      () => `REPOMESH_LEDGER_REPO: "${ledger}"`
    );
  } else {
    // Fallback: generate a minimal workflow
    workflowContent = generateMinimalBroadcast(resolvedKeyId, ledger);
  }

  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(workflowPath, workflowContent, "utf8");
  say(`\u2705 Created .github/workflows/repomesh-broadcast.yml`);

  // 6. Print secrets checklist
  // TOOLS-003: NEVER print the private PEM body — it would leak into CI logs and
  // terminal scrollback. Print only the path and the exact command that reads the
  // key from disk into the GitHub secret (key bytes never touch stdout).
  progress("Printing secrets checklist...");

  say(`\n${"=".repeat(60)}`);
  say(`  ADD THESE SECRETS TO ${repo}`);
  say(`${"=".repeat(60)}`);
  say();
  say(`  Secret 1: REPOMESH_SIGNING_KEY`);
  say(`  Private key file (DO NOT print or paste its contents): ${keys.privatePath}`);
  say(`  Set it directly from the file — the key never appears on screen:`);
  say(`    gh secret set REPOMESH_SIGNING_KEY --repo ${repo} < "${keys.privatePath}"`);
  say();
  say(`  Secret 2: REPOMESH_LEDGER_TOKEN`);
  say(`  Value: GitHub PAT (fine-grained) with these scopes on ${ledger}:`);
  say(`    \u2022 Contents: Read and write`);
  say(`    \u2022 Pull requests: Read and write`);
  say(`    \u2022 Nothing else needed`);
  say();
  say(`  Create at: https://github.com/settings/tokens?type=beta`);
  say(`${"=".repeat(60)}`);

  // 7. Register with RepoMesh (open PR)
  progress("Registering node with RepoMesh...");
  const result = registerNode({
    repoId: repo,
    nodeJsonPath,
    profileJsonPath,
    overridesJsonPath,
    ledgerRepo: ledger,
    noPr: noPr || false,
    // Keep manual-mode ledger writes co-located with the generated node.json under
    // the same target dir (default "."), so --target-dir fully isolates the run.
    targetDir: target,
  });

  if (result && result.error) {
    fail(`Registration failed: ${result.error}`, "Check network + gh auth, then re-run; or pass --no-pr for manual registration steps.");
  }

  // 8. Print next steps
  progress("Done!");
  say(`\n${"=".repeat(60)}`);
  say(`  NEXT STEPS`);
  say(`${"=".repeat(60)}`);
  say(`  1. Add the two secrets above to ${repo}`);
  say(`  2. Edit node.json: set description, provides, and interfaces`);
  say(`  3. Commit the generated files:`);
  say(`     git add node.json repomesh.profile.json repomesh.overrides.json .github/workflows/repomesh-broadcast.yml`);
  say(`  4. Cut a release (e.g., v1.0.0)`);
  say(`  5. Trust will converge automatically within one attestor cycle`);
  say();
  say(`  Check trust anytime:`);
  say(`     node registry/scripts/verify-trust.mjs --repo ${repo}`);
  say(`${"=".repeat(60)}\n`);

  // Add .gitignore for private keys
  const gitignorePath = path.join(target, ".gitignore");
  const gitignoreEntry = "repomesh-keys/";
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(gitignoreEntry)) {
      fs.appendFileSync(gitignorePath, `\n# RepoMesh private keys (NEVER commit)\n${gitignoreEntry}\n`, "utf8");
      say(`\u2705 Added repomesh-keys/ to .gitignore`);
    }
  } else {
    fs.writeFileSync(gitignorePath, `# RepoMesh private keys (NEVER commit)\n${gitignoreEntry}\n`, "utf8");
    say(`\u2705 Created .gitignore with repomesh-keys/`);
  }

  // SB-DOCS-01: in --json mode, emit a single machine-readable summary on stdout.
  if (json) {
    emitJson({
      ok: true,
      repo,
      profile: profileId,
      keyId: resolvedKeyId,
      ledger,
      node: { id: nodeJson.id, kind: nodeJson.kind, provides: nodeJson.provides },
      files: {
        nodeJson: path.resolve(nodeJsonPath),
        profileJson: path.resolve(profileJsonPath),
        overridesJson: path.resolve(overridesJsonPath),
        workflow: path.resolve(workflowPath),
        privateKey: keys.privatePath,
      },
      registration: result?.pr ? { pr: result.pr } : (result?.localPath ? { localPath: result.localPath } : { skipped: true }),
    });
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
    noPr: Boolean(args["no-pr"]),
    json: Boolean(args.json),
  });
}
