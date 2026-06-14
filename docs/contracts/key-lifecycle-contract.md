# Key Lifecycle Contract — Rotation & Revocation (big-swing #8, v2.1.0)

**Status:** Wave-0 LOCK. This is the single source of truth for the key-rotation/revocation build.
Every builder implements to THIS doc. Do not invent shapes; if a shape is wrong, fix it HERE first.

**Why this contract exists:** the v2.0.0 swarm produced 2 CRITICAL seams from resolver **drift**
across copies. The key-resolution logic lives in 7 files + 2 mirrored CLI copies. A shared predicate
implemented twice will diverge. This contract pins ONE predicate, ONE resolver API, ONE schema, and
assigns the two mirrored copies to ONE owner so they cannot diverge.

---

## 0. Standards compliance (per `.claude/rules/workflow-standards.md`)

| # | Standard | Score | Evidence |
|---|----------|-------|----------|
| 1 | PIN_PER_STEP | 2 | This contract pins the schema, the two event shapes, the predicate, and the resolver API per step; builders implement to it byte-for-byte. (3 once `wave.lock.json` records each subagent's model + prompt hash.) |
| 2 | ANDON_AUTHORITY | 2 | The build-gate agent halts the swarm on any test regression; the re-audit halts on any forged-window-probe pass. Bad output never reaches the verifier. |
| 3 | NAMED_COMPENSATORS | 2 | All build work is local + reversible to tag `pre-keyrotation-swarm-v2.1.0`. The only irreversible action (the v2.1.0 publish) is **out of scope for this swarm** and carries its own compensator table (§11). NO skip. |
| 4 | DECOMPOSE_BY_SECRETS | 3 | The predicate + trusted-time resolver are ONE shared module (the stable secret); the 11 per-site call updates are the volatile leaves. Mirrored copies assigned to one owner. |
| 5 | UNCERTAINTY_GATED_HUMANS | 2 | The single-key-compromise-recovery fork was a director gate BEFORE this lock. Decision: **governance floor + ≥2-key advisory** (§4.3). |
| 6 | EXTERNAL_VERIFIER | 2 | The composed re-audit + forged-window probe run as a different agent family than the builders; the final verdict is a large Ollama Cloud cross-family seat (`glm-4.6:cloud` / `gpt-oss:120b-cloud`). The generator's reasoning is hidden from the verifier. |

## 1. The live bug this closes

Every key-resolution site does an **untimed** `maintainers.find(m => m.keyId === keyId)` and returns the
key with **zero time check**. A compromised-but-still-listed key therefore scores full integrity and
verifies VALID. The eleven sites (all confirmed 2026-06-14):

| # | File | Function | Path kind |
|---|------|----------|-----------|
| 1 | `registry/scripts/build-trust.mjs:113` | `pemFor` (via `resolveRepoBoundKey`) | repo-bound |
| 2 | `registry/scripts/build-trust.mjs:136` | `resolveTrustedKey` | third-party |
| 3 | `ledger/scripts/verify-release.mjs:95` | inline `maintainers.find` | repo-bound |
| 4 | `ledger/scripts/validate-ledger.mjs:132` | `extractPublicKey` | repo-bound |
| 5 | `ledger/scripts/validate-ledger.mjs:191` | `resolveTrustedKey` | third-party |
| 6 | `tools/verify-release.mjs:136` | `findPublicKeyInRepo` | repo-bound |
| 7 | `tools/verify-release.mjs:160` | `findPublicKeyAcrossNodes` | third-party |
| 8 | `packages/repomesh-cli/src/verify/verify-release.mjs:111` | `extractKeyFromNode` | both |
| 9 | `verifiers/lib/common.mjs:75` | `getPublicKeyForKeyId` | shared lib |
| 10 | `attestor/scripts/attest-release.mjs:137` | inline `maintainers.find` (sig-chain) | repo-bound |
| 11 | `registry/scripts/build-trust.mjs` dispute path | reuses #1/#2 via `verifyEventSignature` | — |

**Two NON-verification sites that MUST NOT get a time gate** (they write config, they don't verify a
historical signature): `packages/repomesh-cli/src/init.mjs:76` and `tools/init-node.mjs:183`. These
register/update a maintainer key. On a rotation they MAY populate `validFrom` for the new key, but they
never apply the predicate. Touching them with a time gate is a bug.

## 2. Trust model (read before implementing the predicate)

Three facts drive the design:

1. **The signed `timestamp` field is self-asserted.** It is inside the canonical signed payload, but a
   holder of the key chooses its value. A **compromised** key can backdate it. So for *compromise*
   decisions the self-timestamp is **untrustworthy**.
2. **The XRPL anchor close-time is the only trustworthy clock.** An anchor proves the event's leaf
   existed **no later than** the anchor tx's ledger close-time (an upper bound). This is the
   Certificate-Transparency / RFC 6962 property repomesh already has. Offline, the next-best trusted
   clock is the **bundled-trusted anchor EVENT's** `timestamp` (the anchor node is in
   `BUNDLED_TRUSTED_ANCHOR_ACCOUNTS` / `trustedAttestors`, so its self-asserted time is trusted).
