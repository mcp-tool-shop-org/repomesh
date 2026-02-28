# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Reporting a Vulnerability

Email: **64996768+mcp-tool-shop@users.noreply.github.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Version affected
- Potential impact

### Response timeline

| Action | Target |
|--------|--------|
| Acknowledge report | 48 hours |
| Assess severity | 7 days |
| Release fix | 30 days |

## Scope

### Data touched

- **Ledger events** — append-only JSONL (`ledger/events/events.jsonl`): signed JSON objects containing repo names, versions, timestamps, attestation results
- **Node manifests** — `node.json` files declaring capabilities, interfaces, and public keys
- **Ed25519 signatures** — every event is signed; public keys are committed, private keys stay on CI runners
- **Registry JSON** — auto-generated indexes (`nodes.json`, `trust.json`, `anchors.json`, `verifiers.json`) derived from the ledger
- **XRPL testnet** — Merkle roots of ledger partitions are posted as memo data on testnet transactions (read + write)
- **GitHub API** — used by broadcast workflows to create PRs against the ledger repo (requires `contents:write` + `pull-requests:write`)

### Data NOT touched

- **Source code of member repos** — RepoMesh never clones, reads, or modifies member repo code; attestors only check metadata (SBOM presence, provenance, license files, known vulns via OSV.dev)
- **Private keys** — never transmitted, stored, or logged; they exist only in CI secrets and local key directories
- **User credentials** — no authentication system; identity is public-key based
- **Browsing or usage data** — no analytics, tracking, or user profiling

### Permissions required

| Secret | Purpose | Scope |
|--------|---------|-------|
| `REPOMESH_SIGNING_KEY` | Ed25519 private key PEM for signing ledger events | Never transmitted; used locally by CI to sign |
| `REPOMESH_LEDGER_TOKEN` | GitHub PAT for creating PRs against the ledger repo | `contents:write` + `pull-requests:write` on the ledger repo only |

### Network access

- **GitHub API** — for PR creation during broadcast (`gh pr create`)
- **XRPL testnet** — for posting and verifying anchor transactions (`xrpl.js`)
- **OSV.dev API** — used by the security verifier to check known vulnerabilities
- **No other network egress** — no telemetry, no phone-home, no analytics

### No telemetry

RepoMesh collects and sends **zero telemetry**. No usage data, no crash reports, no analytics. All data stays in the repository and on the XRPL testnet.
