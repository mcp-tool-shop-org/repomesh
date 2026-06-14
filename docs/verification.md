# RepoMesh Verification Guide

This document explains how RepoMesh trust works and how to independently verify any release.

## How Trust Works

RepoMesh trust is built from four layers, each verifiable by anyone with a clone of the ledger.

### Layer 1: Release Events

When a repo publishes a new version, it broadcasts a signed `ReleasePublished` event to the append-only ledger. The event includes:

- Repo ID and version
- Git commit hash
- Artifact names and SHA-256 hashes
- An Ed25519 signature over the canonical JSON

The `canonicalHash` is the SHA-256 of the event body (sorted keys, deterministic JSON). The signature signs this hash. Anyone can recompute the canonical hash and verify the signature against the repo's registered public key.

### Layer 2: Attestations

Independent verifier nodes read the ledger and produce `AttestationPublished` events for each release. Each attestation is itself signed by the verifier's key. Current checks:

- `sbom.present` — release includes a CycloneDX SBOM
- `provenance.present` — release includes build provenance
- `signature.chain` — release signature re-verified by an independent node
- `license.audit` — all dependencies have allowed licenses
- `security.scan` — no known vulnerabilities in dependencies (via OSV.dev)

Each attestation carries a result: `pass`, `warn`, `fail`, or `unscored`.

- `pass` / `warn` / `fail` mean the verifier **ran** and reached that verdict.
- `unscored` means the verifier **could not run** (e.g. OSV.dev unreachable, the SBOM fetch timed out, Docker unavailable). An `unscored` result earns **zero assurance credit** and is reported as a *missing* check — a transient outage can never inflate a release's score by masquerading as a partial pass. Re-run the verifier once the dependency is reachable.

### Layer 3: Anchor Manifests

Periodically, the anchor node computes a Merkle root over all event canonical hashes since the last anchor. This produces a manifest file containing:

- `partitionId` — which events are included
- `algo` — the Merkle algorithm used for this partition (see "Merkle algorithm versions" below)
- `root` — SHA-256 Merkle root of all canonical hashes
- `prev` — previous anchor's root (forming a linked list)
- `range` — first and last canonical hash in the partition
- `count` — number of leaves
- `manifestHash` — SHA-256 of the manifest body (self-binding)

The manifest is committed to the repo and is append-only: once written, it cannot change.

#### Merkle algorithm versions (v1 → v2 migration, ANC-B03)

Each manifest records its `algo`, and verification **dispatches on the manifest's own `algo`**
field — so old and new partitions both verify against the algorithm they were sealed with.

- **`sha256-merkle-v2` (RFC-6962, the default for all NEW anchors).** Certificate-Transparency
  style domain separation: leaf hash = `SHA-256(0x00 ‖ leafBytes)`, internal node =
  `SHA-256(0x01 ‖ left ‖ right)`, and a lone odd node is **carried up unchanged** (no duplicate).
  Domain separation closes the leaf/node ambiguity and the second-preimage / duplicate-last
  weakness (CVE-2012-2459). `anchor/xrpl/scripts/compute-root.mjs` produces v2 unless you pass
  `--algo sha256-merkle-v1` to reproduce a historical partition.
- **`sha256-merkle-v1` (legacy — verify-only).** The original algorithm: no domain separation,
  and a lone odd node is **duplicated** before hashing. It is retained byte-for-byte so that
  already-anchored v1 partitions still verify, but it is **no longer used for new anchors**.
  Do not author new v1 partitions.

### Layer 4: XRPL Anchoring

The anchor node posts a self-payment on the XRP Ledger testnet with a memo containing the manifest hash and Merkle root. This creates an immutable timestamp on a public blockchain. The memo format is:

```
{v, p (partitionId), n (network), r (root), h (manifestHash), c (count), pv (prev), rg (range)}
```

Anyone can fetch the XRPL transaction, decode the memo, and verify it matches the local manifest.

## Verification Commands

You do **not** need to clone this repo to verify a release. The published CLI fetches the
public ledger for you:

```
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z
```

> For repeated or offline verification, point the CLI at a local ledger checkout with
> `--local [dir]` (default: current directory) — see "Offline / local verification" below.
> Cloning is only needed for **developing** RepoMesh itself, not for verifying releases.

### Verify a release (signature + attestations)

```
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z
```

### Verify a release with anchor proof

```
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z --anchored
```

