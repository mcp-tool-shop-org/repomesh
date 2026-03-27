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
  profiles/              # Trust profile definitions (baseline, open-source, regulated)
  schemas/               # JSON schemas for events, node manifests, profiles, overrides
  ledger/                # Append-only signed event log
    events/events.jsonl  # The ledger itself (one JSON event per line)
    nodes/               # Registered node manifests and profiles
    scripts/             # Validation + verification tooling
  attestor/              # Attestation engine -- scans releases, runs verifiers, signs results
    scripts/             # attest-release.mjs
  verifiers/             # Independent verification modules
    license/             # License compliance scanner
    security/            # Vulnerability scanner (OSV.dev)
    repro/               # Reproducibility verifier
  anchor/
    xrpl/                # XRPL settlement -- Merkle roots + testnet posting
      manifests/         # Committed partition manifests (append-only)
      scripts/           # compute-root, post-anchor, verify-anchor
  policy/                # Cross-repo policy checks (semver, hash uniqueness)
    scripts/             # check-policy.mjs
  registry/              # Flat-file network index (auto-generated from ledger)
    nodes.json           # All registered nodes
    trust.json           # Trust scores per release (integrity + assurance)
    anchors.json         # Anchor index (partitions + release anchoring)
    badges/              # SVG trust badges per org/repo
    snippets/            # Markdown verification snippets per repo
    scripts/             # build-registry, build-badges, build-trust, etc.
  pages/                 # Static site generator (GitHub Pages trust index)
  packages/
    repomesh-cli/        # npm CLI package (@mcptoolshop/repomesh)
  tools/                 # Legacy CLI tooling (init, verify-release, etc.)
  templates/             # Starter files for new nodes (workflow YAML, node.json)
  site/                  # This handbook (Astro + Starlight)
```

### Key directories

**`profiles/`** -- Each trust profile (`baseline.json`, `open-source.json`, `regulated.json`) declares required evidence and verifier configuration. Profiles are referenced by `repomesh.profile.json` and used by the attestor to determine what checks to run.

**`schemas/`** -- JSON Schema files for structured documents: `event.schema.json` (all event types), `node.schema.json` (node manifests), `repomesh.profile.schema.json`, and `repomesh.overrides.schema.json`. CI validates events and manifests against these schemas on every push.

**`ledger/`** -- The append-only event log lives at `ledger/events/events.jsonl` as a single JSONL file. Each line is one complete signed event. Registered node manifests and profiles are stored under `ledger/nodes/<org>/<repo>/`.

**`attestor/`** -- The attestation engine. Scans for unattested `ReleasePublished` events, dispatches verifiers, aggregates results, signs and posts `AttestationPublished` events.

**`registry/`** -- Flat-file data store. No database. Contains `nodes.json`, `trust.json`, `anchors.json`, `capabilities.json`, `dependencies.json`, `metrics.json`, `verifiers.json`, `timeline.json`, plus `badges/` (SVG per org/repo) and `snippets/` (markdown per repo). Regenerated from ledger data by `registry/scripts/build-registry.mjs` and related scripts.

**`packages/repomesh-cli/`** -- The published npm package (`@mcptoolshop/repomesh`). Contains the `verify-release`, `verify-anchor`, `init`, and `doctor` commands that work standalone (no clone required).

## XRPL anchoring

RepoMesh posts Merkle roots of ledger event partitions to the XRP Ledger testnet. This provides a tamper-evident timestamp that is independent of GitHub.

### How it works

1. **Partition defined** -- the settlement node defines a partition scope (e.g., all events, or events since the last anchor).
2. **Merkle root** -- a SHA-256 Merkle tree is computed over all `canonicalHash` values in the partition.
3. **Manifest created** -- a partition manifest records the root, count, range, partition ID, and a `manifestHash` (SHA-256 of the canonical manifest minus the hash itself).
4. **XRPL memo transaction** -- the root and manifest hash are posted as a `repomesh-anchor-v1` memo in a self-payment transaction on XRPL testnet.
5. **Anchor record** -- the transaction hash, Merkle root, and manifest path are recorded in the ledger as an `AttestationPublished` event with a `ledger.anchor` attestation type.

### Verification path

Verify an anchor from anywhere:

```bash
npx @mcptoolshop/repomesh verify-anchor --tx <xrpl-transaction-hash>
```

This:
1. Fetches the XRPL transaction and decodes the `repomesh-anchor-v1` memo.
2. Loads ledger events (locally or from GitHub).
3. Recomputes the Merkle root from the partition's canonical hashes.
4. Confirms the local root matches the XRPL-committed root.
5. Recomputes and verifies the manifest hash.

Anyone with access to the XRPL network can independently verify the transaction.

### Why testnet

RepoMesh uses XRPL testnet because:
- Anchoring is a proof-of-concept for tamper-evidence, not a financial operation.
- Testnet transactions are free and have no regulatory implications.
- The cryptographic properties (hash commitment, public ledger) are identical to mainnet.

Migration to mainnet is possible if the network grows to require it.

## Overrides system

The overrides system allows per-repo customization without forking RepoMesh or modifying shared configuration.

### How overrides work

Each repo places a `repomesh.overrides.json` file at its root (generated empty by `repomesh init`). The overrides file can customize verifier behavior:

```json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

The overrides schema is defined in `schemas/repomesh.overrides.schema.json`.

### Override precedence

1. **Profile defaults** -- base configuration from `profiles/<profile>.json`
2. **Network policy** -- global rules set by governance nodes
3. **Repo overrides** -- per-repo `repomesh.overrides.json` (highest priority for allowed fields)

Not all fields are overridable. Security-critical settings (minimum verifier count for regulated profiles, signature requirements) cannot be weakened by overrides. The schema defines which fields accept overrides and their valid ranges.

### When to use overrides

- **Ignore a false-positive advisory** in the security verifier.
- **Add allowed licenses** beyond the profile default.
- **Customize badge appearance** for your README.

Overrides are validated by the `doctor` command and by CI on every push. Invalid overrides cause the pipeline to fail with a clear error message pointing to the schema violation.
