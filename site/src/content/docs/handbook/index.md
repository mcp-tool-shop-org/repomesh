---
title: RepoMesh Handbook
description: Turn a collection of repos into a cooperative network with node manifests, signed events, a shared registry, and multi-dimensional trust profiles.
sidebar:
  order: 0
---

RepoMesh turns a collection of repositories into a **cooperative network**.
Every repo becomes a node. Every release becomes a signed event.
Every claim is independently verifiable.

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
