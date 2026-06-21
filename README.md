<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/repomesh/readme.png" width="500" alt="RepoMesh">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/ledger-ci.yml"><img src="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/ledger-ci.yml/badge.svg" alt="Ledger CI"></a>
  <a href="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/registry-ci.yml"><img src="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/registry-ci.yml/badge.svg" alt="Registry CI"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/repomesh"><img src="https://img.shields.io/npm/v/@mcptoolshop/repomesh" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/repomesh/"><img src="https://img.shields.io/badge/Trust_Index-live-blue" alt="Trust Index"></a>
  <a href="https://mcp-tool-shop-org.github.io/repomesh/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

Syntropic repo network — append-only ledger, node manifests, and scoring for distributed repo coordination.

## What is this?

RepoMesh turns a collection of repos into a cooperative network. Each repo is a **node** with:

- A **manifest** (`node.json`) declaring what it provides and consumes
- **Signed events** broadcast to an append-only ledger
- A **registry** indexing all nodes and capabilities
- A **profile** defining what "done" means for trust

The network enforces three invariants:

1. **Deterministic outputs** — same inputs, same artifacts
2. **Verifiable provenance** — every release is signed and attested
3. **Composable contracts** — interfaces are versioned and machine-readable

## Quick Start (1 command + 2 secrets)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

This generates everything you need:
- `node.json` — your node manifest
- `repomesh.profile.json` — your chosen profile
- `.github/workflows/repomesh-broadcast.yml` — release broadcast workflow
- Ed25519 signing keypair (private key stays local)

Then add two secrets to your repo:
1. `REPOMESH_SIGNING_KEY` — your private key PEM (printed by init)
2. `REPOMESH_LEDGER_TOKEN` — GitHub PAT with `contents:write` + `pull-requests:write` on this repo

Cut a release. Trust converges automatically.

### CLI Flags

All commands accept: `--quiet`, `--verbose`, `--debug`, `--no-color`. The `init` command also supports `--json` for machine-readable output.

Shell completions are available:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Environment Overrides

| Variable | Purpose |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Override ledger endpoint |
| `REPOMESH_MANIFESTS_URL` | Override manifests endpoint |
| `REPOMESH_FETCH_TIMEOUT` | Fetch timeout in ms |

### Profiles

| Profile | Evidence | Assurance Checks | Use When |
|---------|----------|-----------------|----------|
| `baseline` | Optional | None required | Internal tools, experiments |
| `open-source` | SBOM + provenance | License audit + security scan | Default for OSS |
| `regulated` | SBOM + provenance | License + security + reproducibility | Compliance-critical |

### Check Trust

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Shows integrity score, assurance score, profile-aware recommendations.

### Overrides

Per-repo customization without forking verifiers:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Repo Structure

```
repomesh/
  profiles/                   # Trust profiles (baseline, open-source, regulated)
  schemas/                    # Source of truth for all schemas
  ledger/                     # Append-only signed event log
    events/events.jsonl       # The ledger itself
    nodes/                    # Registered node manifests + profiles
    scripts/                  # Validation + verification tooling
  attestor/                   # Universal attestor (sbom, provenance, sig chain)
  verifiers/                  # Independent verifier nodes
    license/                  # License compliance scanner
    security/                 # Vulnerability scanner (OSV.dev)
  anchor/xrpl/               # XRPL anchoring (Merkle roots + testnet posting)
    manifests/                # Committed partition manifests (append-only)
    scripts/                  # compute-root, post-anchor, verify-anchor
  policy/                     # Network policy checks (semver, hash uniqueness)
  registry/                   # Network index (auto-generated from ledger)
    nodes.json                # All registered nodes
    trust.json                # Trust scores per release (integrity + assurance)
    anchors.json              # Anchor index (partitions + release anchoring)
    badges/                   # SVG trust badges per repo
    snippets/                 # Markdown verification snippets per repo
  pages/                      # Static site generator (GitHub Pages)
  docs/                       # Public verification docs
  tools/                      # Developer UX tools
    repomesh.mjs              # CLI entrypoint
  templates/                  # Workflow templates for joining
```

## Manual Join (5 minutes)

### 1. Create your node manifest

Add `node.json` to your repo root:

```json
{
  "id": "your-org/your-repo",
  "kind": "compute",
  "description": "What your repo does",
  "provides": ["your.capability.v1"],
  "consumes": [],
  "interfaces": [
    { "name": "your-interface", "version": "v1", "schemaPath": "./schemas/your.v1.json" }
  ],
  "invariants": {
    "deterministicBuild": true,
    "signedReleases": true,
    "semver": true,
    "changelog": true
  },
  "maintainers": [
    { "name": "your-name", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. Generate a signing keypair

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` prints the public key + a `keyId` ready to drop into your `node.json` maintainers entry, and
writes the private key (mode 0600) only where you point `--out` — never to a tracked path. Store it as a
GitHub repo secret (`REPOMESH_SIGNING_KEY`). (Equivalent by hand: `openssl genpkey -algorithm ED25519 ...`.)

