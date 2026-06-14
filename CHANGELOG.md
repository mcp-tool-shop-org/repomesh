# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-06-14

A full trust-correctness hardening pass plus a verifier-fleet humanization and adoption layer. The
trust model is materially stronger and now **fail-closed**, and the verification surface is legible
and CI-friendly. Implemented via version-dispatch, so existing committed ledger and anchor data keeps
verifying unchanged. Tests 58 → 414 (0 fail).

### Breaking

- **Verification is now fail-closed.** `verify-release` returns `UNVERIFIED` (never `PASS`) for a
  self-signed, wrong-repo-signed, non-allowlisted-attestor, or failed-attestation release, and strict
  `--anchored` fails when the on-chain anchor cannot be verified. Exit codes are tri-state — PASS=0,
  FAIL=1, UNVERIFIED=3 (was: any failure = 1). Gate incrementally with `--fail-on <fail|unverified>`.
- **Attestor authorization enforced.** Only nodes in the trusted-attestor allowlist
  (`verifier.policy.json`) of the correct kind can produce trust-bearing attestations — enforced in
  the CLI, at ledger ingress, and in the registry scorer.
- **Assurance scoring is stricter.** A verifier that could not run scores `unscored` = 0 credit (was
  `warn` = partial credit); a missing/unverified SBOM digest earns no credit; repo overrides can no
  longer raise a failing check's weight or drop critical/high from the fail set.

### Security

- Repo-bound signer resolution (release keys resolve only from the releasing repo's `node.json`).
- Real XRPL anchor verification: trusted-account allowlist + `validated` + `tesSUCCESS` + on-chain
  memo binding; the Merkle root is recomputed from the manifest's pinned range+count window.
- OSV CVSS-vector severity decoding so a known critical CVE actually fails; SBOM digest binding.
- `build-trust` verifies every event signature before scoring; signed disputes from trusted nodes
  downgrade a release; RFC-6962 (v2) Merkle, version-dispatched alongside legacy v1.

### Added

- **GitHub Action** release-gate wrapper (`.github/actions/verify`) — gate a release on its trust
  chain in one step via the pinned published CLI; tri-state verdict → job result, markdown summary,
  optional SARIF upload.
- **`verify-all`** batch verification (one ledger load) · **`--format <text|json|sarif|markdown>`** ·
  **`--local [dir]`** offline verification · **/repos Trust Index** browse page · per-version
  **badge proof-chain** pages · **OSV result cache** with bounded concurrency.

### Changed

- Every non-`pass` verdict now carries a machine-readable `reason` + a human fix-hint. Graceful
  degradation throughout (fetch timeouts, partial-failure tolerance, friendly network/purged-tx
  guidance, no raw stack traces).
- Onboarding + verification docs use `npx @mcptoolshop/repomesh` — no clone required to verify.
- Event-type docs marked *reserved / planned (not yet emitted)* to match the live ledger.

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
