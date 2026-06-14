# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Composite GitHub Action** (`.github/actions/verify`) — gate a release on its RepoMesh trust
  chain in one step. Shells the pinned published CLI (`npx @mcptoolshop/repomesh@<version>
  verify-release`), maps the tri-state verdict to the job result (PASS=0 / FAIL=1 / UNVERIFIED=3),
  writes a markdown job summary, and can upload SARIF to the Security tab. Inputs
  `{repo, version, anchored, fail-on, format}`, outputs `{status, ok, exit-code}`. Least-privilege
  permissions; example consumer workflow in `docs/verification.md`.

### Changed

- **Docs verify/onboarding path is now `npx @mcptoolshop/repomesh ...`** — no clone required to
  verify a release or onboard. README, `docs/verification.md`, and `docs/handbook.md` updated; clone
  is retained only for the offline `--local` path and genuine operator/maintainer tasks. Documented
  the tri-state exit codes + `--fail-on`, `--format <text|json|sarif|markdown>`, `verify-all`, and
  `--local`.
- **Event-type docs now match the live ledger (front-door honesty).** `BreakingChangeDetected`,
  `HealthCheckFailed`, `DependencyVulnFound`, `InterfaceUpdated`, and `PolicyViolation` are marked
  *reserved / planned (not yet emitted)* in README + handbook; the live tables list only the types
  the ledger actually emits (`ReleasePublished`, `AttestationPublished`, `ledger.anchor`,
  `attestation.dispute`).

## [1.0.0] - 2026-02-28

### Added

- **Append-only ledger** with Ed25519-signed events and JSON Schema validation
- **Node registration** system with manifests, keypairs, and capability declarations
- **Trust profiles** (baseline, open-source, regulated) with profile-aware scoring
- **Universal attestor** for SBOM, provenance, and signature chain verification
- **Independent verifiers** for license compliance (SPDX) and security scanning (OSV.dev)
- **Reproducibility verifier** framework (`repro.build` checks)
- **Multi-dimensional trust scoring** with integrity and assurance dimensions
- **XRPL anchoring** — Merkle roots posted to testnet with chainable partitions
- **Release verification** CLI (`verify-release --anchored`) covering signatures, attestations, and anchor inclusion
- **Multi-attestor consensus** with configurable thresholds and dispute tracking
- **Network health** dashboard with verifier status, pending attestations, and anchor coverage
- **CLI tool** (`tools/repomesh.mjs`) with init, verify-release, keygen, register-node, build-pages, build-badges, build-snippets
- **Trust badges** (SVG) for integrity, assurance, and anchored status
- **Public verification docs** with step-by-step guide and verification notebook
- **Adoption layer** — one-command init, coaching output, override system
- **Policy engine** — semver monotonicity, hash uniqueness, required capability checks
- **Registry explorer** — static Pages site with trust index, anchor explorer, and live dashboard
- **Astro landing page** via @mcptoolshop/site-theme with live network stats
- **Network dashboard** with SVG trust rings, stat cards, sparklines, timeline strip, and explore tiles
- **Handbook** — 10-section operator guide (docs/handbook.md)
- **Translations** — 7 languages (es, fr, hi, it, ja, pt-BR, zh)
