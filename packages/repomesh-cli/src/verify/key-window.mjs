// RepoMesh — shared key-lifecycle trust predicate + trusted-time resolver.
//
// THE STABLE SECRET (DECOMPOSE_BY_SECRETS, contract §5). This module is the ONE place the
// time-gated key-validity decision lives. Every verification site (the 11 in contract §1)
// resolves the maintainer by keyId, then calls isKeyValidForSignature() with a trusted time
// from one of the two resolvers below. A maintainer with NO window fields is GRANDFATHERED =>
// always valid, so every existing node.json + event verifies byte-identically to today.
//
// MIRRORED COPY: packages/repomesh-cli/src/verify/key-window.mjs is byte-identical to this
// file except its import lines (the published CLI is self-contained and cannot import across
// the package boundary). A drift test asserts the two predicate halves stay identical. If you
// edit one, edit the other.
//
// PURE: no top-level I/O, no fs/network. Anchor lookups + the bundled-trusted check + the
// XRPL close-time fetch are all supplied by the caller via `ctx`, so this module stays fully
// unit-testable and importable from both the root scripts and the standalone CLI.

// canonicalReason(r) -> 'compromise' | 'rotation' | 'retirement' | null  (VER-A-002).
// Trim + lowercase, then map. The trust model only RECOGNIZES the three lowercase reasons; the
// prospective (trust-self) branch must be reachable ONLY for exactly 'rotation'/'retirement'.
// ANY non-empty UNKNOWN or mis-cased reason canonicalizes to 'compromise' — the STRICTEST gate
// (it demands a provable anchored time) — so an attacker cannot dodge the compromise gate with a
// novel reason string. Empty / non-string => null (no reason asserted). NOTE: this never returns
// "" — callers that need to know whether a RAW field was present must inspect the raw value, not
// the canonical result (keyWindow's isWindowed deliberately checks the raw field, not this).
function canonicalReason(r) {
  if (typeof r !== "string") return null;
  const s = r.trim().toLowerCase();
  if (s === "") return null;
  return s === "compromise" || s === "rotation" || s === "retirement" ? s : "compromise";
}

// keyWindow(maintainer) -> normalized window. Tolerant: absent fields => open (null).
//   { validFrom:Date|null, validUntil:Date|null, revokedAt:Date|null,
//     revocationReason:string|null, invalidAfter:Date|null, isWindowed:boolean }
// isWindowed is false ONLY when the maintainer carries NONE of the five window fields — that
// is the grandfather case that preserves today's behavior.
export function keyWindow(maintainer) {
  const m = maintainer || {};
  const toDate = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const validFrom = toDate(m.validFrom);
  const validUntil = toDate(m.validUntil);
  const revokedAt = toDate(m.revokedAt);
  const invalidAfter = toDate(m.invalidAfter);
  // VER-A-002: store the CANONICALIZED reason (trim+lowercase; unknown => 'compromise'). The
  // RAW field — not this canonical value — drives isWindowed below, so a present-but-unknown
  // reason still marks the key windowed AND is interpreted as a compromise downstream.
  const revocationReason = canonicalReason(m.revocationReason);
  // Windowed iff ANY raw window field is present on the maintainer (even an unparseable one —
  // a malformed date is a windowed-but-broken key, NOT a grandfathered key). Grandfather is the
  // strict "none of these keys exist on the object" case.
  const hasField = (k) => Object.prototype.hasOwnProperty.call(m, k) && m[k] !== undefined && m[k] !== null && m[k] !== "";
  const isWindowed =
    hasField("validFrom") || hasField("validUntil") || hasField("revokedAt") ||
    hasField("revocationReason") || hasField("invalidAfter");
  return { validFrom, validUntil, revokedAt, revocationReason, invalidAfter, isWindowed };
}

