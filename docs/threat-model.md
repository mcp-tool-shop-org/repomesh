# RepoMesh Threat Model — Key Lifecycle & Trust Verification

This document states what RepoMesh's trust verdicts **do** and **do not** guarantee, so operators can
verify against the right source. It is deliberately blunt about the boundary; a trust tool that hides
its assumptions is worse than one that names them.

## What the key-lifecycle layer guarantees

A maintainer key can be bound to a validity window (`validFrom` / `validUntil` / `revokedAt` /
`revocationReason` / `invalidAfter`) and retired or revoked via signed `KeyRotation` / `KeyRevocation`
events. Verification is **time-aware**: a signature is trusted only if the key was valid at the
signature's *trusted time*.

- **The trusted clock is the XRPL anchor close-time** (RFC 6962 / Certificate-Transparency style): an
  anchor proves an event existed no later than the anchor transaction's ledger close-time. Offline, the
  next-best clock is the timestamp of a **bundled-trusted anchor event**. The event's own self-asserted
  `timestamp` is used only as a last resort and is **never** trusted for a *compromise* decision.
- **Compromise vs. routine rotation** (RFC 5280 §5.3.2): a routine rotation is prospective — the key's
  past signatures stay valid; it simply stops signing new releases. A **compromise** is retroactive —
  any signature whose *provable* (anchored) time is at/after the invalidity date is rejected, and a
  signature that cannot be *proven* to predate the invalidity date is rejected.
- **A compromised key with a proper revocation can no longer verify** at any of the eleven
  key-resolution sites (registry scorer, both CLI copies, ledger validator, shared verifier lib,
  attestor). This closes the original untimed-`maintainers.find` bug.
- **Tamper-resistant against a stripped `node.json`:** verifiers re-derive a key's window from the
  *signed* `KeyRotation` / `KeyRevocation` events and take the **stricter** of node.json vs. derived, so
  removing a window field from `node.json` cannot revive a key whose revocation event is present in the
  ledger — including in the *authorization* path (a revoked key cannot authorize a later rotation).
- **Non-destructive:** a key with no window fields is grandfathered (always valid), so every pre-existing
  node and event verifies exactly as before.

## The trust boundary — what verification assumes

**`node.json` is NOT in the anchored Merkle tree.** Only ledger *events* are committed to the Merkle
root that is anchored on XRPL. `node.json` (which carries maintainer public keys and windows) is a
separate file whose authenticity comes from its **source**, not from the anchor. Therefore:

1. **Verify against a trusted `node.json` source.** The canonical source is the RepoMesh ledger repo,
   where `validate-ledger` enforces (in CI, before merge) that every node.json window change is backed
   by a correctly-signed, authorized `KeyRotation` / `KeyRevocation` event (and vice-versa), and branch
   protection guards the merge. A `node.json` fetched from an **untrusted mirror, a cache, or a
   `--nodes-url` override** carries no such guarantee. Against a fully attacker-controlled `node.json` an
   attacker could, e.g., **add a brand-new maintainer key** (which has no revoking event, so it
   grandfathers) — no client-side derivation can detect this. Pin the canonical source.
2. **Truncation / reorder of the event ledger is caught at two layers.** The derive-stricter defense
   re-imposes a revocation only if the signed revocation event is *present and in causal (ledger) order*
   in the ledger the client reads. A **truncated ledger** (the revocation event removed) or a
   **reordered ledger** (the revocation moved *after* the rotation it should invalidate) would defeat
   derive-stricter alone — so two committed-manifest checks back it up:
   - **Local (tamper-EVIDENT):** the committed anchor manifests pin the Merkle root of the event
     partitions, and the committed **`all.json`** manifest pins the *whole* ledger. `validate-ledger`
     (CI + local) and `verify-release` (local path, before any trust logic) both recompute the
     manifest roots (v1 **and** RFC-6962 v2) over the loaded ledger and FAIL on any missing or
     reordered leaf. A `ledger/tests/immutability-coverage.test.mjs` drift-guard asserts `all.json`
     covers the whole ledger so this coverage cannot silently regress. This catches tampering of the
     local ledger *against the committed manifests in git*.
   - **External (tamper-PROOF) — `--anchored`:** the local manifest itself is only as trustworthy as
     the git history; an attacker who rewrites BOTH the events AND the committed manifest passes the
     local check. The **on-chain XRPL anchor** is the external root of trust: its memo binds the
     Merkle root + manifestHash + count to a validated transaction from a trusted anchor account, which
     the attacker cannot forge. For any verdict where revocation matters against a ledger you did not
     author, run **`--anchored`** — and the online resolver then uses the XRPL ledger **close-time**
     (not a self-asserted timestamp) as the trusted clock for the compromise gate.