> **Register ≥2 keys for a trust-critical node** (TUF §6.1): a single key cannot sign its own
> revocation if compromised. `repomesh init --second-key` registers a distinct second maintainer so one
> key can revoke the other — `init` warns when a node has only one active key.

### 3. Register with the network

Open a PR to this repo adding your node manifest:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Add the broadcast workflow

Copy `templates/repomesh-broadcast.yml` to your repo's `.github/workflows/`.
Set the `REPOMESH_LEDGER_TOKEN` secret (a fine-grained PAT with contents:write + pull-requests:write on this repo).

Every release will now automatically broadcast a signed `ReleasePublished` event to the ledger.

## Ledger Rules

- **Append-only** — existing lines are immutable
- **Schema-valid** — every event validates against `schemas/event.schema.json`
- **Signature-valid** — every event is signed by a registered node maintainer
- **Unique** — no duplicate `(repo, version, type)` entries
- **Timestamp-sane** — not more than 1 hour in the future or 1 year in the past

## Event Types

The ledger currently emits the **live** event types below. The rest are **reserved / planned** — the
schema accepts them, but no node emits them yet. We list them so the roadmap is visible without
implying coverage that does not exist (front-door honesty for a trust product).

**Live (emitted today):**

| Type | When |
|------|------|
| `ReleasePublished` | A new version is released |
| `AttestationPublished` | An attestor verifies a release |
| `ledger.anchor` | The anchor node seals a partition (Merkle root + XRPL memo) |
| `attestation.dispute` | A trusted node disputes an attestation (downgrades the verdict) |
| `KeyRotation` | A maintainer key is rotated to a successor (prospective — past signatures stay valid) |
| `KeyRevocation` | A maintainer key is revoked (compromise = retroactive invalidity, RFC 5280) |

**Reserved / planned (not yet emitted):**

| Type | Intended meaning |
|------|------------------|
| `BreakingChangeDetected` | A breaking change is introduced |
| `HealthCheckFailed` | A node fails its own health checks |
| `DependencyVulnFound` | A vulnerability is found in dependencies |
| `InterfaceUpdated` | An interface schema changes |
| `PolicyViolation` | A network policy is violated |

## Key Rotation & Revocation

Maintainer keys have a lifecycle. A key can be **rotated** to a successor or **revoked**, and
verification is **time-aware**: a signature is trusted only if the key was valid at the signature's
trusted time — the XRPL anchor close-time, the same trusted clock the ledger already uses.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **Routine rotation** is *prospective* — the retired key's past signatures remain valid; it simply
  stops signing new releases.
- **Compromise** is *retroactive* (RFC 5280 §5.3.2) — any signature whose provable anchored time is
  at/after the invalidity date is rejected, and a signature that cannot be proven to predate it is
  rejected.
- A key with **no** lifecycle fields is grandfathered (always valid), so existing nodes verify
  unchanged.
- Revocations are signed `KeyRevocation` events; a single-key node whose only key is compromised is
  recovered by a **governance** (`trustedPolicy`) node signing the revocation. Trust-critical nodes
  should register **≥2 keys** (TUF §6.1).
- Even against a tampered `node.json`, a revocation is re-imposed from the signed, XRPL-anchored
  events — a stripped manifest cannot revive a revoked key. See the [threat model](docs/threat-model.md)
  for the boundary (verify against the canonical ledger; use `--anchored` for revocation-sensitive checks).

## Node Kinds

| Kind | Role |
|------|------|
| `registry` | Indexes nodes and capabilities |
| `attestor` | Verifies claims (builds, compliance) |
| `policy` | Enforces rules (scoring, gating) |
| `oracle` | Provides external data |
| `compute` | Does work (transforms, builds) |
| `settlement` | Finalizes state |
| `governance` | Makes decisions |
| `identity` | Issues/verifies credentials |

## Extending the network — the verifier-plugin contract

New **check kinds** and **verifier nodes** are added by editing data, not code. The check-kinds
registry, scoring weights, and node-kind permissions live in
[`verifier.policy.json`](verifier.policy.json) (schema-validated, fail-closed). Adding a check (e.g.
`sast.scan`) is a ~6-line policy edit + a `node.json`, reviewed in a PR — no code change.

The one invariant: **registered ≠ trusted.** Registration lets a check participate; credit still
requires a trusted-set consensus pass. Full guide:
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Public Verification

Anyone can verify a release with one command — **no clone required**, the CLI fetches the public
ledger for you:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

