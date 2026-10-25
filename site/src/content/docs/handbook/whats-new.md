---
title: What's new
description: What changed in RepoMesh 2.4 and 2.5.
sidebar:
  order: 5
---

This page covers 2.4.0 and 2.5.0, which ship together as 2.5.0. The full list is in the repository's [CHANGELOG.md](https://github.com/mcp-tool-shop-org/repomesh/blob/main/CHANGELOG.md).

## 2.5.0: anchor posting fails closed

Anchoring is testnet only, and `anchor/xrpl/scripts/post-anchor.mjs` now enforces that before it reads `XRPL_SEED` or opens an `xrpl.Client` connection.

- Posting is refused, with a non-zero exit and no socket opened, unless `config.network` is `"testnet"` **and** the WebSocket URL is on `KNOWN_TESTNET_WS_URLS`. The URL is `XRPL_WS_URL` if set, otherwise `config.rippledUrl`.
- The known testnet endpoints are `wss://s.altnet.rippletest.net:51233`, `wss://clio.altnet.rippletest.net:51233` and `wss://testnet.xrpl-labs.com`.
- Pointing `XRPL_WS_URL` at mainnet or an unknown URL is refused at once. The message names both the network and the URL it resolved.
- An environment variable alone can never switch posting to mainnet. That would take a reviewed commit to `anchor/xrpl/config.json` setting `"network": "mainnet"`, `"allowMainnetPosting": true` and a `mainnetAllowedEndpoints` list holding the endpoint. The funded address would also have to be added to the CLI's shipped allowlist ceiling. Neither has been done.

The guard's functions (`KNOWN_TESTNET_WS_URLS`, `normalizeWsUrl`, `assertPostingEndpoint`, `connectValidatedClient`) are exported and tested offline in `anchor/xrpl/tests/testnet-guard.test.mjs`.

## 2.5.0: a required test gate

`ledger-ci.yml` runs all 9 `node --test` suites on every pull request and on pushes to `main` that touch code. It measures coverage (`--experimental-test-coverage`) against a line floor of 57%, then runs `npm audit --audit-level=high --omit=dev` for the root, `anchor/xrpl` and `ledger`. Its `validate-ledger` and `test` jobs are required checks on `main`.

## 2.4.0: run attestations from Cognate

Cognate, the AI governance product, records experiment runs here. `AttestationPublished` events can now carry three attestation types:

| Type | URI | Digest |
|---|---|---|
| `run.preregistered` | `urn:cognate:run:prereg:<runId>` | `sha256` of the pre-registration |
| `run.outcome` | `urn:cognate:run:outcome:<runId>`, optionally ending `:prereg:<sha256>` | `sha256` of the outcome |
| `cognate.root.anchored` | `urn:cognate:root:anchored:<partitionId>` | `sha256` of the root |

The ledger validator checks across events: every `run.outcome` must reference a `runId` that already has a `run.preregistered` on the ledger, and a linked pre-registration hash must match it.

Only a `governance` node on the `trustedRunAttestors` list may sign these, and that kind may sign nothing else: not `ReleasePublished`, and not release attestations. Today the list holds one node, `mcp-tool-shop-org/cognate`.

## 2.4.0: the signing contract is checked

An Ed25519 signature must be over the 32 raw bytes of `canonicalHash` (`Buffer.from(canonicalHash, "hex")`). The validator now recognises the two common mistakes, a signature over the canonical JSON text or over the 64-character hex string, says which one it found and refuses the event.