`--anchored` proves the release's `canonicalHash` is a leaf of a partition whose Merkle root is
**recomputed locally** and matched to the committed manifest, and — when the network is reachable —
that the on-chain XRPL transaction is `validated`, succeeded (`tesSUCCESS`), was signed by a wallet
in the trusted-anchor allowlist, and carries a memo binding to the local root, manifest hash, and
leaf count. If the network is unavailable it reports `XRPL NOT verified` (never a fabricated
transaction id) and strict `--anchored` **fails**. To accept a locally-verified manifest without the
on-chain proof (e.g. fully offline verification), pass `--anchored-or-local` instead; the JSON
output then carries `anchor.xrplVerified: false` so callers can distinguish the two.

> **Important — `--anchored-or-local` is not a free pass (SB-DOCS-03).** A local-manifest-only
> PASS still requires the anchor to be a genuine independent witness: the anchor **event** must
> carry a valid signature from a node in the bundled **trusted-attestor/anchor allowlist** (the
> XRPL anchor node), and the partition Merkle root must recompute and match the committed manifest.
> An offline, self-signed, or non-allowlisted "anchor" — even one whose local manifest happens to
> recompute — is **not** a witness and will **not** flip an `UNVERIFIED` verdict to `PASS`. In other
> words, `--anchored-or-local` relaxes only the *on-chain network fetch*; it never relaxes the
> independent-witness or trusted-signer requirements. A release with no independent attestor and no
> trusted-signed anchor stays `UNVERIFIED`.

### Verify an XRPL anchor directly

```
npx @mcptoolshop/repomesh verify-anchor --tx <XRPL_TX_HASH>
```

### Output formats (for CI gates and automation)

Pick the shape your tool wants with `--format <text|json|sarif|markdown>` (`--json` is kept as an
alias for `--format json`):

```
# Machine-readable JSON (includes ok: true/false for simple pass/fail gating)
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z --anchored --format json

# SARIF 2.1.0 — uploads to the GitHub Security tab; each failing check becomes a SARIF result
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z --format sarif > repomesh.sarif

# Markdown — a check/status/reason/hint table for a job summary or PR comment
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z --format markdown
```

### Exit codes and the strictness gate (`--fail-on`)

The process exit code is derived from the tri-state verdict, so a CI step can gate on it directly:

| Exit | Meaning |
|------|---------|
| `0`  | **PASS** — verdict is PASS (or UNVERIFIED when relaxed by `--fail-on=fail`). |
| `1`  | **FAIL** — hard failure: invalid/forged/wrong-repo signature, a non-allowlisted attestor, or a required attestation whose result is `fail`. |
| `3`  | **UNVERIFIED** — soft: not-yet-anchored, no independent witness, or a required check missing-but-not-failed. |
| `2`  | Usage error or internal crash. |

`--fail-on <fail|unverified>` chooses how strict the gate is. The default is `unverified` (strict:
both FAIL and UNVERIFIED are non-zero). With `--fail-on=fail`, **UNVERIFIED returns exit 0** (the
status is still `UNVERIFIED` in the JSON and a warning is printed) — this enables incremental,
warn-mode adoption while a repo earns its first independent attestations. `PASS` is always `0` and
`FAIL` is always `1`; `--fail-on` only moves whether UNVERIFIED counts as success.

```
# Strict (default): UNVERIFIED fails the gate
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z --anchored

# Warn mode: only a hard FAIL breaks the build
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z --fail-on fail
```

### Verify many releases at once (`verify-all`)

`verify-all` loads the ledger **once** and verifies a batch, exiting with the worst row's code
(under the same `--fail-on` policy) and honoring `--format`:

```
# From a manifest — a JSON array of {repo, version} or a newline list of org/repo@version
npx @mcptoolshop/repomesh verify-all --manifest releases.json --format markdown

# Every release currently in the trust index
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail
```

### Offline / local verification (`--local`)

For air-gapped checks or repeated runs against a pinned snapshot, verify against a local ledger
checkout. `--local [dir]` (default: current directory) wins over auto-detection and skips all
network fetches:

```
git clone https://github.com/mcp-tool-shop-org/repomesh.git
npx @mcptoolshop/repomesh verify-release --repo org/repo --version X.Y.Z --local ./repomesh
```

### GitHub Action

