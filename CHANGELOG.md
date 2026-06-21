# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.2.0] - 2026-06-21

Dogfood-swarm release: a full health pass (bug/security → proactive → humanization → visual) plus an
adopter/operator feature pass. Additive — existing ledger and node data verify unchanged. Tests 709 → 912.

### Added
- **Programmatic library API** — `import { verifyRelease, computeVerifyResult, verifyAll, buildSarif, exitCodeForStatus, isKeyValidForSignature, verifyAnchorTx } from "@mcptoolshop/repomesh"`. Usable as a library, not only a CLI.
- **`repomesh keygen`** + `init --second-key` — mint distinct ed25519 maintainer keys (secret never written to a tracked path) with a TUF §6.1 ≥2-key separation-of-duties advisory for single-key nodes.
- **`status.json`** — a machine-readable network-health endpoint on the dashboard (ledger freshness + frozen-ledger signal, trust-verdict counts, anchored-vs-pending partitions, `ok`/`degraded` rollup).

### Fixed
- **Ledger tamper-evidence covered only the first 8 of 47 events.** `validate-ledger` now verifies v1 **and** v2 (RFC-6962) manifests; a whole-ledger `all.json` is committed and kept current by the anchor cron; `verify-release` recomputes the committed roots — so a reordered or truncated ledger (e.g. a dropped `KeyRevocation`) is caught locally.
- **The trust dashboard showed "Anchored on XRPL" for releases never posted on-chain** — "Anchored" now requires a real on-chain `txHash`; otherwise "Pending anchor".
- **The two `verify-release` copies disagreed** on a failing non-required attestation — now identical.
- **`PolicyViolation` events could never schema-validate** (enforcement was silently inert) — fixed at the emitter.
- **Uniform exit-code contract** (0/1/2/3): usage errors + XRPL outages no longer report as a trust FAIL to CI gates; enum flags validated; remote trust fetches require `https`; remote-without-`--anchored` warns on revocation-sensitive verification.
- **Anchor write-path legibility** — network-aware explorer URIs, structured errors, on-chain close-time in the receipt.

### Security
- **Key-window predicate fails closed** on a non-usable signature time; `revocationReason` canonicalized (a mis-cased `"Compromise"` can no longer dodge the compromise gate).
- `docs/threat-model.md` documents two-layer tamper-evidence (local-evident vs on-chain-proof), the offline-vs-online clock ceiling, and the trust-root separation-of-duties posture.

### Ops / CI
- Daily anchor cron auto-merges on green + staleness andon (the anchor PRs had piled up unmerged, freezing the ledger — the root cause of the coverage gap above); attestor-ci verifier fail-open closed; both crons escalate failures to a deduped tracking issue.

## [2.1.0] - 2026-06-14

Time-aware key rotation and revocation. Closes a live trust bug: key resolution was **untimed**, so a
compromised-but-still-listed key scored full integrity and verified `VALID`. Additive and
version-dispatched — keys with no lifecycle fields are grandfathered, so existing ledger and node data
verifies unchanged. Tests 414 → 709 (0 fail).

### Added

- **Windowed maintainer keys** — optional `validFrom` / `validUntil` / `revokedAt` / `revocationReason`
  / `invalidAfter` (RFC 5280 invalidity date) fields on `node.json` maintainers.
- **`KeyRotation` / `KeyRevocation` events** + `repomesh key rotate|revoke` commands that build, sign,
  append the event, and apply the matching `node.json` window edit. `validate-ledger` validates these
  events and binds `node.json` window state to them.
- **[Threat model](docs/threat-model.md)** documenting the `node.json` trust boundary and the
  `--anchored` recommendation for revocation-sensitive verification.

### Security

- **Time-aware key resolution at all eleven verification sites.** After resolving a key by `keyId`, the
  verifier checks the signature's trusted time (XRPL anchor close-time → bundled-trusted anchor event →
  self-asserted) against the key's window. A compromised key with a proper revocation no longer verifies.
- **Routine rotation is prospective; compromise is retroactive** (RFC 5280 §5.3.2) — a compromised key
  is distrusted for any signature not provably anchored before the invalidity date.
- **Tamper-resistant against a stripped `node.json`** — key windows are re-derived from the signed,
  XRPL-anchored events (order-aware) and merged most-restrictively, so a tampered `node.json` can only
  add restriction, never revive a revoked key (including in the event-authorization path).

### Notes

- Non-destructive: window-less keys grandfather as always-valid; all existing events keep verifying.
- Verified across three cross-family (`glm-4.6` / `gpt-oss`) adversarial passes plus forged-window,
  node.json-strip, and ordering-exploit probes.

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
