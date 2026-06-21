// RepoMesh — verifier-plugin contract resolver (#7).
//
// THE CHECK-KINDS REGISTRY + NODE-KINDS PERMISSION MAP, resolved from verifier.policy.json.
// Before #7, the per-check scoring weights, the attestor-gated set, the scoreable-results set, and
// the node-kind→event-type permission map were HARDCODED across build-trust.mjs + validate-ledger.mjs.
// That meant adding a new check kind (e.g. `sast.scan`) or a new verifier node kind required a CODE
// change at multiple sites. #7 moves all of it into verifier.policy.json (v2) so the network is
// extended by DATA, not code — while staying byte-identical for the existing checks.
//
// REGISTERED ≠ TRUSTED (the contract's core invariant):
//   - A check kind is REGISTERED iff it appears in policy.checks. Registration alone earns NOTHING.
//   - Credit is granted only when a check's consensus is `pass` AND (for trusted-set checks) the
//     attesting node is in that check's trustedNodes. An attestation of an UNREGISTERED kind, or from
//     an untrusted node, is recorded but scores ZERO (see isRegisteredCheck + the scorer's gating).
//   - node-kind permissions (which node kind may SIGN which event type) are likewise data-driven, but
//     the CLI keeps a bundled floor a remote policy can never widen (verify-release BUNDLED_*).
//
// BACKWARD COMPATIBILITY: every resolver prefers the v2 policy field and FALLS BACK, per-field, to the
// exact pre-#7 hardcoded default when the field is absent (a v1 policy, or a v2 policy that omits a
// field). So a v1 policy — or the shipped v2 policy whose values mirror the old constants — produces
// byte-identical scoring + validation to pre-#7. Pure: no I/O.

// --- v1 fallback defaults (the historical hardcoded values; do NOT change without a migration) -----
export const V1_NODE_KINDS = {
  AttestationPublished: ["attestor", "registry"],
  PolicyViolation: ["policy", "registry"],
};
export const V1_INTEGRITY_CHECK_WEIGHTS = {
  "sbom.present": 20,
  "provenance.present": 20,
  "signature.chain": 15,
};
export const V1_ASSURANCE_WEIGHTS = {
  "license.audit": { pass: 30, warn: 15, fail: 0 },
  "security.scan": { pass: 40, warn: 20, fail: 0 },
  "repro.build": { pass: 30, warn: 15, fail: 0 },
};
export const V1_ATTESTOR_GATED = ["sbom.present", "provenance.present", "signature.chain"];
export const V1_SCOREABLE_RESULTS = ["pass", "warn", "fail"];

// Does the policy carry the v2 per-check classification (category/weights)? If NO check declares a
// category, treat the whole policy as v1 for the weight/gating resolvers (fall back wholesale) so a
// hand-written v1 policy behaves exactly as before.
function hasV2CheckClassification(policy) {
  const checks = policy?.checks;
  if (!checks || typeof checks !== "object") return false;
  return Object.values(checks).some((d) => d && typeof d === "object" && typeof d.category === "string");
}

// nodeKindsForEvent(policy, eventType) -> Set<string>
//   Which node KINDS may sign `eventType`. From policy.nodeKinds (a kind→{canSign:[...]} map); the set
//   is { kind | eventType ∈ kind.canSign }. If policy.nodeKinds is ABSENT, fall back to the v1 map.
//   NOTE: a present-but-non-matching nodeKinds is an INTENTIONAL empty set (no kind may sign), not a
//   fallback — only absence falls back. This is a registry; an unlisted event type is unsignable.
export function nodeKindsForEvent(policy, eventType) {
  const nk = policy?.nodeKinds;
  if (nk && typeof nk === "object") {
    const out = new Set();
    for (const [kind, def] of Object.entries(nk)) {
      const canSign = Array.isArray(def?.canSign) ? def.canSign : [];
      if (canSign.includes(eventType)) out.add(kind);
    }
    return out;
  }
  return new Set(V1_NODE_KINDS[eventType] || []);
}