// isKeyValidForSignature(maintainer, trustedTime) -> { valid:boolean, reason:string|null }
//   trustedTime = { time: Date|null, provable: boolean, source: 'xrpl'|'anchor-event'|'self'|'none' }
//
// VERBATIM from contract §5.1. Do not reorder the checks — the order encodes the trust model:
// grandfather first; then a windowed key with no resolvable time fails closed; then the window
// edges; then the revocation semantics (compromise demands a PROVABLE pre-invalidity time,
// routine/retirement is prospective and trusts the self time).
export function isKeyValidForSignature(maintainer, trustedTime) {
  const w = keyWindow(maintainer);
  if (!w.isWindowed) return { valid: true, reason: null }; // GRANDFATHER — current behavior
  // FAIL-CLOSED (contract §12.2): a windowed key that carries a revocation INTENT
  // (revocationReason set, OR a raw revokedAt/invalidAfter field present on the maintainer)
  // but NO usable boundary date (revokedAt, invalidAfter, AND validUntil all unparseable/null)
  // must NOT fall through to valid:true. Without this, a tampered node.json could declare a
  // revocation reason while supplying no parseable boundary, skip the `if (w.revokedAt)` branch,
  // and re-grandfather the key. Grandfather (window-less) keys never reach here.
  const m = maintainer || {};
  const rawFieldPresent = (k) =>
    Object.prototype.hasOwnProperty.call(m, k) && m[k] !== undefined && m[k] !== null && m[k] !== "";
  const revocationIntent =
    w.revocationReason !== null || rawFieldPresent("revokedAt") || rawFieldPresent("invalidAfter");
  if (revocationIntent && w.revokedAt === null && w.invalidAfter === null && w.validUntil === null) {
    return { valid: false, reason: "revocation intent without a resolvable boundary date" };
  }
  const tt = trustedTime || { time: null, provable: false, source: "none" };
  const t = tt.time;
  // FAIL-CLOSED (VER-A-001): a windowed key requires a USABLE Date as its trusted time. null/
  // undefined was already rejected; an Invalid Date (`new Date("garbage")`) or a non-Date value
  // is just as unusable — every subsequent `<`/`>=` against it is a NaN compare (always false),
  // which would silently re-grandfather a compromised/out-of-window key. Reject anything that is
  // not a valid Date instance. (Grandfather/window-less keys returned earlier and are unaffected.)
  if (t === null || t === undefined || !(t instanceof Date) || Number.isNaN(t.getTime())) {
    return { valid: false, reason: "no resolvable signature time for a windowed key" };
  }
  if (w.validFrom && t < w.validFrom) {
    return { valid: false, reason: "signature predates validFrom" };
  }
  if (w.validUntil && t >= w.validUntil) {
    return { valid: false, reason: "signature at/after validUntil (key rotated out)" };
  }
  if (w.revokedAt) {
    if (w.revocationReason === "compromise") {
      const boundary = w.invalidAfter ?? w.revokedAt;
      if (t >= boundary) {
        return { valid: false, reason: "signature at/after compromise invalidity date" };
      }
      if (!tt.provable) {
        return { valid: false, reason: "compromised key requires a provable (anchored) signature time" };
      }
    } else {
      // 'rotation' | 'retirement' — prospective; past signatures trusted.
      if (t >= w.revokedAt) {
        return { valid: false, reason: "signature at/after revocation" };
      }
    }
  }
  return { valid: true, reason: null };
}

// --- Trusted-time resolvers (contract §5.2) ---------------------------------------------
//
// The `ev` is the event whose signature time we need to trust. `ctx` supplies everything the
// (pure) resolver cannot do itself:
//   ctx.findEarliestAnchorForLeaf(leafHash) -> { anchor } | null   (SYNC)
//       the EARLIEST anchor AttestationPublished whose partition includes leafHash. Callers at
//       the repo root build this from the local ledger partition logic; the CLI offline path
//       builds it from findAnchorForHash. Returns the anchor EVENT (an AttestationPublished).
//   ctx.isBundledTrustedAnchor(anchorEvent) -> boolean             (rung-2 trust gate, §5.2)
//       true iff that anchor event passes the existing D18 bundled-trusted-signer check. An
//       untrusted/forged anchor's timestamp is NOT a trusted clock => fall through to 'self'.
//   ctx.anchorCloseTime(txHash, network) -> Promise<Date|null>     (ASYNC, optional; CLI only)
//       the XRPL ledger close-time of that earliest anchor's tx. Only the online CLI provides it.
//
// leafHash for ev is its signature.canonicalHash (the same leaf the Merkle tree commits to).

function leafHashOf(ev) {
  const h = ev?.signature?.canonicalHash;
  return typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h) ? h : null;
}