A composite action ships under [`.github/actions/verify`](../.github/actions/verify/action.yml) so a
consumer repo can gate a release in one step — see [Using the GitHub Action](#using-the-github-action)
below.

## Using the GitHub Action

A composite action ships in this repo at `.github/actions/verify`. It shells the **pinned** published
CLI (`npx @mcptoolshop/repomesh@<version> verify-release`), maps the tri-state exit code to the job
result, writes a markdown summary to the job summary, and can upload SARIF to the Security tab. It is a
thin gate wrapper — it does not re-implement any verification logic.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `repo` | yes | — | Target repo as `org/repo`. |
| `version` | yes | — | Release version (e.g. `1.0.4`). |
| `anchored` | no | `false` | `true` to also require XRPL anchor inclusion (strict on-chain proof). |
| `fail-on` | no | `unverified` | `unverified` (strict) or `fail` (warn-mode: UNVERIFIED passes). |
| `format` | no | `text` | Run-log format: `text`, `json`, `sarif`, or `markdown`. |
| `cli-version` | no | _pinned_ | The `@mcptoolshop/repomesh` version to shell. Defaults to a pinned `X.Y.Z` for replayability. |
| `sarif` | no | `false` | `true` to write SARIF and upload it to the Security tab. |
| `sarif-file` | no | `repomesh.sarif` | Path for the SARIF report when `sarif=true`. |

### Outputs

| Output | Description |
|--------|-------------|
| `status` | The verdict: `PASS`, `FAIL`, or `UNVERIFIED`. |
| `ok` | `true` when the gate passed under the chosen `fail-on`, else `false`. |
| `exit-code` | Raw CLI exit code (`0`/`1`/`3`/`2`). |

### Example consumer workflow

Drop this in a consumer repo at `.github/workflows/verify-release.yml`. It runs on release publish,
gates on the RepoMesh verdict, and uploads SARIF. Note the **least-privilege** permissions —
`security-events: write` is only needed for the SARIF upload.

```yaml
name: verify-release
on:
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: read
  security-events: write   # only required for the SARIF upload step

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Verify RepoMesh trust chain
        id: repomesh
        uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
        with:
          repo: ${{ github.repository }}
          version: ${{ github.event.release.tag_name }}
          anchored: "true"
          fail-on: unverified        # use 'fail' for warn-mode while you earn attestations
          sarif: "true"

      - name: Show verdict
        if: always()
        run: |
          echo "RepoMesh verdict: ${{ steps.repomesh.outputs.status }} (ok=${{ steps.repomesh.outputs.ok }})"
```

> **Pinning:** pin the action by tag (`@v1`) or commit SHA, and let the action's own `cli-version`
> default pin the CLI it shells, so every run is byte-for-byte replayable.

## Trust Scores

RepoMesh produces two scores per release:

- **Integrity** (0-100): Is this release authentic? Covers: signature verification, artifact hashes, SBOM, provenance, signature chain.
- **Assurance** (0-100): Is this release safe? Covers: license compliance, vulnerability scanning. Profile-aware (different profiles require different checks).

## Threat Model

### What RepoMesh prevents

- Unsigned releases entering the network
- Tampered artifacts (hash mismatch detection)
- Undisclosed dependencies (SBOM enforcement)
- Known vulnerable dependencies (OSV.dev scanning)
- Copyleft license contamination (license audit)
- Cross-repo signer forgery (a release is only valid if signed by a key registered to its own `node.json`)
- Post-hoc tampering of anchored partitions (recomputed Merkle root + on-chain XRPL memo binding, with the anchoring wallet pinned to a trusted-account allowlist)

### What RepoMesh does not prevent

- Compromised signing keys (key rotation is the mitigation)
- Zero-day vulnerabilities (not in OSV database yet)
- Malicious code that passes all checks (requires code review)
- XRPL testnet resets (move to mainnet for production)

## Key Concepts

- **Canonical hash**: SHA-256 of the event body with sorted keys and no signature field
- **Manifest hash**: SHA-256 of the manifest body without the manifestHash field
- **Merkle root**: Pairwise SHA-256 hashing of leaves. New anchors use **v2 (RFC-6962)** with
  domain-separated leaf/node prefixes where a lone odd node is carried up unchanged; **v1 (legacy,
  verify-only)** used no domain separation and duplicated a lone odd node. Verification dispatches on
  each manifest's `algo` field — see "Merkle algorithm versions" under Layer 3.
- **Append-only**: Ledger lines and manifests are immutable once committed
- **Profile**: Defines which checks are required for a repo (baseline, open-source, regulated)
