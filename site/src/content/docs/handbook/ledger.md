---
title: Ledger
description: Append-only event log, event types, node kinds, and the rules that keep the ledger honest.
sidebar:
  order: 2
---

The ledger is the backbone of RepoMesh. It is an append-only log of signed events stored as a single JSONL file at `ledger/events/events.jsonl` in the RepoMesh repository. Each line is one self-contained JSON event.

## Ledger rules

Every event written to the ledger must satisfy five rules. Violation of any rule causes the event to be rejected by CI validation.

| Rule | Enforcement |
|---|---|
| **Append-only** | Events are never modified or deleted. New events are appended to the JSONL file. CI rejects any diff that removes or edits an existing line. |
| **Schema-valid** | Every event conforms to `schemas/event.schema.json`. The schema is checked at write time and again in CI. |
| **Signature-valid** | Every event carries an Ed25519 signature from a registered node. The public key must be present in the node's manifest under `ledger/nodes/`. |
| **Unique** | No duplicate `(repo, version, type)` combinations are allowed. Duplicate entries are rejected. |
| **Timestamp-sane** | Event timestamps must not be more than 1 hour in the future or 1 year in the past. |

## Event types

| Event type | Emitted by | Payload summary |
|---|---|---|
| `ReleasePublished` | Compute node | Repo, version, commit SHA, artifact checksums |
| `AttestationPublished` | Attestor node | Repo, version, verifier results (sbom.present, provenance.present, signature.chain, etc.) |
| `BreakingChangeDetected` | Policy node | Repo, version pair, interface diff summary |
| `HealthCheckFailed` | Oracle node | Repo, check type, failure details, severity |
| `DependencyVulnFound` | Oracle node | Repo, dependency, CVE ID, severity, fix available |
| `InterfaceUpdated` | Compute node | Repo, version, schema diff, backward-compatible flag |
| `PolicyViolation` | Policy node | Repo, rule ID, violation details, suggested action |

All event types are defined in the single schema at `schemas/event.schema.json`.

## Event structure

Every event shares a common envelope:

```json
{
  "type": "ReleasePublished",
  "repo": "your-org/your-repo",
  "version": "1.0.0",
  "commit": "abc1234def5678...",
  "timestamp": "2026-03-05T12:00:00.000Z",
  "artifacts": [
    { "name": "package.tgz", "sha256": "abcdef...", "uri": "https://..." }
  ],
  "attestations": [],
  "notes": "",
  "signature": {
    "alg": "ed25519",
    "keyId": "ci-your-repo-2026",
    "value": "<base64-encoded-signature>",
    "canonicalHash": "<sha256-of-canonical-json>"
  }
}
```

The `canonicalHash` is computed by sorting all keys deterministically (via canonical JSON serialization), then taking the SHA-256 hash of the result (excluding the `signature` field). The `value` is the Ed25519 signature over the `canonicalHash` bytes. This design ensures that identical events always produce the same hash and that signatures can be independently verified.

## Attestation types

`AttestationPublished` events carry an `attestations` array with typed entries:

| Attestation type | Meaning |
|---|---|
| `sbom.present` | Release includes an SBOM attestation |
| `provenance.present` | Release includes build provenance |
| `signature.chain` | Signature verified against the registered public key |
| `security.scan` | Security scan completed |
| `license.audit` | License audit completed |
| `repro.build` | Reproducibility build verified |
| `policy.check` | Policy check completed |
| `ledger.anchor` | Ledger partition anchored to XRPL |

Each attestation entry includes a `uri` indicating the result (pass/fail) and source.

## Node kinds

Nodes declare their kind in `node.json`. The kind determines what event types a node is authorized to emit.

| Kind | Role | Authorized events |
|---|---|---|
| `registry` | Aggregates node metadata and trust scores | Internal bookkeeping (no ledger events) |
| `attestor` | Runs verifiers and publishes attestations | `AttestationPublished` |
| `policy` | Defines and enforces cross-repo rules | `BreakingChangeDetected`, `PolicyViolation` |
| `oracle` | Monitors external signals (CVEs, uptime, health) | `HealthCheckFailed`, `DependencyVulnFound` |
| `compute` | A regular repository that produces releases | `ReleasePublished`, `InterfaceUpdated` |
| `settlement` | Posts Merkle roots to XRPL | Internal (anchor records, not ledger events) |
| `governance` | Manages network-level decisions (upgrades, disputes) | Governance proposals (future) |
| `identity` | Manages key rotation and node identity | Key rotation records (future) |

## Ledger storage

The ledger is stored as a single JSONL (JSON Lines) file at `ledger/events/events.jsonl`. Each line is one complete event. Events are appended chronologically. The file grows over time; XRPL anchoring creates tamper-evident checkpoints by computing Merkle roots over ranges of events (partitions) and posting the root to the XRP Ledger.

Registered node manifests and profiles live under `ledger/nodes/<org>/<repo>/` with `node.json` and `repomesh.profile.json` per node.
