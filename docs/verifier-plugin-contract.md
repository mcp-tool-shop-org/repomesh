# RepoMesh Verifier-Plugin Contract

How to extend the trust network with new **check kinds** and **verifier nodes** — without changing
any code. Everything below is driven by a single data file, [`verifier.policy.json`](../verifier.policy.json),
validated against [`schemas/verifier.policy.schema.json`](../schemas/verifier.policy.schema.json).

> **The one invariant: registered ≠ trusted.** Registering a check kind (or a verifier node) lets it
> *participate*. It does not, by itself, earn any trust credit. Credit requires a **trusted-set
> consensus pass** for that check. A registered-but-untrusted attestation scores zero; an
> *unregistered* kind scores zero and is flagged `registered: false`.

## The check-kinds registry

Each entry under `checks` declares one check kind (e.g. `license.audit`, `sbom.present`):

```jsonc
"security.scan": {
  "category": "assurance",                 // integrity | assurance (which score it contributes to)
  "weights": { "pass": 40, "warn": 20, "fail": 0 },  // points; integrity kinds declare only `pass`
  "mode": "trusted-set",                   // open | trusted-set
  "trustedNodes": [                        // (trusted-set) only these nodes' attestations count
    "mcp-tool-shop-org/repomesh",
    "mcp-tool-shop-org/repomesh-security-verifier"
  ],
  "quorum": 1,                             // agreeing trusted attestations required
  "conflictPolicy": "fail-wins",           // how to fold conflicting results (see conflictPolicies)
  "attestorGated": true                    // (integrity only) a release cannot self-grant this
}
```

- **`mode: open`** — any node may attest this kind; the result is folded by `conflictPolicy`.
- **`mode: trusted-set`** — only nodes in `trustedNodes` count. This is how *registered ≠ trusted* is
  enforced per-check: a node can attest, but unless it's in the set its attestation earns nothing.
- **`conflictPolicy`** — a name in the `conflictPolicies` map. `fail-wins` (any trusted `fail` →
  `fail`), `majority`, or `quorum-pass`.

### Add a new check kind (data-only)

To add, say, a SAST check `sast.scan` worth 25 assurance points from a dedicated verifier node:

1. Register the verifier node: add its `org/repo` to `trustedAttestors` (and, if it should sign
   governance, `trustedPolicy`), and commit its `ledger/nodes/<org>/<repo>/node.json`.
2. Add the check to `checks`:
   ```jsonc
   "sast.scan": {
     "category": "assurance",
     "weights": { "pass": 25, "warn": 10, "fail": 0 },
     "mode": "trusted-set",
     "trustedNodes": ["mcp-tool-shop-org/repomesh-sast-verifier"],
     "quorum": 1,
     "conflictPolicy": "fail-wins"
   }
   ```
3. Open a PR. `ledger-ci` validates the policy against the schema (a malformed policy **fails
   closed**), and the scorer picks up the new kind on the next registry build. **No code change.**

That's the whole #7 contract: the scorer, the ledger validator, and the dashboard read the registry;
adding a verifier is an edit to `verifier.policy.json` + a `node.json`, reviewed in a PR.

## The node-kinds permission map

`nodeKinds` declares which **node kind** may sign which **event type**:

```jsonc
"nodeKinds": {
  "attestor": { "canSign": ["AttestationPublished"] },
  "registry": { "canSign": ["AttestationPublished", "PolicyViolation"] },
  "policy":   { "canSign": ["PolicyViolation"] }
}
```

A signer whose node `kind` is not permitted for the event type is rejected at validation. Absent
`nodeKinds` falls back to the built-in map (`attestor`/`registry` → `AttestationPublished`,
`policy`/`registry` → `PolicyViolation`).

> **Bundled floor (CLI).** The published CLI carries a non-removable bundled allowlist + node-kind
> floor. A `verifier.policy.json` fetched from a remote/untrusted source can only **narrow** trust,
> never widen it — so introducing a brand-new node *kind* in the policy is honored by the canonical
> registry build but, for third parties verifying via the CLI against a fetched policy, requires a CLI
> release that adds the kind to the bundled floor. This is deliberate: a remote policy must not be
> able to mint new trusted kinds.

## Backward compatibility (v1 → v2)

`verifier.policy.json` is at `v: 2`. Every v2 field (`nodeKinds`, `scoreableResults`, per-check
`category` / `weights` / `attestorGated`) is **optional**: a v1 policy — or a v2 policy that omits a
field — resolves, *per field*, to the historical hardcoded default. The committed v2 policy's values
mirror those defaults exactly, so scoring and validation are byte-identical to pre-#7. The only hard
requirement the schema enforces is the `trustedAttestors` allowlist.

## See also

- [`verifier.policy.json`](../verifier.policy.json) — the live policy
- [Threat model](./threat-model.md) — trust boundaries, tamper-evidence, separation of duties
- [Verification guide](./verification.md) — how a consumer verifies a release
