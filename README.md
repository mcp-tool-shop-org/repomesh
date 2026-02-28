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
  schemas/              # Source of truth for all schemas
    node.schema.json    # Node manifest schema
    event.schema.json   # Event envelope schema
  ledger/               # Append-only signed event log
    events/events.jsonl # The ledger itself
    nodes/              # Registered node manifests
    scripts/            # Validation tooling
  registry/             # Network index (generated from ledger)
    nodes.json          # All registered nodes
    capabilities.json   # Capability → node reverse index
  templates/            # Workflow templates for joining the network
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
    { "name": "your-name", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
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

## License

MIT

---

Built by [MCP Tool Shop](https://mcp-tool-shop.github.io/)
