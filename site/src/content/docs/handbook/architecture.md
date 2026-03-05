---
title: Architecture
description: Repository structure, XRPL anchoring, and the overrides system.
sidebar:
  order: 4
---

RepoMesh is a monorepo. Every component lives in a single repository with clear boundaries between concerns.

## Repository structure

```
repomesh/
  profiles/          # Trust profile definitions (baseline, open-source, regulated)
  schemas/           # JSON schemas for events, node.json, and attestations
  ledger/            # Append-only event log, partitioned by month
  attestor/          # Attestation engine — scans releases, runs verifiers, signs results
  verifiers/         # Independent verification modules (license, security, reproducibility)
  anchor/
    xrpl/            # XRPL settlement — computes Merkle roots, posts to testnet
  policy/            # Cross-repo policy definitions and enforcement
  registry/          # Flat-file registry — node metadata, trust scores, release index
  pages/             # GitHub Pages site (trust index, dashboard, anchor explorer)
  tools/             # CLI tooling (init, verify-release, broadcast)
  templates/         # Starter files for new nodes (workflows, node.json, profiles)
  site/              # This handbook (Astro + Starlight)
```

### Key directories

**`profiles/`** -- Each trust profile is a JSON file that declares required evidence and verifier configuration. Profiles are referenced by `node.json` and used by the attestor to determine what checks to run.

**`schemas/`** -- JSON Schema files for every structured document in the system. CI validates all events, node manifests, and attestations against these schemas on every push.

**`ledger/`** -- Monthly partition files (`2026-01.json`, `2026-02.json`, etc.) containing ordered arrays of signed events. Closed partitions are immutable.

**`attestor/`** -- The attestation engine. Scans for unattested `ReleasePublished` events, dispatches verifiers, aggregates results, signs and posts `AttestationPublished` events.

**`registry/`** -- Flat-file data store. No database. Contains `nodes/` (one file per registered node), `scores/` (computed trust profiles), and `releases/` (release index). Regenerated from ledger data by `registry/scripts/rebuild.mjs`.

## XRPL anchoring

RepoMesh posts Merkle roots of closed ledger partitions to the XRP Ledger testnet. This provides a tamper-evident timestamp that is independent of GitHub.

### How it works

1. **Partition closes** -- at the end of each month, the current partition becomes immutable.
2. **Merkle root** -- the settlement node computes a SHA-256 Merkle tree over all events in the partition.
3. **XRPL memo transaction** -- the Merkle root is posted as a memo in a self-payment transaction on XRPL testnet.
4. **Anchor record** -- the transaction hash and Merkle root are stored in `anchor/xrpl/anchors.json`.

### Verification path

To verify an anchor:

```bash
# Check that a partition's Merkle root matches the XRPL transaction
node anchor/xrpl/verify-anchor.mjs --partition 2026-02

# Output:
# Partition:  2026-02
# Local root: a1b2c3d4...
# XRPL root:  a1b2c3d4...
# TX hash:    ABC123...
# Status:     MATCH
```

This confirms that the ledger history for that month has not been altered since the anchor was posted. Anyone with access to the XRPL testnet can independently verify the transaction.

### Why testnet

RepoMesh uses XRPL testnet because:
- Anchoring is a proof-of-concept for tamper-evidence, not a financial operation.
- Testnet transactions are free and have no regulatory implications.
- The cryptographic properties (hash commitment, public ledger) are identical to mainnet.

Migration to mainnet is possible if the network grows to require it.

## Overrides system

The overrides system allows per-repo customization without forking RepoMesh or modifying shared configuration.

### How overrides work

Each repo can place a `.repomesh/overrides.json` file at its root. The overrides file can customize:

```json
{
  "profile": "regulated",
  "verifiers": {
    "security": {
      "ignoreAdvisories": ["GHSA-xxxx-yyyy-zzzz"],
      "severityThreshold": "high"
    },
    "license": {
      "allowedLicenses": ["MIT", "Apache-2.0", "BSD-3-Clause"]
    }
  },
  "policy": {
    "breakingChangePolicy": "warn",
    "requiredAttestors": 2
  },
  "badges": {
    "style": "flat-square"
  }
}
```

### Override precedence

1. **Profile defaults** -- base configuration from `profiles/<profile>.json`
2. **Network policy** -- global rules set by governance nodes
3. **Repo overrides** -- per-repo `.repomesh/overrides.json` (highest priority for allowed fields)

Not all fields are overridable. Security-critical settings (minimum verifier count for regulated profiles, signature requirements) cannot be weakened by overrides. The schema in `schemas/overrides.json` defines which fields accept overrides and their valid ranges.

### When to use overrides

- **Ignore a false-positive advisory** in the security verifier.
- **Restrict allowed licenses** beyond the profile default.
- **Require more attestors** than the profile minimum.
- **Customize badge appearance** for your README.
- **Set a breaking change policy** (block, warn, or ignore).

Overrides are validated by CI on every push. Invalid overrides cause the pipeline to fail with a clear error message pointing to the schema violation.
