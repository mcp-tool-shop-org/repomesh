# Changelog

## [2.1.0] - 2026-06-14

### Added
- **`repomesh key rotate` / `repomesh key revoke`** — sign + append a `KeyRotation`/`KeyRevocation`
  event and apply the matching `node.json` maintainer-window edit (`--dry-run` supported).
- Windowed maintainer keys (`validFrom`/`validUntil`/`revokedAt`/`revocationReason`/`invalidAfter`).

### Security
- **Time-aware key resolution.** `verify-release` now rejects a signature whose XRPL-anchored trusted
  time falls outside the signing key's validity window — a compromised-but-still-listed key with a
  proper revocation no longer verifies. Routine rotation is prospective; compromise is retroactive
  (RFC 5280 §5.3.2, demands a provable anchored time before the invalidity date).
- **Stripped-`node.json` resistance.** Key windows are re-derived (order-aware) from the signed,
  anchored `KeyRotation`/`KeyRevocation` events and merged most-restrictively, so a tampered manifest
  cannot revive a revoked key. See `docs/threat-model.md`; use `--anchored` for revocation-sensitive
  verification.
- Grandfathered (window-less) keys verify byte-identical to before.

## [2.0.0] - 2026-06-14

### Breaking
- **Verification is fail-closed.** `verify-release` returns `UNVERIFIED` (never `PASS`) for a
  self-signed, wrong-repo-signed, non-allowlisted-attestor, or failed-attestation release; strict
  `--anchored` fails when the on-chain anchor cannot be verified.
- **Tri-state exit codes:** PASS=0, FAIL=1, UNVERIFIED=3 (was: any failure = 1). Gate incrementally
  with `--fail-on <fail|unverified>` (default `unverified`).

### Security
- Repo-bound signer resolution (release keys resolve only from the releasing repo's `node.json`).
- Real XRPL anchor verification: trusted-account allowlist + `validated` + `tesSUCCESS` + on-chain
  memo binding; the Merkle root is recomputed from the manifest's pinned window.
- Bundled trusted-attestor allowlist floor — a fetched policy may narrow it but never widen it.

### Added
- `--local [dir]` offline verification (the documented flag is now implemented).
- `--format <text|json|sarif|markdown>` (`--json` is an alias for `--format json`).
- `verify-all` — batch verification from a manifest or the registry, with one ledger load.
- Every non-`pass` verdict carries a machine-readable `reason` + a human fix-hint.
- RFC-6962 (v2) Merkle verification, version-dispatched alongside legacy v1.

### Changed
- Docs use `npx @mcptoolshop/repomesh` — no clone required to verify a release.

## [1.1.0] - 2026-03-28

### Security
- Eliminated all command injection vectors (execSync → execFileSync with array args)
- Path traversal prevention on all user-controlled paths (resolve + startsWith)
- ReDoS-safe JSON extraction (regex replaced with lastIndexOf + slice)
- Added .gitignore entries for PEM key files
- CI workflows: explicit permissions, separated git commit/push steps

### Added
- `--quiet`, `--verbose`, `--debug`, `--no-color` global CLI flags
- `--json` output for `init` command
- `repomesh completion bash|zsh` for shell completion
- Env var overrides: `REPOMESH_LEDGER_URL`, `REPOMESH_MANIFESTS_URL`, `REPOMESH_FETCH_TIMEOUT`
- Attestor `--dry-run` flag
- Security verifier config file (`verifiers/security/config.json`)
- Profile override validation (prevents weakening regulated profiles)
- 58 tests across 3 suites (20 CLI + 27 ledger + 11 tools)

### Improved
- All JSON.parse calls wrapped in try-catch with descriptive errors
- Network retry feedback visible to users (not just debug mode)
- Progress indicators for all multi-step operations
- Actionable error hints (suggests next steps, not just failure messages)
- Fresh repo detection in `doctor` command
- Timeouts on XRPL (60s), HTTP (configurable), git clone (30s)
- Signal handlers for temp directory cleanup
- GitHub API retry with exponential backoff

## [1.0.0] - 2026-02-28

### Added

- `verify-release` — verify any release's trust chain from anywhere (no clone required)
- `verify-anchor` — verify XRPL anchor transactions
- `init` — one-command onboarding for repos joining the network
- `doctor` — diagnose a local repo's RepoMesh integration
- Remote verification via raw GitHub URLs (standalone mode)
- Local file access when run inside a RepoMesh checkout (dev mode)
- Packaged schemas, profiles, and workflow templates