3. **Routine rotation vs compromise are different threats** (RFC 5280 §5.3.2):
   - *Routine rotation* — the key is retired, **not stolen**. Its past signatures are trusted; it simply
     stops being valid for new signatures at the rotation time. The self-timestamp is trustworthy.
   - *Compromise* — the key is stolen. Any signature whose **trusted (provable) time** is at/after the
     **invalidity date** is distrusted, even if the self-timestamp claims otherwise. A signature that
     cannot be *proven* (via an anchor) to predate the invalidity date is rejected.

## 3. Schema additions (non-destructive, version-dispatched)

### 3.1 `schemas/node.schema.json` — maintainer `$def` (and any CLI mirror)

Add these OPTIONAL properties to `$defs.maintainer.properties` (keep `additionalProperties: false`, so
they MUST be declared). A maintainer with **none** of them is **grandfathered = always valid**
(preserves every existing node.json + event):

```jsonc
"validFrom":        { "type": "string", "format": "date-time" },
"validUntil":       { "type": "string", "format": "date-time" },
"revokedAt":        { "type": "string", "format": "date-time" },
"revocationReason": { "type": "string", "enum": ["rotation", "compromise", "retirement"] },
"invalidAfter":     { "type": "string", "format": "date-time",
                      "description": "RFC 5280 §5.3.2 invalidity date. The trust boundary for a compromise (may precede revokedAt). Defaults to revokedAt when reason=compromise and this is absent." }
```

`maintainers` stays `minItems: 1` (the director chose the non-breaking floor — see §4.3). **Operational
rule for annotating an EXISTING key:** omit `validFrom` (do not retroactively invalidate the key's
historical signatures). `validFrom` is for the *new* key minted by a rotation.

### 3.2 `schemas/event.schema.json` AND `packages/repomesh-cli/schemas/event.schema.json` — conditional envelope

`KeyRotation`/`KeyRevocation` carry no `version`/`commit`/`artifacts`. Restructure the schema so the
required-set is **type-dispatched** — the release-family keeps its EXACT current requirements (so every
existing event still validates); the key-family requires a `key` object instead.

