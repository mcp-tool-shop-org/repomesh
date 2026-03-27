---
title: Beginners
description: A plain-language introduction to RepoMesh for newcomers to trust infrastructure, signed releases, and supply-chain verification.
sidebar:
  order: 99
---

This page explains what RepoMesh does, why it exists, and how it works -- in plain language, with no assumed background in cryptography or supply-chain security.

## What problem does this solve?

Software supply chains are invisible by default. When you install a package, you trust that the published artifact matches the source code, that no one tampered with the release, and that dependencies are free of known vulnerabilities. But none of that is verified unless someone builds the tooling to check.

RepoMesh makes those checks automatic and public. It creates a shared record of releases, attestations, and policy decisions across all repositories in a network. Anyone can verify a release with a single command, and the entire history is tamper-evident.

## Core concepts

**Node** -- every repository that joins RepoMesh becomes a node. A node has a manifest (`node.json`) that declares its identity, what it provides, and who maintains it. Each node has at least one Ed25519 signing keypair.

**Ledger** -- the append-only log where all events are recorded. Think of it as a shared logbook. Events are never edited or deleted. Each event is signed by the node that created it.

**Event** -- a structured record of something that happened. The most common event is `ReleasePublished`, which means a new version was released. Other events record attestations, policy violations, and health checks.

**Attestation** -- an independent verification of a release. After a release event appears on the ledger, the attestor node runs checks (license compliance, security scan, SBOM presence) and publishes an `AttestationPublished` event with the results.

**Trust profile** -- a configuration that defines how much evidence a repository needs to provide. A `baseline` profile requires almost nothing. An `open-source` profile requires an SBOM and provenance. A `regulated` profile adds reproducibility verification.

**Anchor** -- a Merkle root of ledger events posted to the XRP Ledger (a public blockchain). This creates a tamper-evident timestamp that exists outside GitHub, so even if someone modified the ledger file, the XRPL record would expose the change.

**Registry** -- a set of flat JSON files that aggregate ledger data into an index. It includes node metadata, trust scores, badge SVGs, and a timeline. The registry is rebuilt from the ledger automatically; it is not a separate data store.

## Installation

RepoMesh is published as an npm package. You need Node.js 20 or later.

```bash
# Use directly with npx (no install needed)
npx @mcptoolshop/repomesh --help

# Or install globally
npm install -g @mcptoolshop/repomesh
repomesh --help
```

The CLI has four commands:

| Command | What it does |
|---|---|
| `init` | Generate onboarding files for a repo joining the network |
| `doctor` | Validate a local repo's RepoMesh configuration |
| `verify-release` | Verify a release's trust chain (signature + attestations + anchor) |
| `verify-anchor` | Verify an XRPL anchor transaction |

All commands work standalone. You do not need to clone the RepoMesh repository to verify releases.

## First steps

### 1. Join the network

Run `init` in your repository:

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
```

This creates:
- `node.json` -- your node manifest with a generated Ed25519 public key
- `repomesh.profile.json` -- your chosen trust profile
- `repomesh.overrides.json` -- empty overrides file (for future customization)
- `.github/workflows/repomesh-broadcast.yml` -- a GitHub Actions workflow that broadcasts release events
- `repomesh-keys/` -- your signing keypair (private key stays local, added to `.gitignore`)

### 2. Add secrets

The init command prints two secrets you need to add to your GitHub repository settings:

- **REPOMESH_SIGNING_KEY** -- your Ed25519 private key PEM. Used by the broadcast workflow to sign events.
- **REPOMESH_LEDGER_TOKEN** -- a fine-grained GitHub PAT with `contents:write` and `pull-requests:write` on the RepoMesh ledger repository.

### 3. Validate your setup

```bash
npx @mcptoolshop/repomesh doctor
```

This checks that all required files exist and are schema-valid.

### 4. Cut a release

```bash
gh release create v1.0.0 --generate-notes
```

The broadcast workflow signs a `ReleasePublished` event and posts it to the ledger. The attestor picks it up, runs verifiers, and publishes results. Trust scores begin converging.

### 5. Verify your release

```bash
npx @mcptoolshop/repomesh verify-release --repo your-org/your-repo --version 1.0.0
```

## Typical workflow

Here is what happens during a normal release cycle:

1. You push code and create a GitHub release (e.g., `v1.2.0`).
2. The `repomesh-broadcast` workflow fires. It builds your project, hashes artifacts, generates an SBOM, signs the event, and opens a PR against the RepoMesh ledger.
3. Ledger CI validates the event (schema, signature, uniqueness, timestamp).
4. The PR is merged. Your `ReleasePublished` event is now on the ledger.
5. The attestor scans for new releases. It runs the license verifier, security verifier, and (for regulated profiles) reproducibility verifier.
6. Attestation results are signed and appended to the ledger as `AttestationPublished` events.
7. The registry rebuilds: trust scores update, badges regenerate, the trust index page refreshes.
8. Periodically, the settlement node computes a Merkle root over recent events and posts it to the XRP Ledger testnet. This anchors the ledger history to an external, immutable record.

## Glossary

| Term | Definition |
|---|---|
| **Append-only** | Data can be added but never modified or deleted. |
| **Canonical JSON** | A deterministic JSON serialization where object keys are sorted alphabetically. Used to ensure identical content always produces the same hash. |
| **Ed25519** | A public-key signature algorithm. Each node has a private key (for signing) and a public key (for verification). |
| **JSONL** | JSON Lines format. One JSON object per line. The ledger uses this format. |
| **Merkle tree** | A data structure where each leaf is a hash and each non-leaf is the hash of its children. The root hash summarizes the entire set. Changing any leaf changes the root. |
| **Node manifest** | The `node.json` file that declares a repo's identity, capabilities, maintainers, and public key. |
| **SBOM** | Software Bill of Materials. A machine-readable list of all components in a software package. |
| **Trust profile** | A configuration (`baseline`, `open-source`, or `regulated`) that defines what evidence and checks a node must provide. |
| **XRPL** | The XRP Ledger, a public blockchain. RepoMesh uses XRPL testnet to anchor Merkle roots, creating tamper-evident timestamps. |
| **Provenance** | Evidence linking a published artifact back to its source code and build process. |

## Frequently asked questions

**Do I need to understand cryptography to use RepoMesh?**
No. The CLI handles key generation, signing, and verification automatically. You only need to add two secrets to your repository and cut releases normally.

**What does RepoMesh touch in my repository?**
RepoMesh adds a few files to your repo root (`node.json`, `repomesh.profile.json`, `repomesh.overrides.json`) and a GitHub Actions workflow. It does not modify your source code, access private keys outside CI, or collect any telemetry.

**What if I do not use XRPL anchoring?**
Anchoring is optional. Without it, you still get signed release events, attestations, and trust scores. The `--anchored` flag on `verify-release` simply skips the anchor check if no anchor exists.

**Can I use this with a private repository?**
Yes. The broadcast workflow posts events to the public RepoMesh ledger, but the event only contains metadata (repo name, version, commit hash, artifact hashes). No source code is exposed.

**What happens if a verifier fails?**
The attestation records the failure. Trust scores reflect the result. Failed verifiers do not block releases by default, but you can configure CI gates to enforce minimum scores.

**How is this different from Sigstore or SLSA?**
RepoMesh is complementary. Sigstore provides keyless signing for individual artifacts. SLSA defines build provenance levels. RepoMesh builds a network-level trust layer on top: multi-repo coordination, composite scoring, policy enforcement, and XRPL anchoring. You can use Sigstore-signed provenance as input to a RepoMesh attestation.