// integrityCheckWeights(policy) -> { [kind]: passWeight }
//   The CHECK-KIND integrity weights (sbom.present / provenance.present / signature.chain). The
//   release-INTRINSIC integrity weights (signed / hasArtifacts / noPolicyViolations) are NOT check
//   kinds and remain in the scorer. v1 fallback: V1_INTEGRITY_CHECK_WEIGHTS.
export function integrityCheckWeights(policy) {
  if (!hasV2CheckClassification(policy)) return { ...V1_INTEGRITY_CHECK_WEIGHTS };
  const out = {};
  for (const [kind, def] of Object.entries(policy.checks)) {
    if (def?.category === "integrity" && def?.weights && typeof def.weights.pass === "number") {
      out[kind] = def.weights.pass;
    }
  }
  return out;
}

// assuranceWeights(policy) -> { [kind]: { pass, warn, fail } }
//   The assurance check weights. v1 fallback: V1_ASSURANCE_WEIGHTS.
export function assuranceWeights(policy) {
  if (!hasV2CheckClassification(policy)) return clone(V1_ASSURANCE_WEIGHTS);
  const out = {};
  for (const [kind, def] of Object.entries(policy.checks)) {
    if (def?.category === "assurance" && def?.weights && typeof def.weights === "object") {
      out[kind] = {
        pass: numOr(def.weights.pass, 0),
        warn: numOr(def.weights.warn, 0),
        fail: numOr(def.weights.fail, 0),
      };
    }
  }
  return out;
}

// attestorGatedIntegrity(policy) -> Set<string>
//   Integrity check kinds that require a TRUSTED-attestor consensus pass (a release cannot self-grant
//   them). v2: checks with attestorGated:true. v1 fallback: V1_ATTESTOR_GATED.
export function attestorGatedIntegrity(policy) {
  if (!hasV2CheckClassification(policy)) return new Set(V1_ATTESTOR_GATED);
  const out = new Set();
  for (const [kind, def] of Object.entries(policy.checks)) {
    if (def?.category === "integrity" && def?.attestorGated === true) out.add(kind);
  }
  return out;
}

// scoreableResults(policy) -> Set<string>
//   The attestation results that count as a COMPLETED check and may carry weight. v2:
//   policy.scoreableResults. v1 fallback: V1_SCOREABLE_RESULTS.
export function scoreableResults(policy) {
  const sr = policy?.scoreableResults;
  if (Array.isArray(sr) && sr.length > 0) return new Set(sr);
  return new Set(V1_SCOREABLE_RESULTS);
}

// isRegisteredCheck(policy, kind) -> boolean
//   Registered ≠ trusted: a kind is registered iff it appears in policy.checks. Registration is
//   necessary (an unregistered kind earns zero + is flagged) but NOT sufficient (credit still needs a
//   trusted-set consensus pass per the scorer). When the policy has no checks map at all, fall back to
//   the v1 known set so pre-#7 behavior holds.
export function isRegisteredCheck(policy, kind) {
  const checks = policy?.checks;
  if (checks && typeof checks === "object") return Object.prototype.hasOwnProperty.call(checks, kind);
  return (
    Object.prototype.hasOwnProperty.call(V1_INTEGRITY_CHECK_WEIGHTS, kind) ||
    Object.prototype.hasOwnProperty.call(V1_ASSURANCE_WEIGHTS, kind)
  );
}

// registeredCheckKinds(policy) -> string[]  (the full registered namespace, for legibility/tooling)
export function registeredCheckKinds(policy) {
  const checks = policy?.checks;
  if (checks && typeof checks === "object") return Object.keys(checks);
  return [...new Set([...Object.keys(V1_INTEGRITY_CHECK_WEIGHTS), ...Object.keys(V1_ASSURANCE_WEIGHTS)])];
}

function numOr(v, d) { return typeof v === "number" && Number.isFinite(v) ? v : d; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