In short: **RepoMesh proves the integrity of the anchored *event* ledger — tamper-EVIDENT locally
against the committed manifests, tamper-PROOF on-chain via `--anchored`; the authenticity of
`node.json` is a sourcing decision.** Verify the canonical ledger, anchored.

## Residual risks (named, accepted)

- **Governance-key compromise.** A `trustedPolicy` governance node can sign a `KeyRevocation` for any
  node (the recovery path for a single-key node whose only key is compromised). A compromised governance
  key is therefore a trust-root compromise (true of any PKI root). Mitigations: governance actions are
  themselves signed and anchored (auditable); register ≥2 keys for governance and other trust-critical
  nodes (TUF §6.1 — a single key is "considered insecure") so one can sign the other's revocation.
- **Single-key nodes.** Permitted (`maintainers` `minItems: 1`) for compatibility, but **trust-critical
  nodes should register ≥2 keys**. With one key, compromise recovery requires the governance path.
- **Self-asserted timestamps under a non-compromise window.** A routine-rotation decision trusts the
  event's self-asserted timestamp (the key is retired, not stolen). If a *retired* key were also quietly
  stolen and used to backdate, the routine path would not catch it — re-issue as a **compromise**
  revocation (which demands a provable anchored time) if theft is suspected.
- **Offline compromise verification trusts the anchor account's clock.** Offline (no `--anchored`), the
  "provable" time for a compromise decision is the *bundled-trusted anchor event's* timestamp, not the
  XRPL close-time. A dishonest holder of a trusted-anchor key could therefore mint a backdated anchor
  event to manufacture a "provable" pre-compromise time. The on-chain `--anchored` path closes this (it
  uses the real ledger close-time); offline verification rests on the anchor account's honesty. This is
  why the next item matters.
- **Separation of duties on the trust roots (operational, governance).** As currently deployed, the
  bundled trusted nodes (release signer, attestors, anchor account, governance) share signing material,
  so a single key compromise has outsized blast radius (it could sign releases, attestations, policy
  revocations, AND backdated anchor events). This is a deployment/governance posture, not a code defect:
  trust-critical roles SHOULD hold **distinct** keys (and ≥2 per node, TUF §6.1) so duties are separated
  and one key can sign another's revocation. Tracked for the operators of the trust roots; the code
  already supports distinct per-node keys and time-windowed rotation/revocation.

## Adopter broadcast workflow — cloned-script execution edge

Adopter `repomesh-broadcast` jobs clone `REPOMESH_LEDGER_REPO` (`mcp-tool-shop-org/repomesh` `main`) in the
`Append to ledger via PR` step and run `node anchor/xrpl/scripts/compute-root.mjs --all` and
`node registry/scripts/build-trust.mjs` from that checkout while `GH_TOKEN` (`secrets.REPOMESH_LEDGER_TOKEN`,
a token with write access to the ledger repo) is present in the step environment.

- **Trust edge:** Running unpinned scripts cloned from `repomesh` `main` inside an adopter release job is a
  cross-repo code-execution trust edge. Any compromise of `repomesh` `main` executes arbitrary Node.js code
  on the adopter's runner with `REPOMESH_LEDGER_TOKEN` in `process.env` (and inside a job whose
  `GITHUB_TOKEN` has `contents: write` on the adopter repo).
