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

Each attestation carries a result: `pass`, `warn`, or `fail`.

### Layer 3: Anchor Manifests

Periodically, the anchor node computes a Merkle root over all event canonical hashes since the last anchor. This produces a manifest file containing:

- `partitionId` — which events are included
- `root` — SHA-256 Merkle root of all canonical hashes
- `prev` — previous anchor's root (forming a linked list)
- `range` — first and last canonical hash in the partition
- `count` — number of leaves
- `manifestHash` — SHA-256 of the manifest body (self-binding)

The manifest is committed to the repo and is append-only: once written, it cannot change.

### Layer 4: XRPL Anchoring

The anchor node posts a self-payment on the XRP Ledger testnet with a memo containing the manifest hash and Merkle root. This creates an immutable timestamp on a public blockchain. The memo format is:

```
{v, p (partitionId), n (network), r (root), h (manifestHash), c (count), pv (prev), rg (range)}
```

Anyone can fetch the XRPL transaction, decode the memo, and verify it matches the local manifest.

## Verification Commands

### Verify a release (signature + attestations)

```
git clone https://github.com/mcp-tool-shop-org/repomesh.git
cd repomesh
node tools/repomesh.mjs verify-release --repo org/repo --version X.Y.Z
```

### Verify a release with anchor proof

```
node tools/repomesh.mjs verify-release --repo org/repo --version X.Y.Z --anchored
```

### Verify an XRPL anchor directly

```
node anchor/xrpl/scripts/verify-anchor.mjs --tx <XRPL_TX_HASH>
```

### JSON output (for CI gates and automation)

```
node tools/repomesh.mjs verify-release --repo org/repo --version X.Y.Z --anchored --json
```

The JSON output includes `ok: true/false` for simple pass/fail gating.

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
- Post-hoc ledger tampering (XRPL anchoring)

### What RepoMesh does not prevent

- Compromised signing keys (key rotation is the mitigation)
- Zero-day vulnerabilities (not in OSV database yet)
- Malicious code that passes all checks (requires code review)
- XRPL testnet resets (move to mainnet for production)

## Key Concepts

- **Canonical hash**: SHA-256 of the event body with sorted keys and no signature field
- **Manifest hash**: SHA-256 of the manifest body without the manifestHash field
- **Merkle root**: Pairwise SHA-256 hashing of leaves; odd leaves are duplicated
- **Append-only**: Ledger lines and manifests are immutable once committed
- **Profile**: Defines which checks are required for a repo (baseline, open-source, regulated)
