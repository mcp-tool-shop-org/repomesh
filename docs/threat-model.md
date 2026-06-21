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

## Reporting

Security issues: see [SECURITY.md](../SECURITY.md).
