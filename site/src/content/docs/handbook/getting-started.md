---
title: Getting Started
description: Initialize a RepoMesh node, configure secrets, join the network, and choose a trust profile.
sidebar:
  order: 1
---

## Quick start (automated)

The fastest path from zero to a registered node:

```bash
# 1. Initialize -- generates node.json, profile, workflow, and Ed25519 keypair
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source

# 2. Add two secrets to your repo (Settings > Secrets and variables > Actions):
#    REPOMESH_SIGNING_KEY   -- your Ed25519 private key PEM
#    REPOMESH_LEDGER_TOKEN  -- a PAT with contents:write + pull-requests:write

# 3. Cut a release -- trust converges automatically
gh release create v1.0.0 --generate-notes
```

That is it. When the release workflow fires, your node signs a `ReleasePublished` event, the attestor scans for evidence, and trust scores begin converging.

## Manual join (5 steps)

If you prefer to set things up by hand:

### 1. Create `node.json`

Place this at the root of your repository:

```json
{
  "nodeId": "your-org/your-repo",
  "kind": "compute",
  "publicKey": "<your-ed25519-public-key-base64>",
  "profile": "open-source",
  "capabilities": ["release", "attest"],
  "created": "2026-03-05T00:00:00Z"
}
```

### 2. Generate an Ed25519 keypair

```bash
# Generate a private key
openssl genpkey -algorithm Ed25519 -out repomesh-signing.pem

# Extract the public key
openssl pkey -in repomesh-signing.pem -pubout -out repomesh-signing.pub

# Base64-encode the public key for node.json
cat repomesh-signing.pub | base64 -w0
```

Store the private key PEM as the `REPOMESH_SIGNING_KEY` secret. Never commit it.

### 3. Register via PR

Open a pull request against the RepoMesh registry that adds your `node.json` to `registry/nodes/your-org/your-repo.json`. The registry CI validates the schema and checks the public key format.

### 4. Add the broadcast workflow

Copy `.github/workflows/repomesh-broadcast.yml` from the templates directory. This workflow:
- Fires on `release: published`
- Signs the event with your `REPOMESH_SIGNING_KEY`
- Posts the event to the ledger via `REPOMESH_LEDGER_TOKEN`

### 5. Add secrets

Add both secrets to your repository:

| Secret | Purpose | Required scopes |
|---|---|---|
| `REPOMESH_SIGNING_KEY` | Ed25519 private key PEM for event signing | N/A (local to workflow) |
| `REPOMESH_LEDGER_TOKEN` | GitHub PAT for posting events to the ledger | `contents:write`, `pull-requests:write` |

## Trust profiles

Choose a profile based on the level of evidence your project needs:

| Profile | Evidence required | Assurance checks | Best for |
|---|---|---|---|
| `baseline` | Optional | None required | Internal tools, experiments, early-stage projects |
| `open-source` | SBOM + provenance attestation | License + security scan | Default for open-source repositories |
| `regulated` | SBOM + provenance + reproducibility proof | License + security + reproducibility | Compliance-critical, audited software |

Set the profile in your `node.json`. The attestor adjusts its expectations based on the declared profile. Nodes that do not meet their declared profile receive a **profile gap** flag in the trust index.

## What happens after you join

1. **Release event** -- when you create a release, the broadcast workflow signs and posts a `ReleasePublished` event.
2. **Attestor scan** -- the attestor picks up the event, runs verifiers (license, security, optionally reproducibility), and posts `AttestationPublished` events.
3. **Trust convergence** -- the registry aggregates all attestation scores into a composite trust profile visible on the trust index page.
4. **XRPL anchoring** -- periodically, a Merkle root of the latest ledger partition is posted to the XRP Ledger testnet, providing a tamper-evident timestamp for the entire batch.
