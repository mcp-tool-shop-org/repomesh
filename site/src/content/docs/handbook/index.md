---
title: RepoMesh Handbook
description: Release ledger and XRPL-anchored trust clock for a repo network. Separate from Attestia's event store.
sidebar:
  order: 0
---

RepoMesh turns a collection of repositories into a **cooperative network**.
Every repo becomes a node. Every release becomes a signed event.
Every claim is independently verifiable.

Today one GitHub organization, mcp-tool-shop-org, operates the log, the attestors, the policy check, and the XRPL anchor. Six registered nodes do not make six operators. An independent witness would be a party this organization does not operate.

Attestia, Cognate, and RepoMesh are three products. RepoMesh keeps this RFC 6962 ledger and the XRPL trust clock. Attestia proves that an event, a transaction, or a state transition happened, and the domain it ships is financial truth. Cognate is the AI governance domain on Attestia's event store and Merkle proofs, and it calls RepoMesh to check a release. Attestia's Merkle tree is not this ledger.

## What the network provides

- **Node manifests** -- each repo declares its identity, capabilities, and trust profile in a single `node.json`.
- **Signed events** -- releases, attestations, policy decisions, and health signals are recorded as Ed25519-signed events on an append-only ledger.
- **Shared registry** -- a flat-file registry aggregates node metadata, trust scores, and release history. No database. No server.
- **Trust profiles** -- repos earn trust through evidence, not declarations. Scores are computed from verifier attestations and ledger history.

## Three invariants

Every design decision in RepoMesh follows from three invariants:

| Invariant | Meaning |
|---|---|
| **Deterministic outputs** | Given the same inputs, every tool produces the same result. No hidden state, no ambient configuration. |
| **Verifiable provenance** | Every event carries a signature. Every score links to the attestations that produced it. Every anchor links to its XRPL transaction. |
| **Composable contracts** | Nodes, verifiers, and policies are independent. You can run one verifier or ten. You can anchor to XRPL or skip it. The network adapts. |

## Who this is for

RepoMesh is designed for organizations that manage multiple repositories and need to answer questions like:

- Which releases have been independently verified?
- What is the security posture of this dependency?
- Can we prove our release history has not been tampered with?
- How do we enforce policy across repositories without centralizing control?

## How to read this handbook

| Page | Covers |
|---|---|
| [Getting Started](/repomesh/handbook/getting-started/) | Initialize a node, configure secrets, join the network |
| [Ledger](/repomesh/handbook/ledger/) | Append-only event log, event types, node kinds |
| [Verification](/repomesh/handbook/verification/) | Release verification, attestations, trust badges, CI gates |
| [Architecture](/repomesh/handbook/architecture/) | Repo structure, XRPL anchoring, overrides system |
| [Beginners](/repomesh/handbook/beginners/) | Plain-language introduction for newcomers to trust infrastructure |