function selfTime(ev) {
  const ts = ev?.timestamp;
  if (ts === undefined || ts === null || ts === "") return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Find the earliest TRUSTED anchor for ev's leaf via ctx, applying the rung-2 trust gate.
// Returns the anchor event (trusted) or null.
function trustedAnchorForEv(ev, ctx) {
  const leaf = leafHashOf(ev);
  if (!leaf) return null;
  if (typeof ctx?.findEarliestAnchorForLeaf !== "function") return null;
  const found = ctx.findEarliestAnchorForLeaf(leaf);
  const anchorEvent = found?.anchor || found || null;
  if (!anchorEvent) return null;
  // Rung-2 trust gate (§5.2): the anchor event MUST itself pass the bundled-trusted-signer
  // check, else its self-asserted timestamp is not a trusted clock.
  if (typeof ctx?.isBundledTrustedAnchor === "function" && !ctx.isBundledTrustedAnchor(anchorEvent)) {
    return null;
  }
  return anchorEvent;
}

function anchorEventTime(anchorEvent) {
  const ts = anchorEvent?.timestamp;
  if (ts === undefined || ts === null || ts === "") return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

// resolveTrustedSignatureTimeSync(ev, ctx) -> { time:Date|null, provable:boolean, source }
// OFFLINE rungs only (sufficient for every offline scorer/validator AND the regression tests):
//   'anchor-event' : the bundled-trusted anchor's timestamp for the EARLIEST anchor whose
//                    partition includes ev's leaf.  provable:true   (rung-2 trust gate applied)
//   'self'         : ev.timestamp (self-asserted).  provable:false
//   'none'         : ev has no usable timestamp.     time:null, provable:false
export function resolveTrustedSignatureTimeSync(ev, ctx) {
  // Rung 2: trusted anchor EVENT timestamp (offline-provable upper bound).
  const anchorEvent = trustedAnchorForEv(ev, ctx);
  if (anchorEvent) {
    const t = anchorEventTime(anchorEvent);
    if (t !== null) return { time: t, provable: true, source: "anchor-event" };
  }
  // Rung 3: self-asserted time (NOT provable).
  const t = selfTime(ev);
  if (t !== null) return { time: t, provable: false, source: "self" };
  // Rung 4: no resolvable time at all.
  return { time: null, provable: false, source: "none" };
}

// resolveTrustedSignatureTime(ev, ctx) -> Promise<{ time, provable, source }>
// ONLINE: tries rung-1 first, then falls back to the sync result. Used ONLY by the CLI online path.
//   'xrpl' : XRPL close-time of that earliest TRUSTED anchor (via ctx.anchorCloseTime). provable:true
// Offline (no ctx.anchorCloseTime, or it yields null) => fall back to the sync ladder (rung 2+).
export async function resolveTrustedSignatureTime(ev, ctx) {
  // Rung 1: XRPL close-time of the earliest TRUSTED anchor for ev's leaf. The same rung-2 trust
  // gate applies — we only consult the close-time of an anchor we already trust (a forged anchor
  // is excluded before we ever ask the network for its tx time).
  if (typeof ctx?.anchorCloseTime === "function") {
    const anchorEvent = trustedAnchorForEv(ev, ctx);
    if (anchorEvent) {
      const txHash = anchorEvent.__txHash ?? ctx?.anchorTxHash?.(anchorEvent) ?? null;
      const network = anchorEvent.__network ?? ctx?.anchorNetwork?.(anchorEvent) ?? null;
      try {
        const closeTime = await ctx.anchorCloseTime(txHash, network);
        if (closeTime instanceof Date && !Number.isNaN(closeTime.getTime())) {
          return { time: closeTime, provable: true, source: "xrpl" };
        }
      } catch {
        // Network failure on the close-time fetch is not a verdict — fall back to the offline ladder.
      }
    }
  }
  // Rungs 2–4: the offline ladder (anchor-event / self / none).
  return resolveTrustedSignatureTimeSync(ev, ctx);
}

// --- Derive-the-stricter-window hardening (contract §12.1) ------------------------------
//
// Finding ① (CLI node.json-tamper / grandfather-strip bypass): verifiers read window state
// from node.json, and the non-validate-ledger sites do NOT run the ledger binding check. A
// tampered node.json that STRIPS a revoked key's window fields re-grandfathers it
// (isWindowed=false => VALID). The defence: derive the window independently from the SIGNED
// KeyRotation/KeyRevocation events and merge in the MOST RESTRICTIVE of node.json + derived.
// A tampered node.json can then only ADD restriction, never remove what the signed events
// assert. (A *truncated* ledger — the signed event removed entirely — is out of scope here;
// only anchored verification's Merkle-root check catches that. See §12.1 documented residual.)

// Parse a date-ish value to a Date or null (same tolerance as keyWindow's toDate).
function toDateOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// revocationReason precedence: 'compromise' DOMINATES everything (it is strictly stricter —
// it demands a PROVABLE pre-invalidity time). Among the non-compromise reasons the predicate
// behaves identically (prospective), so any deterministic order is fine; we keep the present
// one. null (no reason) ranks lowest.
const REASON_RANK = { compromise: 3, retirement: 2, rotation: 1 };
function reasonRank(r) {
  // VER-A-002: rank the CANONICALIZED reason, so an unknown/mis-cased reason (=> 'compromise')
  // ranks 3 and DOMINATES merges. null (no reason) ranks lowest. Belt-and-suspenders even though
  // keyWindow/applyEventConstraint already store canonical values.
  const c = canonicalReason(r);
  return c && REASON_RANK[c] ? REASON_RANK[c] : 0;
}
function stricterReason(a, b) {
  return reasonRank(b) > reasonRank(a) ? b : a ?? b ?? null;
}

// Min of two Date|null treating null as "no bound" (the OTHER side wins). Used for validUntil,
// revokedAt, invalidAfter where the EARLIER bound is the more restrictive one.
function minDate(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() <= b.getTime() ? a : b;
}
// Max of two Date|null treating null as "no bound". Used for validFrom where the LATER lower
// bound is more restrictive.
function maxDate(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

// Fold a single derived constraint into an accumulator constraint, taking the stricter of each
// axis. Both are normalized {validFrom,validUntil,revokedAt,revocationReason,invalidAfter} with
// Date|null values (revocationReason is string|null). Returns a NEW object.
function foldStricter(acc, add) {
  return {
    validFrom: maxDate(acc.validFrom ?? null, add.validFrom ?? null),
    validUntil: minDate(acc.validUntil ?? null, add.validUntil ?? null),
    revokedAt: minDate(acc.revokedAt ?? null, add.revokedAt ?? null),
    invalidAfter: minDate(acc.invalidAfter ?? null, add.invalidAfter ?? null),
    revocationReason: stricterReason(acc.revocationReason ?? null, add.revocationReason ?? null),
  };
}

const EMPTY_CONSTRAINT = {
  validFrom: null,
  validUntil: null,
  revokedAt: null,
  invalidAfter: null,
  revocationReason: null,
};

// The keyId DIRECTLY AFFECTED by a key-lifecycle event (the one whose authority is being
// reduced): the revoked key for a revoke, the retiring key for a rotate. A signer is NEVER an
// authorized "surviving same-node key" for the very key it is retiring/revoking (§4.1/§4.2).
function affectedKeyIdOf(ev) {
  const key = ev?.key || {};
  if (ev?.type === "KeyRevocation") return key.revokedKeyId ?? null;
  if (ev?.type === "KeyRotation") return key.retiringKeyId ?? null;
  return null;
}

// Apply a single key-lifecycle event's constraint(s) into a Map<keyId, constraint> accumulator,
// folding stricter on collision. Pure; mutates `out`. Shared by the order-aware and legacy paths
// so the rotate/revoke shapes (and the §12.3 compromise-dominates fold) stay identical.
function applyEventConstraint(out, ev) {
  const apply = (keyId, add) => {
    if (typeof keyId !== "string" || keyId === "") return;
    const prev = out.get(keyId) ?? EMPTY_CONSTRAINT;
    out.set(keyId, foldStricter(prev, add));
  };
  const key = ev.key || {};
  if (ev.type === "KeyRotation" && key.action === "rotate") {
    const effectiveAt = toDateOrNull(key.effectiveAt);
    apply(key.retiringKeyId, {
      validFrom: null,
      validUntil: effectiveAt,
      revokedAt: effectiveAt,
      invalidAfter: null,
      revocationReason: "rotation",
    });
    apply(key.newKeyId, {
      validFrom: effectiveAt,
      validUntil: null,
      revokedAt: null,
      invalidAfter: null,
      revocationReason: null,
    });
  } else if (ev.type === "KeyRevocation" && key.action === "revoke") {
    const revokedAt = toDateOrNull(ev.timestamp);
    const invalidAfter = toDateOrNull(key.invalidAfter);
    // VER-A-002: canonicalize the revoke reason (trim+lowercase; unknown => 'compromise'); an
    // ABSENT reason still defaults to 'compromise' (the strictest), matching prior behavior.
    const reason = canonicalReason(key.reason) ?? "compromise";
    apply(key.revokedKeyId, {
      validFrom: null,
      validUntil: null,
      revokedAt,
      invalidAfter,
      revocationReason: reason,
    });
  }
}

// Is `ev` a key-lifecycle event (the only kind that contributes a window constraint)?
function isKeyEvent(ev) {
  return !!ev && (ev.type === "KeyRotation" || ev.type === "KeyRevocation");
}
// Does `ev` belong to `repo`? A null/undefined `repo` filter matches every event.
function repoMatches(ev, repo) {
  return repo === undefined || repo === null || ev.repo === repo;
}

// deriveKeyWindowConstraints(events, repo, opts) -> Map<keyId, constraint>
//   Replays the repo's KeyRotation/KeyRevocation events into a per-keyId window-constraint map,
//   ready to feed mergeStricterWindow. Events for other repos, of other types, or whose signer is
//   not authorized/valid contribute NOTHING (fail-closed). The returned constraints are normalized
//   with Date|null axes.
//
//   rotate => retiringKeyId gets { validUntil:effectiveAt, revokedAt:effectiveAt,
//             revocationReason:'rotation' }; newKeyId gets { validFrom:effectiveAt }.
//   revoke => revokedKeyId gets { revokedAt, revocationReason:reason, invalidAfter }.
//   (revoke uses ev.key.invalidAfter when present, else null — the predicate's boundary falls
//    back to revokedAt when invalidAfter is absent, matching §5.1.)
//   Multiple events touching the same keyId fold with foldStricter, so a rotation followed by a
//   compromise-revocation on the SAME key yields a single constraint where compromise dominates
//   (the §12.3 rotation-preempt case).
//
// ONE supported opts shape — the order-aware single forward pass (§13.1 consolidation). Supply:
//     { verifySignature(ev) -> { ok, signerKeyId, signerNodeRepo },
//       getMaintainer(keyId, nodeRepo) -> maintainer|null,
//       timeOf(ev) -> trustedTime,
//       trustedPolicy: Set<nodeRepo> }
//   Iterate events in LEDGER (array) ORDER, accumulating `derivedSoFar`. An event E signed by S is
//   applied iff (a) verifySignature(E).ok; (b) S is a surviving same-node key (signerKeyId != the
//   revoked/retiring keyId AND signerNodeRepo === E.repo) OR a trustedPolicy node; AND (c) S is VALID
//   at timeOf(E) per isKeyValidForSignature(mergeStricterWindow(getMaintainer(signerKeyId,
//   signerNodeRepo), derivedSoFar.get(signerKeyId)), timeOf(E)). NOTE (c) uses derivedSoFar — the
//   window state from STRICTLY-EARLIER events only — so a stripped node.json cannot re-authorize a
//   key whose revocation event came earlier. Single forward pass => terminates, NO recursion, NO
//   fixpoint loop, NO mutual-revocation cycle. A revocation self-signed by the revoked key is NOT
//   authorized (path-a fails; path-b only via trustedPolicy). This CONSOLIDATES the §4 authorization
//   validity decision into the one shared module, deleting the per-site verifyAndAuthorize copies.
//
//   FAIL-CLOSED when verifySignature is absent: the function derives NOTHING (empty map). There is NO
//   order-insensitive { verifyAndAuthorize } fallback — that pre-§13.1 path was a silent-downgrade
//   footgun (a miswiring that forgot verifySignature would get order-insensitive authorization, reopening
//   residual ③). The pre-fix order-insensitive derivation is preserved ONLY as __deriveLegacyForTests
//   (below), exported for the regression/exploit probes, never selectable here.
//
// PURE: no I/O. All trust/authorization/time is delegated to opts.
export function deriveKeyWindowConstraints(events, repo, opts) {
  const out = new Map();
  if (!Array.isArray(events)) return out;

  const verifySignature =
    opts && typeof opts.verifySignature === "function" ? opts.verifySignature : null;

  // FAIL-CLOSED — footgun eliminated (§13.1). The ONLY supported opts shape is the order-aware
  // { verifySignature, getMaintainer, timeOf, trustedPolicy }. If verifySignature is absent we derive
  // NOTHING (empty map => mergeStricterWindow returns the maintainer untouched => node.json-only). We do
  // NOT fall back to an order-INSENSITIVE { verifyAndAuthorize } pass: a production miswiring that forgot
  // verifySignature must degrade to "no derived constraint" (no false authority), never to the pre-§13.1
  // behavior that reopens residual ③ (a stripped node.json re-authorizing a compromise-revoked signer).
  // The pre-fix order-insensitive derivation lives ONLY in __deriveLegacyForTests below — callable by the
  // regression/exploit probes, never selectable here.
  if (!verifySignature) return out;

  // --- order-aware single forward pass (§13.1). Consolidated §4 authorization. -------------------
  const getMaintainer =
    opts && typeof opts.getMaintainer === "function" ? opts.getMaintainer : () => null;
  const timeOf =
    opts && typeof opts.timeOf === "function" ? opts.timeOf : () => ({ time: null, provable: false, source: "none" });
  const trustedPolicy =
    opts && opts.trustedPolicy && typeof opts.trustedPolicy.has === "function"
      ? opts.trustedPolicy
      : new Set();

  // Single FORWARD PASS in ledger (array) order. `out` IS the derivedSoFar map: when we authorize
  // event E we consult `out` for the SIGNER's window — i.e. the merged state from STRICTLY-EARLIER
  // events only, because E's own constraint is not applied until AFTER it is authorized. No
  // recursion, no fixpoint: every event's authorization depends only on events before it.
  for (const ev of events) {
    if (!isKeyEvent(ev) || !repoMatches(ev, repo)) continue;

    // (a) the signature must verify.
    const vs = verifySignature(ev) || {};
    if (vs.ok !== true) continue;
    const signerKeyId = vs.signerKeyId ?? null;
    const signerNodeRepo = vs.signerNodeRepo ?? null;
    if (typeof signerKeyId !== "string" || signerKeyId === "") continue;

    // (b) AUTHORIZATION (§4): a same-node key OR a trustedPolicy node.
    //   - REVOCATION (§4.2): a SURVIVING same-node key — `signerKeyId != revokedKeyId`. A revocation
    //     self-signed by the revoked key is NOT authorized here (only via trustedPolicy).
    //   - ROTATION (§4.1): the RETIRING KEY ITSELF proves possession and is authorized, so a same-node
    //     signer is allowed even when `signerKeyId === retiringKeyId`. (It is the LATER signer-validity
    //     check (c) — against derivedSoFar — that blocks a retiring key that is ALREADY revoked, which
    //     is exactly residual ③; clause (b) must not pre-empt that or the §13.3 "rotation BEFORE the
    //     revocation still stands" case becomes impossible.)
    const affectedKeyId = affectedKeyIdOf(ev);
    const selfOnAffected = signerKeyId === affectedKeyId;
    const sameNodeRepo = signerNodeRepo !== null && signerNodeRepo === ev.repo;
    const sameNodeAuthorized =
      sameNodeRepo && (ev.type === "KeyRotation" ? true : !selfOnAffected);
    const governance = signerNodeRepo !== null && trustedPolicy.has(signerNodeRepo);
    if (!sameNodeAuthorized && !governance) continue;

    // (c) SIGNER VALIDITY (the ③ fix): the signer must be VALID at timeOf(ev) per the SAME
    //     derive-stricter predicate, evaluated against node.json merged with derivedSoFar (out) —
    //     i.e. the window state from STRICTLY-EARLIER events. A signer whose own compromise-revocation
    //     appears earlier in the ledger is invalid here and cannot authorize this event.
    const signerMaintainer = getMaintainer(signerKeyId, signerNodeRepo);
    const signerEff = mergeStricterWindow(signerMaintainer, out.get(signerKeyId));
    const dec = isKeyValidForSignature(signerEff, timeOf(ev));
    if (!dec.valid) continue;

    // Authorized + valid => apply E's constraint into derivedSoFar (rotate/revoke shapes as before).
    applyEventConstraint(out, ev);
  }
  return out;
}

// __deriveLegacyForTests(events, repo, opts) -> Map<keyId, constraint>  — TEST-ONLY. NOT PRODUCTION.
//
// The pre-§13.1 ORDER-INSENSITIVE derivation: an event contributes iff opts.verifyAndAuthorize(ev) ===
// true, with NO strictly-earlier-events signer-validity check. This is the documented "pre-fix broken
// behavior" baseline — the residual-③ footgun (a stripped node.json could re-authorize a compromise-
// revoked signer's later rotation). It is exported under this deliberately-ugly name ONLY so the
// regression + end-to-end exploit probes can demonstrate the pre-fix behavior and prove the order-aware
// fix in deriveKeyWindowConstraints is load-bearing. The `__`/`ForTests` name makes any production use
// glaring in review. PRODUCTION MUST call deriveKeyWindowConstraints with the order-aware opts; wiring
// { verifyAndAuthorize } into a verifier would reopen ③ — which is exactly why it is no longer a
// selectable branch of deriveKeyWindowConstraints.
export function __deriveLegacyForTests(events, repo, opts) {
  const out = new Map();
  if (!Array.isArray(events)) return out;
  const verifyAndAuthorize =
    opts && typeof opts.verifyAndAuthorize === "function" ? opts.verifyAndAuthorize : null;
  for (const ev of events) {
    if (!isKeyEvent(ev) || !repoMatches(ev, repo)) continue;
    // No gate / unauthorized => NOTHING (fail-closed: no authority => no derived constraint).
    if (!verifyAndAuthorize || verifyAndAuthorize(ev) !== true) continue;
    applyEventConstraint(out, ev);
  }
  return out;
}

// mergeStricterWindow(maintainer, constraint) -> maintainer-like with the MOST RESTRICTIVE
// window of node.json + constraint.
//   validFrom = max, validUntil = min, revokedAt = min, invalidAfter = min, and
//   revocationReason 'compromise' DOMINATES 'rotation'/'retirement'.
//
// GRANDFATHER-SAFE (load-bearing, byte-identical to today): mergeStricterWindow(m, undefined)
// and mergeStricterWindow(m, null) return `m` UNCHANGED (===), so a window-less maintainer with
// no derived constraint behaves exactly as before this hardening. A tampered node.json can only
// ADD restriction (constraints are the signed-event floor); it can never remove what the events
// assert, because every axis takes the stricter side.
//
// The result is a shallow clone of the maintainer with window fields overwritten by the merged
// values. Date axes are serialized back to ISO strings so the returned object is a plain
// maintainer-like that keyWindow()/isKeyValidForSignature() consume unchanged. Axes that are
// null on BOTH sides are written as undefined and stripped (they never existed) — except we
// never RESURRECT a grandfather: if the merged window has any field, the result is windowed.
export function mergeStricterWindow(maintainer, constraint) {
  // Grandfather-safe identity: no constraint => the maintainer is returned untouched.
  if (constraint === undefined || constraint === null) return maintainer;
  const m = maintainer || {};
  const w = keyWindow(m);

  // Normalize the constraint's axes to Date|null (it may arrive with strings or Dates).
  const c = {
    validFrom: constraint.validFrom instanceof Date ? constraint.validFrom : toDateOrNull(constraint.validFrom),
    validUntil: constraint.validUntil instanceof Date ? constraint.validUntil : toDateOrNull(constraint.validUntil),
    revokedAt: constraint.revokedAt instanceof Date ? constraint.revokedAt : toDateOrNull(constraint.revokedAt),
    invalidAfter: constraint.invalidAfter instanceof Date ? constraint.invalidAfter : toDateOrNull(constraint.invalidAfter),
    // VER-A-002: canonicalize the constraint's reason too (unknown => 'compromise'), so the merged
    // window stores a canonical value and a mis-cased reason cannot dodge the compromise dominance.
    revocationReason: canonicalReason(constraint.revocationReason),
  };

  const merged = {
    validFrom: maxDate(w.validFrom, c.validFrom),
    validUntil: minDate(w.validUntil, c.validUntil),
    revokedAt: minDate(w.revokedAt, c.revokedAt),
    invalidAfter: minDate(w.invalidAfter, c.invalidAfter),
    revocationReason: stricterReason(w.revocationReason, c.revocationReason),
  };

  const out = { ...m };
  const setOrDrop = (field, dateVal) => {
    if (dateVal instanceof Date) out[field] = dateVal.toISOString();
    else delete out[field];
  };
  setOrDrop("validFrom", merged.validFrom);
  setOrDrop("validUntil", merged.validUntil);
  setOrDrop("revokedAt", merged.revokedAt);
  setOrDrop("invalidAfter", merged.invalidAfter);
  if (merged.revocationReason) out.revocationReason = merged.revocationReason;
  else delete out.revocationReason;
  return out;
}
