---
title: Ledger
description: Append-only event log, event types, node kinds, and the rules that keep the ledger honest.
sidebar:
  order: 2
---

The ledger is the backbone of RepoMesh. It is an append-only log of signed events stored as flat JSON files in the `ledger/` directory of the RepoMesh repository.

## Ledger rules

Every event written to the ledger must satisfy five rules. Violation of any rule causes the event to be rejected by CI validation.

| Rule | Enforcement |
|---|---|
| **Append-only** | Events are never modified or deleted. New events are appended to partition files. CI rejects any diff that removes or edits an existing event. |
| **Schema-valid** | Every event conforms to its declared type schema in `schemas/events/`. The schema is checked at write time and again in CI. |
| **Signature-valid** | Every event carries an Ed25519 signature from a registered node. The public key must be present in the registry. |
| **Unique** | Each event has a deterministic ID derived from its content hash. Duplicate IDs are rejected. |
| **Timestamp-sane** | Event timestamps must be within a reasonable window of the current time. Clock drift beyond 15 minutes causes rejection. |

## Event types

| Event type | Emitted by | Payload summary |
|---|---|---|
| `ReleasePublished` | Compute node | Repo, version, commit SHA, artifact checksums, profile |
| `AttestationPublished` | Attestor node | Target event ID, verifier results, composite score |
| `BreakingChangeDetected` | Policy node | Repo, version pair, interface diff summary |
| `HealthCheckFailed` | Oracle node | Repo, check type, failure details, severity |
| `DependencyVulnFound` | Oracle node | Repo, dependency, CVE ID, severity, fix available |
| `InterfaceUpdated` | Compute node | Repo, version, schema diff, backward-compatible flag |
| `PolicyViolation` | Policy node | Repo, rule ID, violation details, suggested action |

Each event type has a JSON schema in `schemas/events/<EventType>.json`. The schemas define required fields, value constraints, and relationships to other event types.

## Event structure

Every event shares a common envelope:

```json
{
  "id": "<deterministic-content-hash>",
  "type": "ReleasePublished",
  "nodeId": "your-org/your-repo",
  "timestamp": "2026-03-05T12:00:00Z",
  "payload": { },
  "signature": "<ed25519-base64>"
}
```

The `id` is computed as `SHA-256(type + nodeId + timestamp + canonical(payload))`. This ensures that identical events always produce the same ID, and different events always produce different IDs.

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

## Partitions

The ledger is partitioned by month. Each partition is a single JSON file at `ledger/YYYY-MM.json` containing an ordered array of events. Partitions are immutable once the month closes. The settlement node computes a Merkle root for each closed partition and anchors it to XRPL.

Open partitions (the current month) can receive new events but existing events cannot be modified. The CI pipeline enforces this by checking that the diff only contains appended entries.