This checks:
1. The `ReleasePublished` event exists and is signed (Ed25519) by a key registered to **that repo's own** `node.json` — a key registered to a different repo cannot validate it.
2. The repo's trust profile is satisfied: every profile-required attestation (SBOM, provenance, license, security) is present, signed by a trusted attestor, and its latest result is `pass`, with at least one **independent** attestor. A release with only a self-signature and no independent attestations reports `UNVERIFIED`, never `PASS`.
3. With `--anchored`: the partition's Merkle root is recomputed and matched to the manifest, and — when the network is reachable — the on-chain XRPL transaction is fetched and asserted (`validated` + `tesSUCCESS`, the signing account is in the trusted-anchor allowlist, and the on-chain memo binds to the local root/manifest-hash/count). Offline, it reports `XRPL NOT verified` rather than a fake transaction; strict `--anchored` then fails (use `--anchored-or-local` to accept a locally-verified manifest without the on-chain proof).

For CI gates, choose an output format with `--format <text|json|sarif|markdown>` (`--json` is an alias
for `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

The **exit code** is derived from the tri-state verdict, so a CI step can gate on it directly:

| Exit | Verdict | Meaning |
|------|---------|---------|
| `0` | PASS | Authentic and assured (or UNVERIFIED when relaxed by `--fail-on=fail`). |
| `1` | FAIL | Hard failure — forged/wrong-repo signature, non-allowlisted attestor, or a required check failed. |
| `3` | UNVERIFIED | Soft — not-yet-anchored, no independent witness, or a required check missing. |
| `2` | — | Usage error or internal crash. |

`--fail-on <fail\|unverified>` sets strictness. Default `unverified` fails on both FAIL and
UNVERIFIED; `--fail-on=fail` lets UNVERIFIED pass (exit 0, with a warning) for warn-mode adoption.

Verify a whole batch in one ledger load with `verify-all`, and verify offline against a local clone
with `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Gate it in CI** with the bundled composite action — see
[Using the GitHub Action](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

See [docs/verification.md](docs/verification.md) for the full verification guide, threat model, and key concepts.

### Use it as a library

The verification engine is exported as a stable programmatic API — embed it in your own tooling
instead of shelling out to the CLI:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Network status endpoint

The dashboard publishes a machine-readable [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)
for external polling — ledger freshness (with a frozen-ledger signal), trust-verdict counts, anchored vs.
pending partitions, and an `ok`/`degraded` rollup with reasons.

### Trust Badges

Repos can embed trust badges from the registry:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Trust & Verification

### Verify a release

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attest a release

> Attesting and running verifiers are **operator** tasks that act on a clone of this ledger, so they
> run from a checkout. Verifying a release does not — use the `npx` command above.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Checks: `sbom.present`, `provenance.present`, `signature.chain`

### Run verifiers

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Security verifier thresholds (max CVEs, allowed severities) are config-driven via `verifiers/security/config.json`.

### Run policy checks

```bash
node policy/scripts/check-policy.mjs
```

Checks: semver monotonicity, artifact hash uniqueness, required capabilities.

## Security & Threat Model

RepoMesh touches **ledger events** (signed JSON), **node manifests** (public keys + capabilities), **registry indexes** (auto-generated trust scores), and **XRPL testnet** (anchor transactions). It does **not** touch member repo source code, private keys, user credentials, or browsing data. Private signing keys never leave the CI runner. Network access is limited to the GitHub API (PR creation), XRPL testnet (anchoring), and OSV.dev (vulnerability lookups). **No telemetry** is collected or sent — zero analytics, zero crash reports, zero phone-home. See [SECURITY.md](SECURITY.md) for the full scope, required permissions, and vulnerability reporting process, and the [threat model](docs/threat-model.md) for the key-lifecycle trust boundary (why `node.json` authenticity depends on its source, and why revocation-sensitive verification should use `--anchored`).

Hardening:

- Child-process calls that interpolate variable data use `execFileSync` with array arguments; the remaining `execSync` calls use static, constant command strings — no shell-injection vectors.
- Ledger and registry JSON is parsed inside `try`/`catch` with structured, line-numbered errors; a malformed line is skipped and surfaced, never crashes the tool with a raw stack.
- Path traversal is prevented on all file operations (resolve + boundary check).
- ReDoS-safe parsing throughout (no unbounded regex).
- PEM private keys are excluded via `.gitignore`, never printed to stdout or CI logs, and written with owner-only (`0600`) permissions.

## Testing

The full `node --test` suite covers Ed25519 signatures, schema validation, Merkle tree
integrity (v1 + RFC-6962 v2), append-only invariants, path traversal prevention, anchor
verification, the trusted-attestor allowlist, and input validation across the CLI, ledger,
anchor, verifier, and tools layers.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

The test count grows as suites are added — run the command above for the current total
rather than relying on a number that drifts out of date.

## License

MIT

---

Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
