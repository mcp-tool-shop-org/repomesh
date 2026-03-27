---
title: Verification
description: Verify releases, run attestations, configure CI gates, and embed trust badges.
sidebar:
  order: 3
---

Every claim in RepoMesh is independently verifiable. This page covers the four layers of verification: release checks, attestations, trust badges, and CI gates.

## Verify a release

The CLI works from anywhere -- no clone required. It fetches ledger data from GitHub automatically:

```bash
npx @mcptoolshop/repomesh verify-release \
  --repo your-org/your-repo \
  --version 1.0.0 \
  --anchored
```

This performs:
1. **Signature check** -- confirms the `ReleasePublished` event was signed by the node's registered key (Ed25519 over canonical JSON hash).
2. **Attestation check** -- finds all `AttestationPublished` events for this release and verifies each attestation signature.
3. **Anchor check** (with `--anchored`) -- confirms the event is included in an XRPL-anchored Merkle partition and verifies the manifest hash.

The command exits `0` if all checks pass, non-zero if any fail. Use `--json` for machine-readable output.

Inside a RepoMesh checkout, the CLI automatically uses local files instead of fetching remotely.

### JSON output

The `--json` flag produces structured output:

```json
{
  "ok": true,
  "repo": "your-org/your-repo",
  "version": "1.0.0",
  "release": {
    "timestamp": "2026-03-05T12:00:00.000Z",
    "commit": "abc1234...",
    "artifacts": 1,
    "canonicalHash": "5643ef...",
    "signatureValid": true,
    "signerNode": "your-org/your-repo",
    "keyId": "ci-your-repo-2026"
  },
  "attestations": [
    { "type": "sbom.present", "result": "pass", "signatureValid": true, "signerNode": "mcp-tool-shop-org/repomesh" }
  ],
  "anchor": {
    "anchored": true,
    "manifestValid": true,
    "partition": "all",
    "root": "abc123...",
    "txHash": "DEF456..."
  }
}
```

## Verify an XRPL anchor

Verify that an XRPL transaction correctly commits a ledger Merkle root:

```bash
npx @mcptoolshop/repomesh verify-anchor --tx <xrpl-transaction-hash>
```

Options:
- `--network testnet|mainnet|devnet` (default: `testnet`)
- `--ws-url <url>` -- custom XRPL WebSocket URL
- `--json` -- machine-readable output

This fetches the transaction from XRPL, decodes the memo, recomputes the Merkle root from local or remote ledger data, and confirms the roots match.

## Attest a release

Attestor nodes scan for new releases and run verifiers:

```bash
# Inside the RepoMesh checkout:
node attestor/scripts/attest-release.mjs --scan-new
```

The attestor processes all unattested releases: runs configured verifiers, collects results, signs the attestation event, and appends it to the ledger.

## Verifiers

Verifiers are independent modules that check a specific property of a release. Each verifier produces a pass/fail result.

| Verifier | Checks | Script path |
|---|---|---|
| `license` | SPDX license identifier present, compatible with declared policy | `verifiers/license/scripts/verify-license.mjs` |
| `security` | No known CVEs in direct dependencies (via OSV.dev), SBOM present | `verifiers/security/scripts/verify-security.mjs` |
| `reproducibility` | Build from source matches published artifact checksums | `verifiers/repro/scripts/verify-repro.mjs` |

Verifiers are configured per trust profile. The `baseline` profile requires no verifiers. The `open-source` profile requires `license` and `security`. The `regulated` profile requires all three.

### Run verifiers manually

```bash
# Inside the RepoMesh checkout:
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

## Policy checks

Policy nodes enforce cross-repo rules:

```bash
# Inside the RepoMesh checkout:
node policy/scripts/check-policy.mjs
```

Policy checks enforce semver monotonicity, artifact hash uniqueness, and required capabilities. Violations are recorded as `PolicyViolation` events on the ledger. They do not block releases by default, but CI gates can be configured to treat them as failures.

## Trust badges

Repos can embed trust badges from the registry. Badges are SVGs generated at `registry/badges/<org>/<repo>/`:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/your-org/your-repo/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/your-org/your-repo/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/your-org/your-repo/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/)
```

| Badge | Shows | Updates |
|---|---|---|
| **Integrity** | Signature verification status (0--100) | On every release event |
| **Assurance** | Composite attestation score (0--100) | On every attestation event |
| **Anchored** | Whether the latest partition is XRPL-anchored | On anchor settlement |

Badge SVGs are regenerated by `registry/scripts/build-badges.mjs` on every registry update.

## CI gates

Use verification output to gate deployments:

```yaml
# In your GitHub Actions workflow
- name: Check RepoMesh trust
  run: |
    RESULT=$(npx @mcptoolshop/repomesh verify-release \
      --repo ${{ github.repository }} \
      --version ${{ github.ref_name }} \
      --anchored --json)

    OK=$(echo "$RESULT" | jq -r '.ok')
    if [ "$OK" != "true" ]; then
      echo "RepoMesh verification failed"
      exit 1
    fi
```

The `--json` output includes `ok` (boolean), `release` (signature status), `attestations` (per-verifier results), and `anchor` (Merkle inclusion proof). Parse the fields you need for your gating logic.

## Check trust scores

View the computed trust profile for any registered repo:

```bash
# Inside the RepoMesh checkout:
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

This shows integrity score, assurance score, and profile-aware recommendations based on the latest ledger data.
