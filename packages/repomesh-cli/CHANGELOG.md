# Changelog

## [2.3.0] - 2026-06-21

The **verifier-plugin contract** (#7). The trust network can now be extended with new check kinds and
verifier nodes by editing data, not code. Additive — existing scoring + validation are byte-identical.

### Added
- **Data-driven check-kinds registry.** Per-check scoring weights, the attestor-gated set, the
  scoreable-results set, and the node-kind→event-type permission map now live in `verifier.policy.json`
  (v2) instead of hardcoded constants. Adding a check kind (e.g. `sast.scan`) or a verifier node is a
  ~6-line policy edit + a `node.json`, reviewed in a PR — no code change. See
  [docs/verifier-plugin-contract.md](https://github.com/mcp-tool-shop-org/repomesh/blob/main/docs/verifier-plugin-contract.md).
- **`registered ≠ trusted`** is now explicit: an attestation of an unregistered check kind earns zero
  and is flagged `registered: false` (never silently mixed in); a registered kind still requires a
  trusted-set consensus pass to earn credit.
- **`schemas/verifier.policy.schema.json`** — the policy is schema-validated (v1 + v2); the ledger
  validator **fails closed** on a malformed trust policy rather than silently trusting it.

### Compatibility
- `verifier.policy.json` is now `v: 2`; every v2 field is optional and falls back, per field, to the
  exact pre-#7 default. A v1 policy behaves unchanged. Verified: `trust.json` regenerates
  byte-identical to the prior release.

## [2.2.0] - 2026-06-21

Dogfood-swarm release: a full health pass (bug/security → proactive → humanization → visual) plus an
adopter/operator feature pass. Additive — existing ledger and node data verify unchanged. Tests 709 → 912.

### Added
- **Programmatic library API** — `import { verifyRelease, computeVerifyResult, verifyAll, buildSarif, exitCodeForStatus, isKeyValidForSignature, verifyAnchorTx } from "@mcptoolshop/repomesh"`. repomesh is now usable as a library, not only a CLI.
- **`repomesh keygen`** — mint a distinct ed25519 maintainer key (paste-ready node.json block; the private key is never written to a tracked path). `repomesh init --second-key` registers a second key, and a TUF §6.1 advisory nudges single-key nodes toward the ≥2-key separation-of-duties posture.
- **`status.json`** — a machine-readable network-health endpoint on the dashboard (ledger freshness + a frozen-ledger signal, trust-verdict counts, anchored-vs-pending partitions, an `ok`/`degraded` rollup with reasons).

### Fixed
- **Ledger tamper-evidence covered only the first 8 of 47 events.** `validate-ledger` skipped v2 (RFC-6962) manifests and only the genesis partition was committed. It now verifies v1 **and** v2 manifests, a whole-ledger `all.json` is committed and kept current by the anchor cron, and `verify-release` recomputes the committed roots — so a reordered or truncated ledger (e.g. a dropped `KeyRevocation`) is caught locally.
- **The trust dashboard showed "Anchored on XRPL" for releases never posted on-chain.** "Anchored" now requires a real on-chain `txHash`; an un-posted partition renders an honest "Pending anchor".
- **The two `verify-release` copies disagreed** on a failing non-required attestation — now identical.
- **`PolicyViolation` events could never schema-validate** (the enforcement path was silently inert) — fixed at the emitter.
- **Uniform exit-code contract** (0 pass / 1 trust-FAIL / 2 operator-or-environment error / 3 unverified): a usage typo or an XRPL outage no longer reports as a trust failure to CI gates. Enum flags are validated, remote trust fetches require `https`, and a warning fires when verifying revocation-sensitive material in remote mode without `--anchored`.
- **Anchor write-path legibility** — network-aware explorer URIs (no testnet links baked into mainnet records), structured connect/seed/sign errors, and the on-chain close-time surfaced in the receipt.

### Security
- **Key-window predicate fails closed** on a non-usable (NaN/Invalid-Date) signature time, and `revocationReason` is canonicalized so a mis-cased `"Compromise"` can no longer take the prospective branch and dodge the compromise gate.
- `docs/threat-model.md` documents the two-layer tamper-evidence model (local tamper-evident vs on-chain tamper-proof), the offline-vs-online clock provability ceiling, and the trust-root separation-of-duties posture.

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
