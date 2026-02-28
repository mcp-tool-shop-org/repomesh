# RepoMesh

Syntropic repo network — append-only ledger, node manifests, and scoring for distributed repo coordination.

## What is this?

RepoMesh turns a collection of repos into a cooperative network. Each repo is a **node** with:

- A **manifest** (`node.json`) declaring what it provides and consumes
- **Signed events** broadcast to an append-only ledger
- A **registry** indexing all nodes and capabilities
- A **profile** defining what "done" means for trust

The network enforces three invariants:

1. **Deterministic outputs** — same inputs, same artifacts
2. **Verifiable provenance** — every release is signed and attested
3. **Composable contracts** — interfaces are versioned and machine-readable

## Quick Start (1 command + 2 secrets)

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

This generates everything you need:
- `node.json` — your node manifest
- `repomesh.profile.json` — your chosen profile
- `.github/workflows/repomesh-broadcast.yml` — release broadcast workflow
- Ed25519 signing keypair (private key stays local)

Then add two secrets to your repo:
1. `REPOMESH_SIGNING_KEY` — your private key PEM (printed by init)
2. `REPOMESH_LEDGER_TOKEN` — GitHub PAT with `contents:write` + `pull-requests:write` on this repo

Cut a release. Trust converges automatically.

### Profiles

| Profile | Evidence | Assurance Checks | Use When |
|---------|----------|-----------------|----------|
| `baseline` | Optional | None required | Internal tools, experiments |
| `open-source` | SBOM + provenance | License audit + security scan | Default for OSS |
| `regulated` | SBOM + provenance | License + security + reproducibility | Compliance-critical |

### Check Trust

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Shows integrity score, assurance score, profile-aware recommendations.

### Overrides

Per-repo customization without forking verifiers:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Repo Structure

```
repomesh/
  profiles/                   # Trust profiles (baseline, open-source, regulated)
  schemas/                    # Source of truth for all schemas
    node.schema.json          # Node manifest schema
    event.schema.json         # Event envelope schema
    repomesh.profile.schema.json   # Profile selection schema
    repomesh.overrides.schema.json # Per-repo overrides schema
  ledger/                     # Append-only signed event log
    events/events.jsonl       # The ledger itself
    nodes/                    # Registered node manifests + profiles
    scripts/                  # Validation + verification tooling
  attestor/                   # Universal attestor (sbom, provenance, sig chain)
    scripts/attest-release.mjs
  verifiers/                  # Independent verifier nodes
    license/                  # License compliance scanner
    security/                 # Vulnerability scanner (OSV.dev)
  policy/                     # Network policy checks (semver, hash uniqueness)
    scripts/check-policy.mjs
  registry/                   # Network index (auto-generated from ledger)
    nodes.json                # All registered nodes
    capabilities.json         # Capability -> node reverse index
    trust.json                # Trust scores per release (integrity + assurance)
    verifiers.json            # Verifier coverage per release
    dependencies.json         # Dependency graph + warnings
  templates/                  # Workflow templates for joining
  tools/                      # Developer UX tools
    repomesh.mjs              # CLI entrypoint (init, register-node, keygen)
```

## Manual Join (5 minutes)

### 1. Create your node manifest

Add `node.json` to your repo root:

```json
{
  "id": "your-org/your-repo",
  "kind": "compute",
  "description": "What your repo does",
  "provides": ["your.capability.v1"],
  "consumes": [],
  "interfaces": [
    { "name": "your-interface", "version": "v1", "schemaPath": "./schemas/your.v1.json" }
  ],
  "invariants": {
    "deterministicBuild": true,
    "signedReleases": true,
    "semver": true,
    "changelog": true
  },
  "maintainers": [
    { "name": "your-name", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. Generate a signing keypair

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

Put the public key PEM in your `node.json` maintainers entry.
Store the private key as a GitHub repo secret (`REPOMESH_SIGNING_KEY`).

### 3. Register with the network

Open a PR to this repo adding your node manifest:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Add the broadcast workflow

Copy `templates/repomesh-broadcast.yml` to your repo's `.github/workflows/`.
Set the `REPOMESH_LEDGER_TOKEN` secret (a fine-grained PAT with contents:write + pull-requests:write on this repo).

Every release will now automatically broadcast a signed `ReleasePublished` event to the ledger.

## Ledger Rules

- **Append-only** — existing lines are immutable
- **Schema-valid** — every event validates against `schemas/event.schema.json`
- **Signature-valid** — every event is signed by a registered node maintainer
- **Unique** — no duplicate `(repo, version, type)` entries
- **Timestamp-sane** — not more than 1 hour in the future or 1 year in the past

## Event Types

| Type | When |
|------|------|
| `ReleasePublished` | A new version is released |
| `AttestationPublished` | An attestor verifies a release |
| `BreakingChangeDetected` | A breaking change is introduced |
| `HealthCheckFailed` | A node fails its own health checks |
| `DependencyVulnFound` | A vulnerability is found in dependencies |
| `InterfaceUpdated` | An interface schema changes |
| `PolicyViolation` | A network policy is violated |

## Node Kinds

| Kind | Role |
|------|------|
| `registry` | Indexes nodes and capabilities |
| `attestor` | Verifies claims (builds, compliance) |
| `policy` | Enforces rules (scoring, gating) |
| `oracle` | Provides external data |
| `compute` | Does work (transforms, builds) |
| `settlement` | Finalizes state |
| `governance` | Makes decisions |
| `identity` | Issues/verifies credentials |

## Trust & Verification

### Verify a release

```bash
node registry/scripts/verify-trust.mjs --repo mcp-tool-shop-org/shipcheck --version 1.0.4
```

### Attest a release

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

Checks: `sbom.present`, `provenance.present`, `signature.chain`

### Run verifiers

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

### Run policy checks

```bash
node policy/scripts/check-policy.mjs
```

Checks: semver monotonicity, artifact hash uniqueness, required capabilities.

## License

MIT

---

Built by [MCP Tool Shop](https://mcp-tool-shop.github.io/)
