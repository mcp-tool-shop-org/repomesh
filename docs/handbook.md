# RepoMesh Handbook

## 0. Front Matter

### 0.1 What is RepoMesh?

RepoMesh is trust infrastructure for repo networks. Repos publish signed release facts. Verifiers publish signed attestations about those releases. Anchors post cryptographic checkpoints to a public ledger. A registry computes trust scores from all of it. No runtime dependency, no blockchain token, no ceremony — just verifiable facts about software.

### 0.2 Who this is for

**Repo owners** — you want your releases to be verifiable and trusted. Start at [Section 3: Onboarding a Repo](#3-onboarding-a-repo).

**Verifier authors** — you want to build a new check (compliance, reproducibility, something custom). Start at [Section 5: How Verifiers Work](#5-how-verifiers-work).

**Consumers and auditors** — you want to verify a release before using it, or audit a repo's trust posture. Start at [Section 6: Verifying Trust](#6-verifying-trust).

**Operators and maintainers** — you run the network infrastructure (CI, anchoring, key management). Start at [Section 8: Operating RepoMesh](#8-operating-repomesh).

### 0.3 How to use this handbook

This isn't a novel — skip to what you need.

| I want to... | Go to |
|---|---|
| Onboard my repo | [Section 3](#3-onboarding-a-repo) |
| Verify a release | [Section 6](#6-verifying-trust) |
| Write a verifier | [Section 5](#5-how-verifiers-work) |
| Understand scoring | [Section 6.3](#63-what-the-scores-mean) |
| Embed trust badges | [Section 7](#7-pages-badges-and-snippets) |
| Operate the network | [Section 8](#8-operating-repomesh) |
| Understand threats | [Section 9](#9-security-model-and-threats) |
| Look up a command | [Section 10](#10-glossary-and-reference) |

---

## 1. RepoMesh in 3 Minutes

### 1.1 The mental model

```
  Your Repo                    RepoMesh Ledger               Trust Output
 ┌──────────┐                 ┌──────────────┐              ┌────────────┐
 │ Release   │──signed event──▶│ events.jsonl  │──registry───▶│ trust.json │
 │ v1.2.3    │                │ (append-only) │   build     │ scores,    │
 └──────────┘                 └──────┬───────┘              │ badges,    │
                                      │                      │ pages      │
 ┌──────────┐                        │                      └────────────┘
 │ Verifiers │──attestation──────────┘
 │ license   │   events                                     ┌────────────┐
 │ security  │                                              │ XRPL       │
 │ repro     │              ┌──────────────┐                │ Merkle     │
 └──────────┘               │ Anchor       │──tx memo──────▶│ checkpoints│
                             │ compute-root │                └────────────┘
                             └──────────────┘
```

Here's what happens:

1. **You release** — your repo's broadcast workflow sends a signed `ReleasePublished` event to the ledger.
2. **Verifiers attest** — independent nodes (license, security, repro) scan your release and publish signed `AttestationPublished` events.
3. **Registry scores** — the registry reads all events and computes integrity + assurance scores per release.
4. **Anchors checkpoint** — Merkle roots of ledger partitions get posted to the XRP Ledger. Proof that nobody rewrote history.
5. **Anyone verifies** — one command checks signatures, attestations, and anchor inclusion.

### 1.2 What RepoMesh is not

**Not a blockchain.** The ledger is a plain JSONL file in a GitHub repo. It's append-only by convention and CI enforcement, not by mining or consensus protocol.

**Not a DAO.** There's no governance token, no voting, no treasury. Nodes are GitHub repos with signing keys.

**Not a runtime dependency.** Nothing in RepoMesh runs in your production code. It's a CI-time verification layer that produces static trust artifacts.

**Not a replacement for code review.** RepoMesh verifies that releases are authentic, properly licensed, and free of known vulns. It does not verify that the code is correct or well-written.

---

## 2. Core Concepts

### Node

A GitHub repo that participates in the network. Every node has a `node.json` manifest declaring what it provides, what it consumes, and who can sign on its behalf.

```json
{
  "id": "your-org/your-repo",
  "kind": "compute",
  "provides": ["your-capability.v1"],
  "maintainers": [
    { "name": "your-org", "keyId": "ci-repo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n..." }
  ]
}
```

Full file: `ledger/nodes/<org>/<repo>/node.json`

### ReleasePublished event

The fact that a version was released. Includes commit hash, artifact SHA256 hashes, and an Ed25519 signature. This is what your broadcast workflow sends.

```json
{
  "type": "ReleasePublished",
  "repo": "your-org/your-repo",
  "version": "1.0.0",
  "commit": "abc1234",
  "artifacts": [{ "name": "your-repo-1.0.0.tgz", "sha256": "deadbeef...", "uri": "https://..." }],
  "signature": { "alg": "ed25519", "keyId": "ci-repo-2026", "value": "base64...", "canonicalHash": "sha256hex..." }
}
```

Full schema: `schemas/event.schema.json`

### AttestationPublished event

A verifier's signed opinion about a release. Contains one or more attestation results (pass/warn/fail) and a signature from the verifier node.

```json
{
  "type": "AttestationPublished",
  "repo": "your-org/your-repo",
  "version": "1.0.0",
  "attestations": [{ "type": "license.audit", "uri": "repomesh:attestor:license.audit:pass" }],
  "notes": "All 42 component licenses are in the allowlist"
}
```

### Canonical hash

A deterministic SHA256 hash of a ledger event (excluding the signature). Computed by serializing the event with sorted keys and hashing the result. This is what gets signed and what goes into the Merkle tree.

### Manifest and manifestHash

A manifest describes a Merkle partition — which events it covers, the computed root, and a chain link to the previous partition. The `manifestHash` is the SHA256 of the canonical manifest, committed alongside the manifest file.

Location: `anchor/xrpl/manifests/<partitionId>.json`

### Anchor and partition

An anchor is a Merkle root posted to the XRP Ledger as a transaction memo. A partition is the group of ledger events that root covers. Together they prove: "these events existed at this point in time, and nobody changed them since."

### Profiles

Three levels of "what counts as done":

| Profile | Evidence | Assurance checks | For |
|---|---|---|---|
| `baseline` | Optional | None | Internal tools, experiments |
| `open-source` | SBOM + provenance | License + security | Default for OSS |
| `regulated` | SBOM + provenance | License + security + repro | Compliance-critical |

Full files: `profiles/baseline.json`, `profiles/open-source.json`, `profiles/regulated.json`

### Integrity vs Assurance scores

**Integrity** (0–100): Is this release authentic? Signed, has artifacts, no policy violations, SBOM present, provenance present, signature chain verified.

**Assurance** (0–100): Is this release safe and compliant? License audit, security scan, reproducible build. Depends on the repo's profile.

Think of it this way: integrity is an identity check ("is this really from who it claims?"), assurance is a safety inspection ("is it safe to use?").

---

## 3. Onboarding a Repo

### 3.1 Requirements

Before you start:

- [ ] You have a GitHub repo (public or private)
- [ ] You can add secrets to that repo
- [ ] Your repo can run GitHub Actions
- [ ] You have Node.js 22+ installed locally

### 3.2 One command onboarding

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

This generates:

| File | Where | What it does |
|---|---|---|
| `node.json` | Your repo root | Declares your node to the network |
| `repomesh.profile.json` | Your repo root | Records your chosen profile |
| `repomesh.overrides.json` | Your repo root | Empty starter for per-repo customizations |
| `.github/workflows/repomesh-broadcast.yml` | Your repo | Release broadcast workflow |
| `repomesh-keys/<org>-<repo>/private.pem` | Local only | Your signing private key |
| `repomesh-keys/<org>-<repo>/public.pem` | Local only | Your signing public key (embedded in node.json) |

The command also adds `repomesh-keys/` to your `.gitignore`. Never commit private keys.

### 3.3 Add secrets (two only)

Go to your repo's Settings > Secrets and variables > Actions. Add:

**`REPOMESH_SIGNING_KEY`** — paste the full contents of `private.pem`. This is how your broadcast workflow signs release events.

**`REPOMESH_LEDGER_TOKEN`** — a GitHub fine-grained PAT with `contents:write` + `pull-requests:write` scoped to the ledger repo (`mcp-tool-shop-org/repomesh`). This is how your workflow opens PRs against the ledger.

That's it. Two secrets.

### 3.4 Cut a release

Create a release on GitHub (UI, CLI, whatever):

```bash
gh release create v1.0.0 --generate-notes
```

What should happen:

- [ ] `repomesh-broadcast.yml` triggers on `release: published`
- [ ] Workflow hashes your dist artifacts (SHA256)
- [ ] Workflow generates SBOM (CycloneDX) and provenance (SLSA-style)
- [ ] Workflow creates a signed `ReleasePublished` event
- [ ] Workflow uploads SBOM + provenance as release assets
- [ ] Workflow opens a PR against the ledger with your event
- [ ] Ledger CI validates the event (schema, signature, uniqueness)
- [ ] PR gets merged → your release is in the network

### 3.5 Sanity check

After the ledger PR merges and registry-ci runs:

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

You should see your release with an integrity score. Assurance checks will show as "pending" until the attestor cycle runs (every 6 hours, or trigger manually).

Common "oops" moments:

| Symptom | Likely cause |
|---|---|
| Broadcast workflow fails on signing | `REPOMESH_SIGNING_KEY` secret is wrong or missing |
| Ledger PR fails validation | Public key in `node.json` doesn't match the signing key |
| Release not found in registry | Ledger PR hasn't been merged yet |
| Assurance score is 0 | Attestor hasn't run yet — wait for the next cycle or trigger `attestor-ci` manually |

**Do this next:**
- Wait for the next attestor-ci run (every 6 hours) or trigger it: `gh workflow run attestor-ci -R mcp-tool-shop-org/repomesh`
- Check your scores again: `node registry/scripts/verify-trust.mjs --repo your-org/your-repo`

---

## 4. Profiles and Policies

### 4.1 baseline

**What it expects:** Signed releases, artifacts with hashes, signature chain verified. That's it.

**Evidence:** SBOM and provenance are optional.

**Assurance checks:** None required.

**Who should use it:** Internal tools, experiments, anything where "is it signed?" is enough.

### 4.2 open-source

**What it expects:** Everything in baseline, plus SBOM and provenance are required evidence.

**Required assurance checks:**
- `license.audit` — all component licenses must be in the allowlist
- `security.scan` — no critical/high vulnerabilities

**Thresholds:** Unknown licenses produce a warning. Critical/high vulnerabilities produce a failure.

**Who should use it:** This is the default. Use it for any OSS project that wants real trust.

### 4.3 regulated

**What it expects:** Everything in open-source, plus reproducible builds.

**Required assurance checks:**
- `license.audit` — stricter (unknown licenses fail, not warn)
- `security.scan` — stricter (moderate vulnerabilities also fail)
- `repro.build` — artifact hashes must match when rebuilt from source

**Who should use it:** Compliance-critical software (medical, financial, infrastructure).

### Required checks per profile

| Check | baseline | open-source | regulated |
|---|---|---|---|
| signed | Yes | Yes | Yes |
| hasArtifacts | Yes | Yes | Yes |
| noPolicyViolations | Yes | Yes | Yes |
| signature.chain | Yes | Yes | Yes |
| sbom.present | No | Yes | Yes |
| provenance.present | No | Yes | Yes |
| license.audit | No | Yes | Yes |
| security.scan | No | Yes | Yes |
| repro.build | No | No | Yes |

### 4.4 Overrides

Sometimes you need repo-level exceptions without changing your whole profile. That's what `repomesh.overrides.json` is for.

```json
{
  "license": {
    "allowlistAdd": ["WTFPL"],
    "treatUnknownAs": "warn"
  },
  "security": {
    "ignoreVulns": [
      { "id": "GHSA-xxx-yyy", "justification": "Not reachable in our usage — test dependency only" }
    ],
    "failOnSeverities": ["critical", "high"]
  }
}
```

**When to use overrides vs changing profile:**

- Use overrides when your profile is right but one specific dependency has a known-safe issue.
- Change your profile when the whole set of requirements doesn't match your needs.
- Override sparingly. Each one is a deviation that future auditors will ask about. The justification field exists for a reason.

**Do this next:**
- Choose your profile based on the table above
- If you need overrides, add them to `repomesh.overrides.json` in your repo root
- Re-run `verify-trust` to see the updated scores

---

## 5. How Verifiers Work

### 5.1 The verifier pattern

Every verifier follows the same flow:

```
Read ledger events
    │
    ▼
Find releases missing your check
    │
    ▼
For each release:
    ├── Fetch evidence (SBOM, provenance, source)
    ├── Evaluate (scan, audit, rebuild)
    ├── Classify result (pass / warn / fail)
    └── Emit signed AttestationPublished event
```

That's it. The verifier is a script that reads the ledger, does its check, and writes a signed event. No daemon, no API, no registration ceremony.

### 5.2 Writing a new verifier

**Folder structure:**

```
verifiers/
  your-check/
    scripts/
      verify-your-check.mjs    # Main script
    config.json                 # Check-specific config (optional)
```

**Shared helpers** (import from `verifiers/lib/common.mjs`):

| Function | What it does |
|---|---|
| `readEvents(path)` | Load JSONL ledger into array |
| `findReleaseEvent(events, repo, version)` | Find a release by repo@version |
| `hasAttestationEvent(events, repo, version, type)` | Check if an attestation already exists |
| `signEvent(event, privateKeyPem, keyId)` | Compute canonical hash + Ed25519 signature |
| `buildAttestationEvent({...})` | Build an unsigned attestation event template |
| `writeJsonlLine(outPath, obj)` | Append a JSON line to a file |
| `parseArgs(argv)` | Parse `--flag value` CLI args |
| `getOverridesForRepo(repoId)` | Load per-repo overrides |

**For SBOM-based checks,** also import from `verifiers/lib/fetch-sbom.mjs`:

| Function | What it does |
|---|---|
| `findSbomUriFromReleaseEvent(event)` | Extract SBOM URI from release attestations |
| `fetchCycloneDxComponents(uri)` | Fetch + parse CycloneDX JSON, returns `[{name, version, purl, licenses}]` |

**Required CLI flags:**

| Flag | Meaning |
|---|---|
| `--repo org/repo` | Single release mode |
| `--version 1.2.3` | Target version |
| `--scan-new` | Batch mode: find all releases missing this check |
| `--sign` | Sign the output event (requires `REPOMESH_SIGNING_KEY` env) |
| `--output file.jsonl` | Write events to file instead of stdout |

**Starter pattern** (copy and rename):

```javascript
import { readEvents, findReleaseEvent, hasAttestationEvent, signEvent,
         buildAttestationEvent, parseArgs, writeJsonlLine } from "../../lib/common.mjs";

const CHECK_TYPE = "your-check.v1";
const args = parseArgs(process.argv.slice(2));

// Find releases missing this check
const events = readEvents();
const releases = events.filter(e => e.type === "ReleasePublished");

for (const rel of releases) {
  if (hasAttestationEvent(events, rel.repo, rel.version, CHECK_TYPE)) continue;

  // Your evaluation logic here
  const result = "pass"; // or "warn" or "fail"
  const reason = "All good";

  const ev = buildAttestationEvent({
    repo: rel.repo, version: rel.version, commit: rel.commit,
    artifacts: rel.artifacts,
    attestations: [{ type: CHECK_TYPE, uri: `repomesh:attestor:${CHECK_TYPE}:${result}` }],
    notes: reason,
  });

  if (args.sign) {
    const signed = signEvent(ev, process.env.REPOMESH_SIGNING_KEY, process.env.REPOMESH_KEY_ID);
    if (args.output) writeJsonlLine(args.output, signed);
    else console.log(JSON.stringify(signed));
  }
}
```

### 5.3 Dedup rules

The ledger enforces uniqueness. For `AttestationPublished` events, the key is `(repo, version, type, sorted-attestation-types)`. This means:

- One verifier can publish `license.audit` for `repo@1.0.0`
- A *different* verifier can also publish `license.audit` for `repo@1.0.0`
- But the *same* verifier can't publish it twice

When multiple verifiers attest the same check, the registry resolves consensus using the verifier policy (fail-wins, majority, or quorum-pass).

### 5.4 Failure modes

Be loud about what went wrong. Use `warn` when the check can't complete but the release isn't necessarily bad.

| Situation | Result | Notes |
|---|---|---|
| API unreachable (OSV, SBOM fetch) | `warn` | "OSV API unreachable — cannot scan" |
| SBOM missing from release | `warn` | "SBOM not found — cannot audit licenses" |
| Docker unavailable | `warn` | "Docker not available — cannot verify reproducibility" |
| Evidence present, check passes | `pass` | Include specifics: "42 components, all allowed" |
| Evidence present, check fails | `fail` | Include what failed: "3 critical vulns found: CVE-..." |

The rule: graceful degradation, loud notes. A `warn` with a clear reason is much better than a silent skip.

**Do this next:**
- Copy the starter pattern above
- Register your verifier node in `ledger/nodes/<org>/<verifier>/node.json`
- Add your check to `verifier.policy.json`
- Test locally: `node verifiers/your-check/scripts/verify-your-check.mjs --repo org/repo --version 1.0.0`

---

## 6. Verifying Trust

### 6.1 Verify a release

**Basic verification** (signature + attestations):

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4
```

Output:

```
mcp-tool-shop-org/shipcheck@1.0.4
  Signature: VALID (keyId=ci-shipcheck-2026, node=mcp-tool-shop-org/shipcheck)
  Attestations:
    VALID sbom.present: pass
    VALID provenance.present: pass
    VALID signature.chain: pass
    VALID license.audit: pass
    VALID security.scan: pass
  Verification: PASS
```

**With anchor verification** (adds XRPL proof):

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Adds:

```
  Anchored: YES (partition=2026-02-28, root=d9cc5dd2..., tx=local)
```

**For CI gates** (structured JSON):

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --json
```

Returns:

```json
{
  "ok": true,
  "repo": "mcp-tool-shop-org/shipcheck",
  "version": "1.0.4",
  "release": {
    "timestamp": "2026-02-28T05:05:35.855Z",
    "commit": "12a73e4e",
    "artifacts": 1,
    "canonicalHash": "5643ef59...",
    "signatureValid": true,
    "signerNode": "mcp-tool-shop-org/shipcheck",
    "keyId": "ci-shipcheck-2026"
  },
  "attestations": [
    { "type": "license.audit", "result": "pass", "signatureValid": true, "signerNode": "mcp-tool-shop-org/repomesh" }
  ],
  "anchor": {
    "anchored": true,
    "partition": "2026-02-28",
    "root": "d9cc5dd2...",
    "manifestHash": "75823866...",
    "txHash": null,
    "network": "testnet"
  }
}
```

Gate on `ok === true` in your CI. That's the single boolean that means "everything checks out."

### 6.2 Verify an anchor

```bash
node anchor/xrpl/scripts/verify-anchor.mjs --tx <xrpl-tx-hash>
```

This fetches the transaction from XRPL, decodes the memo, recomputes the Merkle root from local ledger events, and confirms they match. If they match, it means the ledger contents at anchoring time haven't been altered.

What success proves:
- The Merkle root in the XRPL transaction matches what you compute locally
- The manifest hash matches
- The chain link to the previous partition is valid (if applicable)
- No events in this partition have been added, removed, or modified since anchoring

### 6.3 What the scores mean

**Integrity Score (0–100):** "Is this release who it says it is?"

| Check | Points | Meaning |
|---|---|---|
| signed | 15 | Ed25519 signature verified |
| hasArtifacts | 15 | Release includes artifact hashes |
| noPolicyViolations | 15 | No semver or hash collisions |
| sbom.present | 20 | Software bill of materials exists |
| provenance.present | 20 | Build provenance exists |
| signature.chain | 15 | Attestor independently verified the signature |

**Assurance Score (0–100):** "Is it safe to use?"

Depends on your profile. For `open-source`:

| Check | Pass | Warn | Fail | Weight |
|---|---|---|---|---|
| license.audit | 30 | 15 | 0 | 30% |
| security.scan | 40 | 20 | 0 | 40% |
| repro.build | 30 | 15 | 0 | 30% (optional) |

A friendly analogy: integrity is checking someone's ID at the door. Assurance is the safety inspection of what they brought in.

**Do this next:**
- Run `verify-release` on a repo you care about
- If the score is lower than expected, run `verify-trust` for the detailed breakdown:
  ```bash
  node registry/scripts/verify-trust.mjs --repo your-org/your-repo
  ```
- Follow the "What to do next" recommendations it prints

---

## 7. Pages, Badges, and Snippets

### 7.1 Pages site

Live at: `https://mcp-tool-shop-org.github.io/repomesh/`

| Page | What's on it |
|---|---|
| **Home** (landing page) | What RepoMesh is, quick start, live network stats |
| **Trust Index** (`/repos/`) | All registered repos with integrity + assurance scores |
| **Repo detail** (`/repos/org/repo/`) | Per-release breakdown, attestation results, badge embed code |
| **Anchors** (`/anchors/`) | All Merkle partitions with roots and XRPL tx hashes |
| **Health** (`/health/`) | Verifier uptime, pending attestations, anchor coverage |
| **Docs** (`/docs/verification.html`) | Full verification guide and threat model |

Data comes from: `registry/trust.json`, `registry/nodes.json`, `registry/verifiers.json`, `registry/anchors.json`. All generated by CI from the ledger.

### 7.2 Badges

Three badges per repo, auto-generated by `registry-ci`:

**Integrity badge:**
```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/your-org/your-repo/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/your-org/your-repo/)
```

**Assurance badge:**
```markdown
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/your-org/your-repo/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/your-org/your-repo/)
```

**Anchored badge:**
```markdown
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/your-org/your-repo/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/your-org/your-repo/)
```

Colors: green (80+), yellow (50-79), red (below 50).

### 7.3 Snippets

Pre-generated markdown snippets live at `registry/snippets/<org>/<repo>.md`. Copy-paste them into your README. Each snippet includes badge embeds, a verify-release command, and a CI gate example.

```bash
# View the snippet for your repo
cat registry/snippets/your-org/your-repo.md
```

**Do this next:**
- Copy the badge markdown into your README
- Check that the badge URLs render on GitHub (they pull from the raw `main` branch)
- Optionally copy the full snippet for a "Verified by RepoMesh" section

---

## 8. Operating RepoMesh

### 8.1 CI overview

| Workflow | Trigger | What it does |
|---|---|---|
| `ledger-ci` | PR to `ledger/**` or `schemas/**` | Validates ledger: schema, signatures, uniqueness, timestamps |
| `registry-ci` | Push to `main` touching `ledger/**` or `registry/scripts/**` | Rebuilds registry indexes (nodes, trust, deps, verifiers, anchors, badges, snippets) |
| `attestor-ci` | Every 6 hours + manual | Runs attestor + all verifiers, opens PR with new events |
| `anchor-xrpl` | Daily at midnight UTC + manual | Computes Merkle root, posts to XRPL, commits manifest |
| `pages-ci` | Push to `main` touching `registry/**`, `pages/**`, `site/**`, `docs/**` | Builds landing page + registry explorer, deploys to GitHub Pages |

All workflows use `ubuntu-latest`, have concurrency guards, and include `workflow_dispatch` for manual triggers.

### 8.2 Key management

**Key ID convention:** `ci-<reponame>-<year>` (e.g., `ci-shipcheck-2026`).

**Where keys live:**
- Private key: GitHub repo secret `REPOMESH_SIGNING_KEY` (never in git)
- Public key: `node.json` maintainers array (in git, in the ledger)

**Rotation checklist** (do this at 2am when nothing else is on fire):

1. Generate new keypair: `node tools/repomesh.mjs keygen`
2. Update `node.json` — add new maintainer entry with new keyId and public key
3. Keep the old entry (old signatures still need to verify)
4. Update the `REPOMESH_SIGNING_KEY` secret in your repo
5. Update `REPOMESH_KEY_ID` in your broadcast workflow
6. Open a PR to the ledger with the updated `node.json`
7. After merge, cut a test release to verify the new key works

**What breaks if you mess it up:**
- Wrong private key → broadcast events fail signature verification → ledger CI rejects the PR
- Missing public key in node.json → attestor can't verify your signatures → integrity score drops
- Deleted old maintainer entry → old releases can't be verified → historical scores break

### 8.3 Incident playbooks

**Ledger PR failing validation**

Symptom: `ledger-ci` fails on a PR.

1. Check the error: schema violation? signature invalid? duplicate event? timestamp too old?
2. Schema violation → the broadcasting repo's workflow is generating malformed events. Check their `repomesh-broadcast.yml`.
3. Signature invalid → key mismatch. Compare the keyId in the event with the public key in the node's `node.json`.
4. Duplicate event → the release was already broadcast. This is normal for retries. Close the PR.
5. Timestamp too old/future → clock skew on the runner. Re-trigger the workflow.

**Registry rebuild broken**

Symptom: `registry-ci` fails.

1. Check which script failed (build-trust, build-deps, build-verifiers, etc.)
2. Most common: a new event broke an assumption in the scoring logic. Check the event that was just added.
3. Run locally: `node registry/scripts/build-trust.mjs` — the error message will tell you more than CI logs.

**Attestor spamming PRs**

Symptom: Multiple attestor PRs open at once.

1. The rate limiter should prevent this (`attestor-ci` checks for open `attestor/` PRs before creating new ones).
2. If it's happening anyway: close the extra PRs, merge the most recent one.
3. Check if someone triggered `attestor-ci` manually while a PR was already open.

**Anchor failing / XRPL down**

Symptom: `anchor-xrpl` workflow fails.

1. Check XRPL connectivity: is testnet/mainnet up?
2. Check wallet balance: does the anchor wallet have XRP?
3. If XRPL is down: do nothing. The next daily run will pick up where it left off. Anchoring is eventual, not critical-path.

### 8.4 Performance and scaling

**Batching PRs:** The attestor-ci rate limiter prevents PR pile-up. If you need faster throughput, increase the cron frequency (currently every 6 hours).

**Incremental parsing:** The event cache (`registry/.event-cache.json`) avoids reparsing the full ledger on every registry build. Only new lines get parsed. If the cache gets stale, delete it — the next build will do a full parse.

**Partition sizing:** Anchor partitions are date-based by default. For high-volume networks, consider shorter partitions (hourly) to keep Merkle trees shallow.

**Do this next:**
- Verify all workflows are green: `gh run list -R mcp-tool-shop-org/repomesh --limit 10`
- If any are red, follow the playbook above
- For key rotation: schedule it before your current year's keyId expires

---

## 9. Security Model and Threats

### 9.1 What RepoMesh defends against

**Post-hoc tampering with releases.** Every release event is signed. Changing the event invalidates the signature. Changing the ledger invalidates the Merkle anchor.

**Unsigned or forged events.** Ledger CI verifies every event's signature against the registered public key before accepting it. No valid signature, no merge.

**Silent drift in evidence.** Attestations are signed and timestamped. If a verifier's opinion changes, it has to publish a new event — the old one stays in the ledger.

**History rewriting.** XRPL anchors create public, immutable checkpoints. Even if someone force-pushed the ledger repo, the Merkle root on XRPL wouldn't match the rewritten history.

**Verifier disagreement.** Consensus policies (fail-wins, majority, quorum-pass) resolve conflicting attestations. The verifier policy defines who is trusted and how conflicts resolve.

### 9.2 What it does not defend against

**Malicious maintainer signing bad code.** If a maintainer has a valid signing key and publishes a release that contains malicious code, RepoMesh will faithfully record and attest that release. The signature is valid. The SBOM is accurate. The trust score is high. RepoMesh verifies authenticity and compliance, not intent.

**Compromised signing key.** If someone steals a private key, they can sign events as that node. Defense: rotate keys immediately, publish a dispute event, and investigate which events were signed with the compromised key.

**All verifiers colluding.** If every trusted verifier in the policy agrees to lie, the consensus will reflect the lie. Defense: add more independent verifiers, use `trusted-set` mode, and monitor for disputes.

**Bugs in verifier logic.** A verifier that misclassifies a license or misses a vulnerability will produce a wrong-but-signed attestation. Defense: multiple verifiers checking the same thing, dispute events for corrections.

### 9.3 Responsible disclosure

If you find a security issue in RepoMesh itself (not in a repo it tracks):

1. Do not open a public issue.
2. Email the maintainers at the contact in `SECURITY.md` (or the repo's security advisory feature).
3. Include: what you found, steps to reproduce, potential impact.
4. We'll acknowledge within 48 hours and work on a fix.

---

## 10. Glossary and Reference

### Event types

| Type | When | Who signs |
|---|---|---|
| `ReleasePublished` | New version released | Repo maintainer |
| `AttestationPublished` | Verifier checks a release | Verifier node |
| `BreakingChangeDetected` | Breaking API change | Repo or policy node |
| `HealthCheckFailed` | Node health issue | The failing node |
| `DependencyVulnFound` | Vuln in dependency | Security verifier |
| `InterfaceUpdated` | Schema change | Repo maintainer |
| `PolicyViolation` | Network rule broken | Policy node |

### Attestation kinds

| Kind | What it checks | Verifier |
|---|---|---|
| `sbom.present` | SBOM exists in release | Attestor |
| `provenance.present` | Build provenance exists | Attestor |
| `signature.chain` | Release signature is valid | Attestor |
| `license.audit` | All licenses are allowed | License verifier |
| `security.scan` | No critical/high vulnerabilities | Security verifier |
| `repro.build` | Artifacts match when rebuilt | Repro verifier |
| `attestation.dispute` | Flags a bad attestation | Any node |

### CLI command cheat sheet

```bash
# Onboarding
node tools/repomesh.mjs init --repo org/repo --profile open-source
node tools/repomesh.mjs keygen
node tools/repomesh.mjs register-node --repo org/repo
node tools/repomesh.mjs print-secrets --key-dir repomesh-keys/org-repo

# Verification
node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.0
node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.0 --anchored
node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.0 --anchored --json
node registry/scripts/verify-trust.mjs --repo org/repo
node registry/scripts/verify-trust.mjs --repo org/repo --version 1.0.0

# Verifiers (manual run)
node verifiers/license/scripts/verify-license.mjs --repo org/repo --version 1.0.0
node verifiers/security/scripts/verify-security.mjs --repo org/repo --version 1.0.0
node verifiers/repro/scripts/verify-repro.mjs --repo org/repo --version 1.0.0
node attestor/scripts/attest-release.mjs --scan-new

# Anchoring
node anchor/xrpl/scripts/compute-root.mjs --date 2026-02-28
node anchor/xrpl/scripts/post-anchor.mjs
node anchor/xrpl/scripts/verify-anchor.mjs --tx <xrpl-tx-hash>

# Policy
node policy/scripts/check-policy.mjs
node policy/scripts/check-policy.mjs --repo org/repo

# Registry build
node registry/scripts/build-trust.mjs
node registry/scripts/build-anchors.mjs
node registry/scripts/build-badges.mjs
node registry/scripts/build-snippets.mjs
node pages/build-pages.mjs
node pages/build-stats.mjs

# Full site build
node tools/repomesh.mjs build-pages
```

### Integrity scoring weights

| Check | Points |
|---|---|
| signed | 15 |
| hasArtifacts | 15 |
| noPolicyViolations | 15 |
| sbom.present | 20 |
| provenance.present | 20 |
| signature.chain | 15 |
| **Total** | **100** |

### Assurance scoring weights (default)

| Check | Pass | Warn | Fail |
|---|---|---|---|
| license.audit | 30 | 15 | 0 |
| security.scan | 40 | 20 | 0 |
| repro.build | 30 | 15 | 0 |

### Policy checks

| Check | Severity | What it catches |
|---|---|---|
| `semver.monotonicity` | error | Version went backwards |
| `artifact.hash.collision` | error | Two releases share an artifact SHA256 |
| `registry.capability.missing` | warning | Registry node missing discovery capability |

### Key files

| File | Purpose |
|---|---|
| `schemas/event.schema.json` | Source of truth for all event validation |
| `profiles/*.json` | Profile definitions (baseline, open-source, regulated) |
| `verifier.policy.json` | Verifier trust policy (trusted-set, quorum, conflicts) |
| `ledger/events/events.jsonl` | The append-only ledger |
| `ledger/nodes/<org>/<repo>/node.json` | Node manifests |
| `registry/trust.json` | Trust scores (auto-generated) |
| `registry/nodes.json` | Node index (auto-generated) |
| `registry/verifiers.json` | Verifier index (auto-generated) |
| `registry/anchors.json` | Anchor index (auto-generated) |
| `anchor/xrpl/manifests/*.json` | Committed partition manifests |
| `templates/repomesh-broadcast.yml` | Workflow template for joining repos |

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `REPOMESH_SIGNING_KEY` | All signers | Ed25519 private key PEM |
| `REPOMESH_KEY_ID` | All signers | Key identifier (e.g., `ci-repo-2026`) |
| `REPOMESH_LEDGER_TOKEN` | Broadcast workflow | GitHub PAT for ledger PRs |
| `XRPL_SEED` | Anchor scripts | XRPL wallet seed |
| `XRPL_WS_URL` | Anchor scripts | XRPL WebSocket endpoint |

---

*Built by [MCP Tool Shop](https://mcp-tool-shop.github.io/)*