1. Add `KeyRotation`, `KeyRevocation` to the `type` enum.
2. Add a top-level optional `key` property (the `$defs.keyLifecycle` object below).
3. Replace the single top-level `required` with `allOf` conditionals:
   - **Base required (all types):** `["type", "repo", "timestamp", "signature"]`.
   - **`if` type is one of {ReleasePublished, AttestationPublished, BreakingChangeDetected,
     HealthCheckFailed, DependencyVulnFound, InterfaceUpdated, PolicyViolation} `then` required:**
     `["version", "commit", "artifacts", "attestations"]` (today's full set — unchanged behavior).
   - **`if` type is one of {KeyRotation, KeyRevocation} `then` required:** `["key"]`, and
     `version`/`commit`/`artifacts` are NOT required (and `artifacts` `minItems:1` does not apply
     because the array is absent).

`$defs.keyLifecycle`:

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["action"],
  "properties": {
    "action":        { "type": "string", "enum": ["rotate", "revoke"] },
    "retiringKeyId": { "type": "string" },
    "newKeyId":      { "type": "string" },
    "newPublicKey":  { "type": "string", "minLength": 32, "maxLength": 600 },
    "effectiveAt":   { "type": "string", "format": "date-time" },
    "revokedKeyId":  { "type": "string" },
    "reason":        { "type": "string", "enum": ["rotation", "compromise", "retirement"] },
    "invalidAfter":  { "type": "string", "format": "date-time" }
  }
}
```

The schema enforces shape; **semantic** required-fields-per-action (`rotate` => retiringKeyId+newKeyId+
newPublicKey+effectiveAt; `revoke` => revokedKeyId+reason, and invalidAfter when reason=compromise) are
enforced by `validate-ledger` (§8) because JSON-Schema `if/then` nesting on `key.action` is brittle —
keep the schema permissive on the sub-object and let the validator give the actionable error.

## 4. The two event types

### 4.1 `KeyRotation` (prospective — past signatures stay valid)

```jsonc
{
  "type": "KeyRotation",
  "repo": "mcp-tool-shop-org/foo",
  "timestamp": "2026-06-14T12:00:00Z",
  "key": {
    "action": "rotate",
    "retiringKeyId": "mike-2026-01",
    "newKeyId": "mike-2026-06",
    "newPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "effectiveAt": "2026-06-14T12:00:00Z"
  },
  "signature": { "alg": "ed25519", "keyId": "mike-2026-01", "value": "...", "canonicalHash": "..." }
}
```

- **Authorized signer:** the **retiring key itself** (`signature.keyId === key.retiringKeyId`, proves
  possession) **OR** a `trustedPolicy` node's key.
- **node.json effect (the authoritative read surface):** retiring key gets `validUntil = effectiveAt`,
  `revokedAt = effectiveAt`, `revocationReason = "rotation"`; new key appended with
  `validFrom = effectiveAt`. Signatures of the retiring key with trusted time `< effectiveAt` stay VALID.

### 4.2 `KeyRevocation` (reason-dispatched)

```jsonc
{
  "type": "KeyRevocation",
  "repo": "mcp-tool-shop-org/foo",
  "timestamp": "2026-06-20T09:00:00Z",
  "key": {
    "action": "revoke",
    "revokedKeyId": "mike-2026-01",
    "reason": "compromise",
    "invalidAfter": "2026-06-18T00:00:00Z"
  },
  "signature": { "alg": "ed25519", "keyId": "<surviving-node-key-or-trustedPolicy>", "value": "...", "canonicalHash": "..." }
}
```

- **Authorized signer:** a **surviving maintainer key of the SAME node** (`signature.keyId !==
  revokedKeyId` AND that surviving key is itself currently valid) **OR** a `trustedPolicy` node's key
  (the governance floor — §4.3).
- **node.json effect:** revoked key gets `revokedAt = timestamp`, `revocationReason = reason`, and
  (when compromise) `invalidAfter = key.invalidAfter`.

### 4.3 Director decision (single-key compromise recovery) — LOCKED

**Floor + posture (both):**
- **Governance floor:** a node in `verifier.policy.json.trustedPolicy` MAY sign a `KeyRevocation` for ANY
  node. This is the recovery path when a node's only key is compromised (no surviving sibling to sign).
- **>=2-key posture (advisory, NOT enforced):** docs recommend trust-critical nodes register >=2 keys
  (TUF §6.1: a single key/threshold-1 is "considered insecure") so one can sign the other's revocation
  without invoking governance. `maintainers` stays `minItems: 1` — single-key nodes keep verifying.

## 5. The shared module (the stable secret) — TWO MIRRORED COPIES, ONE OWNER

Create **`verifiers/lib/key-window.mjs`** (repo-root scripts import this) and an **identical** mirror
**`packages/repomesh-cli/src/verify/key-window.mjs`** (the published CLI is self-contained and cannot
import across the package boundary — same reason the two `verify-release.mjs` copies exist). The two
files are byte-identical except for any import path. **ONE agent owns BOTH.** A drift test (§9) asserts
the predicate halves stay identical.

### 5.1 Pure predicate API (no I/O — fully unit-testable)

```js
// keyWindow(maintainer) -> normalized window. Tolerant: absent fields => open.
//   { validFrom:Date|null, validUntil:Date|null, revokedAt:Date|null,
//     revocationReason:string|null, invalidAfter:Date|null, isWindowed:boolean }
export function keyWindow(maintainer) { ... }

