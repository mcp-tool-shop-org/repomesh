# RepoMesh

Syntropic repo network — append-only ledger, node manifests, and scoring for distributed repo coordination.

## What is this?

RepoMesh turns a collection of repos into a cooperative network. Each repo is a **node** with:

- A **manifest** (`node.json`) declaring what it provides and consumes
- **Signed events** broadcast to an append-only ledger
- A **registry** indexing all nodes and capabilities

The network enforces three invariants:

1. **Deterministic outputs** — same inputs, same artifacts
2. **Verifiable provenance** — every release is signed and attested
3. **Composable contracts** — interfaces are versioned and machine-readable

## Repo Structure

```
repomesh/
  schemas/                  # Source of truth for all schemas
    node.schema.json        # Node manifest schema
    event.schema.json       # Event envelope schema
  ledger/                   # Append-only signed event log
    events/events.jsonl     # The ledger itself
    nodes/                  # Registered node manifests
    scripts/                # Validation + verification tooling
  attestor/                 # Universal attestor (sbom, provenance, sig chain)
    scripts/attest-release.mjs
  policy/                   # Network policy checks (semver, hash uniqueness)
    scripts/check-policy.mjs
  registry/                 # Network index (auto-generated from ledger)
    nodes.json              # All registered nodes
    capabilities.json       # Capability → node reverse index
    trust.json              # Trust scores per release
    dependencies.json       # Dependency graph + warnings
  templates/                # Workflow templates for joining
  tools/                    # Developer UX tools
    join-node.mjs           # One command to register a node
```

## Join the Network (5 minutes)

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
```

### 4. Add the broadcast workflow

Copy `templates/repomesh-broadcast.yml` to your repo's `.github/workflows/`.
Set the `REPOMESH_LEDGER_TOKEN` secret (a PAT with repo scope on this repo).

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
cd ledger && node scripts/verify-release.mjs --repo mcp-tool-shop-org/shipcheck --version 1.0.1
```

### Attest a release

```bash
node attestor/scripts/attest-release.mjs --repo mcp-tool-shop-org/shipcheck --version 1.0.1
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

Checks: `sbom.present`, `provenance.present`, `signature.chain`

### Run policy checks

```bash
node policy/scripts/check-policy.mjs
node policy/scripts/check-policy.mjs --repo mcp-tool-shop-org/shipcheck
```

Checks: semver monotonicity, artifact hash uniqueness, required capabilities.

### Query trust

`registry/trust.json` is auto-generated and answers: "Is org/repo@version good?"

Each release gets a trust score (0-100) based on: signature (30), SBOM (20), provenance (20), signature chain (15), clean policy (15).

### Join with one command

```bash
node tools/join-node.mjs --node-json path/to/node.json
node tools/join-node.mjs --node-json path/to/node.json --pr  # also opens PR
```

## License

MIT

---

Built by [MCP Tool Shop](https://mcp-tool-shop.github.io/)
