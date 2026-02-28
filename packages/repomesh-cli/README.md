<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/repomesh/readme.png" width="400" alt="RepoMesh">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/repomesh"><img src="https://img.shields.io/npm/v/@mcptoolshop/repomesh" alt="npm"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/repomesh/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

Trust infrastructure for repo networks. Verify releases, check XRPL anchors, and onboard repos — all from the command line.

## Quick Start

```bash
# Verify a release (works from anywhere — no clone needed)
npx @mcptoolshop/repomesh verify-release \
  --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored

# Verify an XRPL anchor transaction
npx @mcptoolshop/repomesh verify-anchor --tx <txHash>

# Onboard a repo to the network
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source

# Diagnose your repo's integration
npx @mcptoolshop/repomesh doctor --dir .
```

## Commands

### `verify-release`

Verify a release's full trust chain: signature, attestations, and optional XRPL anchor proof.

```bash
repomesh verify-release --repo org/repo --version 1.0.0 [--anchored] [--json]
```

In **standalone mode** (installed via npm), fetches ledger data from GitHub. In **dev mode** (inside a RepoMesh checkout), reads local files.

| Flag | Description |
|------|-------------|
| `--repo` | Target repo (required) |
| `--version` | Release version (required) |
| `--anchored` | Also verify XRPL anchor inclusion |
| `--json` | Structured JSON output (for CI gates) |
| `--ledger-url` | Override ledger events URL |
| `--nodes-url` | Override nodes base URL |
| `--manifests-url` | Override manifests base URL |

### `verify-anchor`

Verify an XRPL anchor transaction by recomputing the Merkle root from ledger data.

```bash
repomesh verify-anchor --tx <hash> [--network testnet] [--json]
```

### `init`

Generate all onboarding files for a repo joining the RepoMesh network.

```bash
repomesh init --repo your-org/your-repo [--profile open-source] [--dir .]
```

Creates: `node.json`, `repomesh.profile.json`, `repomesh.overrides.json`, `.github/workflows/repomesh-broadcast.yml`, and an Ed25519 signing keypair.

### `doctor`

Validate your local repo's RepoMesh configuration against schemas.

```bash
repomesh doctor [--dir .] [--repo org/repo] [--json]
```

Checks: node.json schema, profile schema, overrides schema, broadcast workflow, .gitignore for keys.

## Standalone vs Dev Mode

| Mode | Detection | Data source |
|------|-----------|-------------|
| **Standalone** | Default (npm install) | Fetches from GitHub raw URLs |
| **Dev** | Inside a RepoMesh checkout | Reads local `ledger/`, `registry/`, etc. |

Dev mode is auto-detected when `ledger/events/events.jsonl`, `registry/`, and `schemas/` exist in the working directory.

## What Verification Proves

When `verify-release --anchored` passes, you know:

1. The release event exists in the ledger and its Ed25519 signature is valid
2. All attestations (SBOM, provenance, license, security) are signed and present
3. The release is included in a Merkle partition whose root is posted to the XRPL testnet
4. The partition's manifest hash matches the on-chain memo

What it does **not** prove: that the code does what it claims, that the SBOM is complete, or that the security scan found all vulnerabilities. Trust is multi-dimensional — scores reflect evidence, not guarantees.

## Security

No telemetry. No analytics. No phone-home. Network access is limited to GitHub raw URLs (for ledger data) and XRPL WebSocket (for anchor verification). See [SECURITY.md](https://github.com/mcp-tool-shop-org/repomesh/blob/main/SECURITY.md).

## License

MIT

---

Built by [MCP Tool Shop](https://mcp-tool-shop.github.io/)
