---
title: Key Lifecycle
description: Rotate and revoke maintainer keys; how time-aware verification trusts a signature only if the key was valid at signing time.
sidebar:
  order: 4
---

Maintainer keys are not forever. A key can be **rotated** to a successor or **revoked** (e.g. after a
compromise). RepoMesh makes verification **time-aware**: a signature is trusted only if the signing key
was valid at the signature's *trusted time* — the XRPL anchor close-time, the same trusted clock the
ledger already uses.

This closes a real trust hole: before, key resolution was *untimed*, so a compromised-but-still-listed
key scored full integrity and verified `VALID`.

## The window fields

Each maintainer in a node's `node.json` can carry optional lifecycle fields. A maintainer with **none**
of them is *grandfathered* — always valid — so existing nodes are unaffected.

| Field | Meaning |
|-------|---------|
| `validFrom` | The key is not valid before this time (set on a freshly-rotated key). |
| `validUntil` | The key is not valid at/after this time (set when a key is rotated out). |
| `revokedAt` | When a revocation was recorded. |
| `revocationReason` | `rotation` \| `compromise` \| `retirement`. |
| `invalidAfter` | RFC 5280 §5.3.2 *invalidity date* — the trust boundary for a compromise (may precede `revokedAt`). |

## Rotate a key

Rotation is **prospective**: the retired key's past signatures stay valid; it simply stops signing new
releases from the effective time onward.

```bash
npx @mcptoolshop/repomesh key rotate \
  --repo your-org/your-repo \
  --retiring mike-2026-01 \
  --new-key mike-2026-06 \
  --public-key ./mike-2026-06.pub.pem \
  --effective-at 2026-06-14T12:00:00Z
```

This builds and signs a `KeyRotation` event (signed by the retiring key, which proves possession),
appends it to the ledger, and edits `node.json` so the retiring key gets `validUntil = effectiveAt` and
the new key is added with `validFrom = effectiveAt`. Pass `--dry-run` to preview without writing.

## Revoke a key

Revocation is **reason-dispatched**. A **compromise** is *retroactive* (RFC 5280 §5.3.2): any signature
whose *provable* anchored time is at/after the invalidity date is rejected, and a signature that cannot
be proven to predate it is rejected (a stolen key can backdate its own self-asserted timestamp, so only
an anchored time is trusted).

```bash
npx @mcptoolshop/repomesh key revoke \
  --repo your-org/your-repo \
  --key mike-2026-01 \
  --reason compromise \
  --invalid-after 2026-06-18T00:00:00Z
```

A `KeyRevocation` must be signed by a **surviving** key of the same node (not the revoked key itself) or
by a **governance** node listed in `verifier.policy.json` `trustedPolicy`.

### Single-key nodes

If a node's *only* key is compromised, there is no surviving key to sign its revocation. Two answers,
both shipped:

- **Governance floor.** A `trustedPolicy` node may sign a `KeyRevocation` for any node — the recovery
  path for a single-key compromise.
- **≥2-key posture (recommended).** Register at least two keys for trust-critical nodes (TUF §6.1 — a
  single key is "considered insecure") so one can sign the other's revocation without invoking
  governance.

## How verification decides

At every key-resolution site, after the verifier finds the maintainer by `keyId`:

1. It resolves the signature's **trusted time** — best-to-worst: the XRPL close-time of the earliest
   anchor that includes the event → the bundled-trusted anchor event's timestamp (offline) → the
   event's self-asserted timestamp (used only for non-compromise reasoning).
2. It checks that time against the key's window. Outside the window → the key does not resolve → the
   signature does not verify.

The window is also **re-derived from the signed, anchored `KeyRotation`/`KeyRevocation` events** and
merged most-restrictively with `node.json`, so a tampered `node.json` that strips a revocation can only
*add* restriction — it cannot revive a revoked key (this holds in the event-authorization path too: a
revoked key cannot authorize a later rotation).

## Trust boundary

`node.json` is **not** in the XRPL-anchored Merkle tree — only events are. So verification is fully
sound only against a `node.json` from the trusted canonical source (where `validate-ledger` binds window
state to signed events in CI) and/or with `--anchored`, which Merkle-verifies the ordered event ledger
(catching a truncated or reordered ledger). For any verdict where revocation matters, run `--anchored`.
See the project's `docs/threat-model.md` for the full statement.