// isKeyValidForSignature(maintainer, trustedTime) -> { valid:boolean, reason:string|null }
//   trustedTime = { time: Date|null, provable: boolean, source: 'xrpl'|'anchor-event'|'self'|'none' }
export function isKeyValidForSignature(maintainer, trustedTime) { ... }
```

**Exact predicate logic (implement verbatim):**

```
w = keyWindow(maintainer)
if (!w.isWindowed) return { valid: true, reason: null }     // GRANDFATHER — current behavior
t = trustedTime.time
if (t === null) return { valid: false, reason: 'no resolvable signature time for a windowed key' }
if (w.validFrom  && t <  w.validFrom)  return { valid:false, reason:'signature predates validFrom' }
if (w.validUntil && t >= w.validUntil) return { valid:false, reason:'signature at/after validUntil (key rotated out)' }
if (w.revokedAt) {
  if (w.revocationReason === 'compromise') {
    const boundary = w.invalidAfter ?? w.revokedAt
    if (t >= boundary)         return { valid:false, reason:'signature at/after compromise invalidity date' }
    if (!trustedTime.provable) return { valid:false, reason:'compromised key requires a provable (anchored) signature time' }
  } else { // 'rotation' | 'retirement' — prospective; past signatures trusted
    if (t >= w.revokedAt)      return { valid:false, reason:'signature at/after revocation' }
  }
}
return { valid: true, reason: null }
```

### 5.2 Trusted-time resolver — SYNC + async variants

Most sites (build-trust, validate-ledger, tools, verifiers/common, attestor) run **synchronously over
the local ledger offline**. Do NOT force `async` up those sync call-chains — that is a large, risky
refactor. The helper exports BOTH:

```js
// resolveTrustedSignatureTimeSync(ev, ctx) -> { time:Date|null, provable:boolean, source }
// OFFLINE rungs only (sufficient for every offline scorer/validator AND the regression tests):
//   'anchor-event' : the bundled-trusted anchor AttestationPublished.timestamp for the EARLIEST anchor
//                    whose partition includes ev's leaf.   provable:true   (rung-2 trust gate, below)
//   'self'         : ev.timestamp (self-asserted).         provable:false
//   'none'         : ev has no timestamp.                  time:null, provable:false
export function resolveTrustedSignatureTimeSync(ev, ctx) { ... }

