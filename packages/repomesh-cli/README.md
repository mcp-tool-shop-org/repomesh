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
repomesh verify-release --repo org/repo --version 1.0.0 [--anchored] [--format json]
```

In **standalone mode** (installed via npm), fetches ledger data from GitHub. In **dev mode** (inside a RepoMesh checkout, or with `--local`), reads local files.

| Flag | Description |
|------|-------------|
| `--repo` | Target repo (required) |
| `--version` | Release version (required) |
| `--anchored` | Also verify XRPL anchor inclusion (strict: requires on-chain XRPL verification) |
| `--anchored-or-local` | Like `--anchored`, but accept a locally-recomputed manifest when XRPL is unreachable. The result is flagged `xrplVerified: false`, and it still requires the anchor event to be signed by a **trusted** RepoMesh anchor node — a forged/untrusted anchor never flips the verdict to PASS. |
| `--local [dir]` | Verify against a **local** ledger checkout (default: current directory). The offline / dev path; an explicit `--local` wins over auto-detection. |
| `--fail-on <level>` | Which verdict makes the exit code non-zero: `unverified` (strict, **default** — both FAIL and UNVERIFIED are non-zero) or `fail` (UNVERIFIED returns exit 0 for warn-mode adoption; the JSON status stays `UNVERIFIED`). |
| `--format <fmt>` | Output format: `text` (default), `json`, `sarif`, or `markdown`. |
| `--json` | Alias for `--format json` (structured JSON for CI gates). |
| `--ledger-url` | Override ledger events URL |
| `--nodes-url` | Override nodes base URL |
| `--manifests-url` | Override manifests base URL |

#### Exit codes

`verify-release` (and `verify-all`) derive the process exit code from the tri-state trust verdict, so you can gate CI directly on `$?`:

| Code | Verdict | Meaning |
|------|---------|---------|
| `0` | **PASS** | Signature valid, required attestations satisfied, an independent witness present. |
| `1` | **FAIL** | Hard failure — forged/invalid/wrong-repo signature, a non-allowlisted attestor, a required attestation that reports `fail`, or a tampered anchor (manifest/root mismatch). |
| `3` | **UNVERIFIED** | Soft failure — not yet anchored, no independent witness, a required check missing-but-not-failed, or an anchor that can't be verified on-chain (offline / unsupported algo). |
| `2` | **usage / crash** | Bad arguments, release not found, unreachable ledger, or an internal error. |

`PASS` is always `0` and `FAIL` is always `1`. The only thing `--fail-on` moves is whether `UNVERIFIED` (`3`) is treated as success — `--fail-on=fail` returns `0` for `UNVERIFIED` (the status itself is unchanged) so teams can adopt incrementally in warn-mode.

#### Output formats

`--format sarif` emits a valid **SARIF 2.1.0** envelope (each `gate.failures[]` becomes a result with `ruleId`=check, `message`=reason, help=hint, `level`=error for FAIL / warning for UNVERIFIED) so it uploads to the GitHub Security tab. `--format markdown` emits a job-summary table (check / status / reason / hint) for `$GITHUB_STEP_SUMMARY` and PR comments.

### `verify-all`

Batch-verify many releases against **one** ledger load — for CI matrix gates, fleet audits, or registry sweeps.

```bash
# From a manifest (JSON array of {repo,version}, or newline list of org/repo@version)
repomesh verify-all --manifest releases.json [--format markdown]

# Or every release in the registry's trust.json
repomesh verify-all --from-registry [--fail-on fail]
```

The ledger is loaded exactly once; each release reuses the same `verify-release` verdict as a batch row. The aggregate exit code is the **worst** row's verdict under `--fail-on`. Output respects `--format` (text summary / JSON array / merged SARIF run / markdown table).

| Flag | Description |
|------|-------------|
| `--manifest <file>` | A JSON array of `{repo,version}`, or a newline list of `org/repo@version`. |
| `--from-registry` | Verify every release listed in `registry/trust.json`. |
| `--anchored` / `--anchored-or-local` | Apply anchor verification to every release. |
| `--local [dir]` | Verify against a local ledger checkout. |
| `--fail-on <level>` | `unverified` (default) or `fail`. |
| `--format <fmt>` | `text` (default), `json`, `sarif`, `markdown`. |

> **Merkle algorithm note (v1 → v2).** Anchors record which Merkle algorithm pinned their root. Historical partitions use `sha256-merkle-v1` (no domain separation, lone odd node duplicated). Newer anchors use `sha256-merkle-v2` (RFC-6962 / Certificate Transparency domain separation, lone odd node carried up unchanged — closes CVE-2012-2459). The CLI recomputes the root with the algorithm the anchor declares, so both verify correctly. If an anchor pins a **future** algorithm this build does not implement, verification fails with `unsupported merkle algo … — upgrade CLI` (distinct from a tamper `MISMATCH`); upgrade with `npm install -g @mcptoolshop/repomesh@latest`.

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