- **What limits this today:**
  - `REPOMESH_SIGNING_KEY` is bound only to the earlier `Create signed event` step and is absent from
    `Append to ledger via PR`.
  - Setup guidance recommends scoping `REPOMESH_LEDGER_TOKEN` to `contents: write` and
    `pull-requests: write` on the ledger repo, and `ledger-ci` defines `validate-ledger` and `test` jobs
    that can be configured as required status checks on `repomesh` `main` (the broadcast workflow opens a
    PR and enables auto-merge rather than pushing directly). Both the token's actual scope (especially if
    a classic PAT is used) and `main` branch protection (including required checks and required reviews)
    are **GitHub settings that cannot be verified from the repository**.
  - **Required status checks are NOT a merge control against a write-token holder:** `ledger-ci` defines
    `validate-ledger` and `test`, but a same-repo PR executes its own copy of `.github/workflows/ledger-ci.yml`
    from the PR head/merge commit (under the GitHub Actions app) and can redefine or make any check name pass;
    additionally, a job skipped by an `if:` condition reports a passing conclusion (`skipped` / `neutral`
    satisfy required status checks). `scripts/ci/event-path-guard.mjs` is kept strictly as an offline lint
    helper run inside `test`, not a merge control.
  - **Intended merge control (code-owner review):** repository rules on `main` using a ruleset with
    "Require a pull request before merging", `0` required approving reviews, and "Require review from Code
    Owners", paired with `.github/CODEOWNERS`: `* @mcp-tool-shop` followed by `/ledger/events/events.jsonl`,
    `/anchor/xrpl/manifests/all.json`, and `/registry/trust.json` with no owner. GitHub reads `.github/CODEOWNERS`
    from the PR's base branch (`main`), so event-only PRs touch only unowned paths and continue to auto-merge,
    whereas edits to any other path (`anchor/xrpl/scripts/**`, `registry/scripts/**`,
    `ledger/scripts/canonicalize.mjs`, `verifiers/lib/**`, `.github/**`, `.github/CODEOWNERS`, etc.) require
    approval from `@mcp-tool-shop`, which a Write-only account cannot grant.
  - **Admin bypass requirement:** because non-event PRs are authored by `@mcp-tool-shop` (the sole code owner)
    and authors cannot approve their own pull requests, this code-owner review configuration also requires a
    ruleset bypass for the repository `admin` role for admin merges. That admin bypass is safe **only once
    `REPOMESH_LEDGER_TOKEN` belongs to a separate non-admin account** (otherwise the bypass applies to the
    token's account as well).
  - **Current state:** **not set at the time of writing; verify in the repository settings** for all three:
    the `main` ruleset (PR requirement and code-owner review), the repository `admin` bypass, and moving
    `REPOMESH_LEDGER_TOKEN` to a dedicated non-admin account.
  - `.github/workflows/repomesh-broadcast.yml` SHA-pins its third-party GitHub Actions, whereas the
    adopter templates (`templates/repomesh-broadcast.yml` and
    `packages/repomesh-cli/templates/repomesh-broadcast.yml`) still use major-tag action references (`@v4`),
    none of the three workflows pin the cloned ledger scripts by commit, and none set
    `persist-credentials: false` on `actions/checkout`.
- **What is NOT mitigated:** `gh repo clone` fetches the unpinned `main` tip at runtime with no commit-SHA
  or digest verification. When a compromise or missing rule allows changes onto `main` — including until
  code-owner review is enabled, if `REPOMESH_LEDGER_TOKEN` belongs to an `admin` or `maintain` account, if a
  ruleset bypass or `enforce_admins` off permits unreviewed merges, or via a maintainer compromise — every
  adopter's broadcast job clones and runs scripts from the same `repomesh` `main` (`REPOMESH_LEDGER_TOKEN`
  itself is issued per adopter, not shared). Executed scripts can read and exfiltrate that adopter's
  `REPOMESH_LEDGER_TOKEN` from the environment and access workspace state (including the adopter checkout's
  git credentials when `actions/checkout` does not set `persist-credentials: false`).
- **Later options (not implemented):**
  - Enable the `main` repository ruleset (require pull requests with `0` approvals and require Code Owner
    review plus `admin` role bypass) alongside a dedicated non-admin Write-only ledger token account.
  - Commit-pinning the cloned scripts (or running a version-pinned/bundled generator, or moving manifest and
    trust regeneration off the adopter runner alongside `persist-credentials: false`).

## Reporting

Security issues: see [SECURITY.md](../SECURITY.md).