// resolveTrustedSignatureTime(ev, ctx) -> Promise<{ time, provable, source }>
// ONLINE: tries rung-1 first, then falls back to the sync result. Used ONLY by the CLI online path.
//   'xrpl' : XRPL close-time of that earliest anchor (via ctx.anchorCloseTime). provable:true
export async function resolveTrustedSignatureTime(ev, ctx) { ... }
```

- `ctx` carries: the loaded `events`, the anchor-lookup (`findAnchorForHash` in CLI / the partition
  logic at root), the bundled-trusted-anchor check, and an **optional** `anchorCloseTime(txHash,
  network)` async fn (only the CLI provides it; everyone else omits it and uses the sync resolver).
- **`anchorCloseTime` source (NEW, small):** `verify-anchor.mjs:fetchAndValidateTx` must additionally
  return the XRPL `txData.date` (Ripple epoch seconds) converted to a `Date`
  (`new Date((rippleEpochSeconds + 946684800) * 1000)`); thread it out through `verifyAnchorTx` as
  `closeTime`. Offline (`REPOMESH_FORCE_OFFLINE`/no network) => skip rung 1, use rung 2.
- **Rung-2 trust gate:** the anchor event used for `anchor-event` time MUST itself pass the existing
  D18 bundled-trusted-signer check (an untrusted/forged anchor's timestamp is NOT a trusted clock =>
  fall through to `self`).

### 5.3 Resolution-site wrapper

Each verification site, AFTER it finds the maintainer by keyId and BEFORE it returns/uses the key, calls
the predicate. The site already has (or can cheaply build) the `ev` being verified and a `ctx`:

```js
const tt  = await resolveTrustedSignatureTime(ev, ctx)
const dec = isKeyValidForSignature(maintainer, tt)
if (!dec.valid) return null /* or the site's existing "no key"/error shape, carrying dec.reason */
```

Sites that currently `throw`/`fail` on no-key (validate-ledger, attestor, verifiers/common) surface
`dec.reason` in their existing structured error. Sites that return `null` (CLI, tools, build-trust)
return their existing null shape so the higher layer reports "no public key for keyId" with the reason.
**Behavior on a grandfathered key is byte-identical to today.**

## 6. node.json windows are the read surface; ledger events are the authorization

- **Verifiers (sites 1–11) read window state from `node.json` maintainer fields.** This is what closes
  the live bug with the least blast radius (node.json is already loaded at every site).
- **`KeyRotation`/`KeyRevocation` events are the signed authorization** for those node.json changes. The
  ledger validator (§8) binds the two: a node.json revocation with no backing signed event is a
  violation, and a signed revocation not reflected in node.json is a violation. This makes the window
  state tamper-evident — neither node.json nor the ledger can revoke (or un-revoke) unilaterally.

## 7. Emission (reserved => emitted)

Add `repomesh key rotate` / `repomesh key revoke` CLI subcommands (and/or
`attestor/scripts/emit-key-event.mjs`) that build, sign, and append a `KeyRotation`/`KeyRevocation`
event AND apply the corresponding node.json window edit in the same commit. Reuse `signEvent`
(`verifiers/lib/common.mjs`). This is additive; the events are validated by §8.

## 8. `validate-ledger.mjs` — new event validation + binding

For each `KeyRotation`/`KeyRevocation` event, validate-ledger asserts:
1. Schema-valid (conditional envelope, §3.2).
2. Semantic shape per `action` (§3.2 note): rotate => retiringKeyId+newKeyId+newPublicKey+effectiveAt;
   revoke => revokedKeyId+reason, and invalidAfter present when reason=compromise.
3. Signature verifies (resolve the signing key: same-node repo-bound OR `trustedPolicy`).
4. Signer is **authorized** (§4.1/§4.2): surviving same-node key (!= the revoked/retiring key, itself
   currently valid) OR a `trustedPolicy` node.
5. **Binding:** the target node.json maintainer entry reflects the event (revoke => revokedAt/reason/
   invalidAfter match; rotate => retiring key has validUntil=effectiveAt + the new key exists with
   validFrom=effectiveAt). Mismatch => `fail(...)` with an actionable message.

## 9. Load-bearing tests (test-first; these are the bug's regression)

Each builder writes tests BEFORE the fix. Minimum matrix, per verification surface (CLI, build-trust,
validate-ledger, tools, verifiers/common, attestor) — share fixtures where possible:

1. **Grandfather:** a maintainer with no window fields verifies VALID (today's behavior) — proves
   non-destructive.
2. **Compromise rejects post-compromise:** key has `revokedAt`+`reason:compromise`+`invalidAfter=C`; an
   event with **provable anchored time >= C** => REJECTED.
3. **Compromise keeps provably-old:** SAME key; an event **provably anchored < C** => VALID (compromise
   does not retroactively kill provably-old signatures).
4. **Compromise rejects unprovable:** SAME key; an **unanchored** event whose self-timestamp claims
   `< C` => REJECTED (`provable:false` under compromise).
5. **Routine rotation, prospective only:** key has `validUntil=R`/`reason:rotation`; event time `< R`
   => VALID; event time `>= R` => REJECTED; and a DIFFERENT valid key on the same node is unaffected.
6. **Drift test:** `verifiers/lib/key-window.mjs` and `packages/repomesh-cli/src/verify/key-window.mjs`
   predicate halves are byte-identical (normalize import lines).

**The forged-window probe (re-audit, §10):** a real, internally-consistent `ReleasePublished` signed by
a now-compromise-revoked key with a backdated self-`timestamp`, anchored after `invalidAfter` (or
unanchored). EVERY layer must REJECT it. Mirrors the v2.0.0 forged-anchor probe (find it in the repo).

## 10. Swarm shape & exclusive file ownership

| Agent | Owns (exclusive) | Depends on |
|-------|------------------|------------|
**Wave A (barrier, 2 agents):**

| Agent | Owns (exclusive) | Depends on |
|-------|------------------|------------|
| **A-shared** | `verifiers/lib/key-window.mjs` + `packages/repomesh-cli/src/verify/key-window.mjs` (BOTH mirrors) + their unit tests (`verifiers/tests/key-window.test.mjs`, `packages/repomesh-cli/tests/key-window.test.mjs`) | contract only |
| **A-schema** | `schemas/node.schema.json`, `schemas/event.schema.json`, `packages/repomesh-cli/schemas/event.schema.json` (+ any node.schema mirror) + a schema-conditional test | contract only |

**Wave B (barrier, 5 agents — the law-2 cap):**

| Agent | Owns (exclusive) | Depends on |
|-------|------------------|------------|
| **B-registry** | `registry/scripts/build-trust.mjs` (sites 1,2,11) + test | A-shared |
| **B-ledger** | `ledger/scripts/verify-release.mjs` (3) + `ledger/scripts/validate-ledger.mjs` (4,5 + §8 event validation/binding) + tests | A-shared, A-schema |
| **B-cli** | `packages/repomesh-cli/src/verify/verify-release.mjs` (8) **AND** `tools/verify-release.mjs` (6,7) — the two mirrored verify copies, ONE owner — **AND** the `closeTime` addition in `packages/repomesh-cli/src/verify/verify-anchor.mjs` (rung-1 source) + tests | A-shared |
| **B-verifiers** | `verifiers/lib/common.mjs` (9) + `attestor/scripts/attest-release.mjs` (10) + tests | A-shared |
| **B-emit** | `packages/repomesh-cli/src/cli.mjs` + new `key`-subcommand module + `attestor/scripts/emit-key-event.mjs` + tests | A-shared, A-schema |

Wave order: **A-* (barrier)** → **B-* (parallel, barrier)** → **build-gate** → **re-audit + probe** →
**external verifier**. No two agents share a file. `build-trust.mjs` site 11 (dispute path) is the same
file as sites 1/2 → same owner (B-registry). **B-cli owns BOTH mirrored verify-release copies AND the
CLI `verify-anchor.mjs` closeTime** so they cannot diverge (this is the #1 drift risk — the v2.0.0
CRITICAL seams). Offline sites use `resolveTrustedSignatureTimeSync`; only B-cli's online CLI path uses
the async resolver + `closeTime`.

## 11. Invariants & compensators

**Invariants (do not break):** append-only ledger; version-dispatch non-destructive (window-less keys
grandfather as always-valid); both `verify-release` copies identical; both `key-window` copies
identical; additive (every existing valid event keeps verifying); `unscored = 0` doctrine unchanged.

**Compensators (NO skip — workflow-standards):**

| Irreversible action | Undo | Post-rollback state | Owner |
|---------------------|------|---------------------|-------|
| Build waves (all file edits) | `git reset --hard pre-keyrotation-swarm-v2.1.0` | working tree at pre-swarm save-point | coordinator |
| `npm publish @mcptoolshop/repomesh@2.1.0` (Phase-10, OUT OF SCOPE here) | `npm deprecate @mcptoolshop/repomesh@2.1.0 "<reason>"` + ship 2.1.1 patch | 2.1.0 deprecated, 2.1.1 live | director |
| `gh release create v2.1.0` (Phase-10, OUT OF SCOPE here) | `gh release delete v2.1.0` + delete tag | release withdrawn | director |

Phase-10 treatment (shipcheck → translations → landing/handbook → repo-knowledge → publish + GitHub
release) is a **separate, director-gated step** after this swarm's external verifier returns GREEN.

---

## 12. Wave-B2 — cross-family remediation (added after the external verifier)

The cross-family verifier (`glm-4.6:cloud` + `gpt-oss:120b-cloud`, independent, convergent) found two
plan-changing residuals the same-family GREEN re-audit MISSED (coordinator confirmed both in code).
Director decision: **harden now** before Phase-10.

### 12.1 Finding ① — CLI node.json-tamper / grandfather-strip bypass (HIGH)

Verifiers read window state from `node.json`. The non-`validate-ledger` verifiers (build-trust, CLI
verify-release, tools, verifiers/common, attestor) do NOT run the binding check, so a tampered
`node.json` that **strips a revoked key's window fields** re-grandfathers it → `isWindowed=false` →
VALID. The canonical GitHub path is protected by the ledger-CI binding; the exposure is a verifier
pointed at a mirror/cache/`--nodes-url` override.

**Fix — derive the window from the signed events, take the stricter.** Add to the shared module
(`verifiers/lib/key-window.mjs` + the CLI mirror, both copies, ONE owner):

```js
// deriveKeyWindowConstraints(events, repo, opts) -> Map<keyId, windowConstraint>
//   Replays KeyRotation/KeyRevocation events FOR `repo` whose signature verifies AND whose signer is
//   authorized (opts.verifyAndAuthorize(ev) -> bool, supplied per-site reusing existing machinery).
//   rotate => { validUntil:effectiveAt, revokedAt:effectiveAt, revocationReason:'rotation' } on retiringKeyId,
//             { validFrom:effectiveAt } on newKeyId.
//   revoke => { revokedAt, revocationReason:reason, invalidAfter } on revokedKeyId.
export function deriveKeyWindowConstraints(events, repo, opts) { ... }

