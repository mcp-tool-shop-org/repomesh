---
title: Verification
description: Verify releases, run attestations, configure CI gates, and embed trust badges.
sidebar:
  order: 3
---

Every claim in RepoMesh is independently verifiable. This page covers the four layers of verification: release checks, attestations, trust badges, and CI gates.

## Verify a release

One command checks everything:

```bash
node tools/repomesh.mjs verify-release \
  --repo your-org/your-repo \
  --version 1.0.0 \
  --anchored
```

This performs:
1. **Signature check** -- confirms the `ReleasePublished` event was signed by the node's registered key.
2. **Attestation check** -- confirms at least one `AttestationPublished` event references this release.
3. **Anchor check** (with `--anchored`) -- confirms the event's partition Merkle root is recorded on XRPL testnet.

The command exits `0` if all checks pass, `1` if any fail. Use `--json` for machine-readable output.

## Attest a release

Attestor nodes scan for new releases and run verifiers against them:

```bash
# Scan for unattested releases and run all configured verifiers
node attestor/scan-new.mjs

# Attest a specific release
node attestor/attest.mjs --repo your-org/your-repo --version 1.0.0
```

The attestor runs each configured verifier, collects results, computes a composite score, signs the attestation event, and posts it to the ledger.

## Verifiers

Verifiers are independent modules that check a specific property of a release. Each verifier produces a pass/fail result with a confidence score.

| Verifier | Checks | Output |
|---|---|---|
| `license` | SPDX license identifier present, compatible with declared policy | Pass/fail + license ID |
| `security` | No known CVEs in direct dependencies, SBOM present | Pass/fail + CVE list |
| `reproducibility` | Build from source matches published artifact checksums | Pass/fail + diff summary |

Verifiers are configured per trust profile. The `baseline` profile requires no verifiers. The `open-source` profile requires `license` and `security`. The `regulated` profile requires all three.

### Run verifiers manually

```bash
# Run the license verifier
node verifiers/license.mjs --repo your-org/your-repo --version 1.0.0

# Run the security verifier
node verifiers/security.mjs --repo your-org/your-repo --version 1.0.0

# Run all verifiers for a profile
node verifiers/run-all.mjs --repo your-org/your-repo --version 1.0.0 --profile open-source
```

## Policy checks

Policy nodes enforce cross-repo rules. Run policy checks with:

```bash
# Check for breaking changes between versions
node policy/check-breaking.mjs --repo your-org/your-repo --from 0.9.0 --to 1.0.0

# Run all policy checks
node policy/check-all.mjs --repo your-org/your-repo --version 1.0.0
```

Policy violations are recorded as `PolicyViolation` events on the ledger. They do not block releases by default, but CI gates can be configured to treat them as failures.

## Trust badges

Embed trust badges in your README to surface verification status:

```markdown
![Integrity](https://mcp-tool-shop-org.github.io/repomesh/badges/integrity/your-org/your-repo.svg)
![Assurance](https://mcp-tool-shop-org.github.io/repomesh/badges/assurance/your-org/your-repo.svg)
![Anchored](https://mcp-tool-shop-org.github.io/repomesh/badges/anchored/your-org/your-repo.svg)
```

| Badge | Shows | Updates |
|---|---|---|
| **Integrity** | Signature verification status (0--100) | On every release event |
| **Assurance** | Composite attestation score (0--100) | On every attestation event |
| **Anchored** | Whether the latest partition is XRPL-anchored | On anchor settlement |

Badge SVGs are regenerated on every registry update. Scores reflect the latest verified state.

## CI gates

Use verification output to gate deployments:

```yaml
# In your GitHub Actions workflow
- name: Check trust score
  run: |
    RESULT=$(node tools/repomesh.mjs verify-release \
      --repo ${{ github.repository }} \
      --version ${{ github.ref_name }} \
      --json)

    INTEGRITY=$(echo "$RESULT" | jq '.integrity')
    ASSURANCE=$(echo "$RESULT" | jq '.assurance')

    if [ "$INTEGRITY" -lt 80 ] || [ "$ASSURANCE" -lt 60 ]; then
      echo "Trust score below threshold"
      exit 1
    fi
```

The `--json` output includes:

```json
{
  "repo": "your-org/your-repo",
  "version": "1.0.0",
  "integrity": 100,
  "assurance": 85,
  "anchored": true,
  "attestations": 3,
  "verifiers": {
    "license": "pass",
    "security": "pass"
  }
}
```