// mergeStricterWindow(maintainer, constraint) -> maintainer-like with the MOST RESTRICTIVE window of
//   node.json + derived: validFrom=max, validUntil=min, revokedAt=min, invalidAfter=min, and
//   revocationReason='compromise' DOMINATES 'rotation'/'retirement' (compromise is strictly stricter).
//   A tampered node.json can only ADD restriction, never remove what the signed events assert.
export function mergeStricterWindow(maintainer, constraint) { ... }
```

Each verification site computes `const eff = mergeStricterWindow(maintainer,
deriveKeyWindowConstraints(events, repo, opts).get(keyId)); isKeyValidForSignature(eff, tt)`.
**Documented residual (out of scope — general ledger-completeness):** a *truncated* ledger (the signed
revocation event removed entirely) is only fully caught under anchored verification (Merkle root
mismatch); the CLI's `--anchored` already covers that. Note it; do not solve it here.

### 12.2 Finding ② — predicate fail-open on a windowed key with no resolvable boundary (MED)

If `node.json` carries `revocationReason` (a revocation intent) but `revokedAt`/`invalidAfter`/
`validUntil` are all absent/unparseable, the `if (w.revokedAt)` branch is skipped → `valid:true`.
**Fix — fail closed** in `isKeyValidForSignature`, after the grandfather check: if the key is windowed
AND a revocation intent is present (`revocationReason` set, OR a raw `revokedAt`/`invalidAfter` field
present) but NO usable boundary date resolves (`revokedAt`, `invalidAfter`, and `validUntil` all null)
→ `{ valid:false, reason:'revocation intent without a resolvable boundary date' }`. Grandfather
(window-less) keys are unaffected.

### 12.3 Finding ③ — probes/tests

- **node.json-strip probe (re-audit, cross-layer):** a compromise-revoked key with its window fields
  STRIPPED from `node.json` but the signed `KeyRevocation` event LEFT in the ledger — prove every
  non-`validate-ledger` verifier STILL rejects post-compromise signatures (via derive-stricter).
- **rotation-preempt test:** an attacker self-signs `KeyRotation(reason:'rotation', effectiveAt:future)`
  for their own compromised key; a later authorized `KeyRevocation(reason:'compromise', invalidAfter:C)`
  MUST dominate (compromise stricter) → post-C signatures REJECTED.

### 12.4 Wave-B2 ownership

| Agent | Owns | Depends |
|-------|------|---------|
| **C-shared** | `verifiers/lib/key-window.mjs` + CLI mirror (predicate fail-closed §12.2 + `deriveKeyWindowConstraints`/`mergeStricterWindow` §12.1) + unit tests incl. rotation-preempt | contract |
| **C-registry** | `registry/scripts/build-trust.mjs` — wrap site with derive-stricter + node.json-strip regression | C-shared |
| **C-ledger** | `ledger/scripts/verify-release.mjs` — wrap site with derive-stricter + regression | C-shared |
| **C-cli** | `packages/repomesh-cli/src/verify/verify-release.mjs` + `tools/verify-release.mjs` — wrap both with derive-stricter + regressions | C-shared |
| **C-verifiers** | `verifiers/lib/common.mjs` + `attestor/scripts/attest-release.mjs` — wrap with derive-stricter + regressions | C-shared |

`validate-ledger.mjs` already runs the binding check → NOT re-touched. Wave order: **C-shared
(barrier)** → **C-sites (barrier)** → **gate** → **re-audit (node.json-strip + rotation-preempt
probes)** → coordinator re-runs gate + cross-family. Only THEN Phase-10.

---

## 13. Wave-B3 — close residual ③ (cross-family re-verify) + threat-model

The cross-family re-verify confirmed ① and ② CLOSED. It found ONE real new residual ③ (coordinator
confirmed in code; also caught two model false-positives — `minDate` already treats null as no-bound,
and `verifyAndAuthorize` is internal-trusted not attacker-supplied). Director: **close ③ now**.

### 13.1 Finding ③ — authorization sub-path trusts node.json alone (HIGH on an untrusted source)

The Wave-B2 derive-stricter protects the MAIN resolution path, but the AUTHORIZATION sub-check (is a
KeyRotation/KeyRevocation's *signer* currently valid?) validates the signer against **node.json alone**
("no re-entry, avoid recursion"). Exploit: attacker holds compromise-revoked key `K_a`; serves a
tampered `node.json` that strips `K_a`'s window. Main path: derive-stricter still rejects `K_a`'s own
releases (① holds). But the auth path sees `K_a` valid in the stripped node.json → `K_a` authorizes a
`KeyRotation K_a→K_b` → `K_b` gets a fresh valid derived window → `K_b` signs a release that verifies
VALID. Trust re-established via rotation.

**Fix — order-aware single forward pass (NOT a recursive fixpoint).** Refactor
`deriveKeyWindowConstraints` to process the repo's KeyRotation/KeyRevocation events in **ledger
(append/causal) order**, accumulating a `derivedSoFar` map. For each event `E` signed by `S`, authorize
iff: (a) `E`'s signature verifies; (b) `S` is a surviving same-node key (`≠` the revoked/retiring key)
OR a `trustedPolicy` node; AND (c) `S` is VALID at `E`'s trusted time per
`isKeyValidForSignature(mergeStricterWindow(nodeJson[S], derivedSoFar[S]), timeOf(E))` — i.e. the
signer's validity ALSO uses derive-stricter, evaluated against the window state from **strictly-earlier
events only**. A revocation self-signed by the revoked key stays unauthorized. Because every event
depends only on earlier events, this is a **single forward pass → terminates, no recursion, no
mutual-revocation cycle**. After this, a stripped node.json can no longer re-authorize a key whose
revocation event precedes the rotation it tries to sign.

**Consolidation (DECOMPOSE_BY_SECRETS win):** the §4 authorization *validity decision* moves INTO the
shared module (one place). The per-site `opts` now supply only I/O — `verifySignature(ev) ->
{ok, signerKeyId, signerNodeRepo}`, `getMaintainer(keyId, nodeRepo) -> maintainer|null` (from the
relevant node.json), `timeOf(ev) -> trustedTime`, and the `trustedPolicy` set. This also deletes the 4
separate per-site `verifyAndAuthorize` implementations (a latent drift surface).

### 13.2 Inherent boundary — DOCUMENT, do not patch

`node.json` is **NOT** in the XRPL-anchored Merkle tree (only events are). So against a fully
attacker-controlled `node.json` source an attacker can ADD a brand-new maintainer key (no event to
restrict it → grandfathered VALID), or truncate the ledger (drop the revocation event). No derive
logic closes these — they are the inherent boundary: **trust verification is sound only against a
`node.json` from the trusted canonical source (validate-ledger CI binding + branch protection) and/or
with `--anchored` for the event ledger.** Coordinator writes `docs/threat-model.md` stating this +
adds the `--anchored` recommendation to README + CLI `--help`.

### 13.3 Wave-B3 ownership

| Agent | Owns | Depends |
|-------|------|---------|
| **D-shared** | `verifiers/lib/key-window.mjs` + CLI mirror — order-aware forward-pass `deriveKeyWindowConstraints` with the consolidated signer-validity authorization (§13.1) + unit tests incl. the ③ ordering case (a revoked signer cannot authorize a LATER rotation; a rotation BEFORE the signer's revocation still stands) | contract §13 |
| **D-registry** | `registry/scripts/build-trust.mjs` — adapt to the new `opts` (provide verifySignature/getMaintainer/timeOf/trustedPolicy), delete local auth logic, ③ regression | D-shared |
| **D-ledger** | `ledger/scripts/verify-release.mjs` — same adapt + ③ regression | D-shared |
| **D-cli** | `packages/repomesh-cli/src/verify/verify-release.mjs` + `tools/verify-release.mjs` — same adapt on both copies + ③ regressions | D-shared |
| **D-verifiers** | `verifiers/lib/common.mjs` + `attestor/scripts/attest-release.mjs` — same adapt + ③ regressions | D-shared |

Coordinator writes `docs/threat-model.md` (§13.2) + README/`--help` `--anchored` note. Wave order:
**D-shared (barrier)** → **D-sites (barrier)** → **gate** → **re-audit (end-to-end ③ exploit probe:
`K_a` stripped from node.json + revocation event present → `K_a→K_b` rotation → `K_b` REJECTED at every
layer; plus grandfather + all prior probes still green)** → coordinator re-gate + cross-family
re-verify. Only THEN Phase-10.
