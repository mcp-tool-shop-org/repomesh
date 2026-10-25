// Canonical raw GitHub URLs for remote verification (no clone required).
// Override via env vars: REPOMESH_LEDGER_URL, REPOMESH_MANIFESTS_URL
import fs from "node:fs";
import path from "node:path";
import { fetchText } from "./http.mjs";
import { debug as debugLog } from "./log.mjs";
import { parseStrictJson } from "./verify/safe-json.mjs";

const BASE = "https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main";

export const DEFAULT_LEDGER_URL = process.env.REPOMESH_LEDGER_URL || `${BASE}/ledger/events/events.jsonl`;
export const DEFAULT_NODES_URL = `${BASE}/ledger/nodes`;
export const DEFAULT_MANIFESTS_URL = process.env.REPOMESH_MANIFESTS_URL || `${BASE}/anchor/xrpl/manifests`;
export const DEFAULT_ANCHORS_URL = `${BASE}/registry/anchors.json`;
export const DEFAULT_TRUST_URL = `${BASE}/registry/trust.json`;
export const DEFAULT_ANCHOR_CONFIG_URL = `${BASE}/anchor/xrpl/config.json`;
export const DEFAULT_POLICY_URL = process.env.REPOMESH_POLICY_URL || `${BASE}/verifier.policy.json`;

// D4: the shipped anchor allowlist is the ceiling. The array lives in
// trusted-anchor-accounts.mjs. A fetched config may drop an account. It may not add one.
export {
  BUNDLED_TRUSTED_ANCHOR_ACCOUNTS,
  resolveTrustedAnchorAccounts,
} from "./trusted-anchor-accounts.mjs";

// D12: bundled trusted-attestor allowlist (CRITICAL #1). The consumer CLI re-verifies
// arbitrary/remote ledgers WITHOUT running the in-repo validate-ledger.mjs (which loads
// verifier.policy.json), so the allowlist that ledger-ingress + registry-scoring enforce
// MUST be carried in the shipped binary too — exactly like BUNDLED_TRUSTED_ANCHOR_ACCOUNTS.
//
// These are the 5 org nodes permitted to sign third-party events (AttestationPublished /
// PolicyViolation). A node NOT in this set — even with a cryptographically valid signature —
// is NOT a trusted attestor: its attestations are excluded from the gate AND from the set of
// independent witnesses. A fetched verifier.policy.json may NARROW this set, never WIDEN it.
export const BUNDLED_TRUSTED_ATTESTORS = Object.freeze([
  "mcp-tool-shop-org/repomesh",                   // genesis attestor (kind: registry)
  "mcp-tool-shop-org/repomesh-license-verifier",  // kind: attestor
  "mcp-tool-shop-org/repomesh-security-verifier", // kind: attestor
  "mcp-tool-shop-org/repomesh-repro-verifier",    // kind: attestor
  "mcp-tool-shop-org/repomesh-xrpl-anchor",       // kind: attestor (signs anchor events)
]);

// D12: the node kinds that may sign third-party AttestationPublished events — dedicated attestor
// nodes, the network registry, and governance nodes (scoped exclusively to run attestation types:
// run.preregistered, run.outcome, cognate.root.anchored; never releases or release attestations).
// Mirrors validate-ledger.mjs ATTESTOR_KINDS and build-trust.mjs ATTESTOR_KINDS exactly.
export const BUNDLED_ATTESTOR_KINDS = Object.freeze(["attestor", "registry", "governance"]);

// Scoped allowlist for governance run-event attestations (run.preregistered, run.outcome,
// cognate.root.anchored). Kept separate from BUNDLED_TRUSTED_ATTESTORS so the release-verifier
// and XRPL anchor-clock trust ceiling stays narrow (5 nodes), while preserving the D12 rule
// (a fetched policy may narrow this set, never widen it).
export const BUNDLED_TRUSTED_RUN_ATTESTORS = Object.freeze([
  "mcp-tool-shop-org/cognate",
]);

export const BUNDLED_RUN_ATTESTATION_TYPES = Object.freeze([
  "run.preregistered",
  "run.outcome",
  "cognate.root.anchored",
]);

// Bundled per-check trusted sets taken from verifier.policy.json.
// Shipped in the CLI so remote verification enforces the per-check rule even without a local
// checkout. A fetched or local verifier.policy.json may NARROW a check's trusted set
// (intersection only), never widen it.
export const BUNDLED_CHECK_POLICIES = Object.freeze({
  "license.audit": Object.freeze({
    mode: "trusted-set",
    trustedNodes: Object.freeze([
      "mcp-tool-shop-org/repomesh",
      "mcp-tool-shop-org/repomesh-license-verifier",
    ]),
  }),
  "security.scan": Object.freeze({
    mode: "trusted-set",
    trustedNodes: Object.freeze([
      "mcp-tool-shop-org/repomesh",
      "mcp-tool-shop-org/repomesh-security-verifier",
    ]),
  }),
  "repro.build": Object.freeze({
    mode: "open",
    trustedNodes: Object.freeze([]),
  }),
  "sbom.present": Object.freeze({
    mode: "trusted-set",
    trustedNodes: Object.freeze([
      "mcp-tool-shop-org/repomesh",
    ]),
  }),
  "provenance.present": Object.freeze({
    mode: "trusted-set",
    trustedNodes: Object.freeze([
      "mcp-tool-shop-org/repomesh",
    ]),
  }),
  "signature.chain": Object.freeze({
    mode: "trusted-set",
    trustedNodes: Object.freeze([
      "mcp-tool-shop-org/repomesh",
    ]),
  }),
});

const POLICY_REPO_ID_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ALLOWED_POLICY_KEYS = new Set([
  "v",
  "description",
  "trustedAttestors",
  "trustedRunAttestors",
  "trustedPolicy",
  "nodeKinds",
  "scoreableResults",
  "checks",
  "conflictPolicies",
  "profileOverrides",
]);
const ALLOWED_CHECK_KEYS = new Set([
  "mode",
  "quorum",
  "conflictPolicy",
  "trustedNodes",
  "category",
  "weights",
  "attestorGated",
]);

function isRepoIdArray(arr) {
  return Array.isArray(arr) && arr.every((id) => typeof id === "string" && POLICY_REPO_ID_RE.test(id));
}

export function validateVerifierPolicyShape(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { ok: false, reason: "policy root must be a JSON object" };
  }
  if (Object.hasOwn(policy, "__proto__")) {
    return { ok: false, reason: "policy root must not define __proto__" };
  }
  for (const key of Object.keys(policy)) {
    if (!ALLOWED_POLICY_KEYS.has(key)) {
      return { ok: false, reason: `unexpected policy property '${key}'` };
    }
  }
  if (Object.hasOwn(policy, "checks")) {
    const checks = policy.checks;
    if (!checks || typeof checks !== "object" || Array.isArray(checks) || Object.hasOwn(checks, "__proto__")) {
      return { ok: false, reason: "policy.checks must be a plain JSON object" };
    }
    for (const [checkName, entry] of Object.entries(checks)) {
      if (!checkName) {
        return { ok: false, reason: "policy.checks key must be a non-empty string" };
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.hasOwn(entry, "__proto__")) {
        return { ok: false, reason: `policy.checks['${checkName}'] must be a plain JSON object` };
      }
      for (const k of Object.keys(entry)) {
        if (!ALLOWED_CHECK_KEYS.has(k)) {
          return { ok: false, reason: `policy.checks['${checkName}'] has unexpected property '${k}'` };
        }
      }
      if (entry.mode !== "open" && entry.mode !== "trusted-set") {
        return { ok: false, reason: `policy.checks['${checkName}'].mode must be 'open' or 'trusted-set'` };
      }
      if (entry.trustedNodes !== undefined && !isRepoIdArray(entry.trustedNodes)) {
        return { ok: false, reason: `policy.checks['${checkName}'].trustedNodes must be an array of org/repo strings` };
      }
      if (entry.quorum !== undefined && (!Number.isInteger(entry.quorum) || entry.quorum < 1)) {
        return { ok: false, reason: `policy.checks['${checkName}'].quorum must be a positive integer` };
      }
      if (entry.conflictPolicy !== undefined && (typeof entry.conflictPolicy !== "string" || !entry.conflictPolicy)) {
        return { ok: false, reason: `policy.checks['${checkName}'].conflictPolicy must be a non-empty string` };
      }
      if (entry.category !== undefined && entry.category !== "integrity" && entry.category !== "assurance") {
        return { ok: false, reason: `policy.checks['${checkName}'].category must be 'integrity' or 'assurance'` };
      }
      if (
        entry.weights !== undefined &&
        (!entry.weights || typeof entry.weights !== "object" || Array.isArray(entry.weights))
      ) {
        return { ok: false, reason: `policy.checks['${checkName}'].weights must be a plain JSON object` };
      }
      if (entry.attestorGated !== undefined && typeof entry.attestorGated !== "boolean") {
        return { ok: false, reason: `policy.checks['${checkName}'].attestorGated must be a boolean` };
      }
    }
  }
  if (!Object.hasOwn(policy, "trustedAttestors") || !isRepoIdArray(policy.trustedAttestors)) {
    return { ok: false, reason: "policy.trustedAttestors is required and must be an array of org/repo strings" };
  }
  if (policy.trustedRunAttestors !== undefined && !isRepoIdArray(policy.trustedRunAttestors)) {
    return { ok: false, reason: "policy.trustedRunAttestors must be an array of org/repo strings" };
  }
  if (policy.trustedPolicy !== undefined && !isRepoIdArray(policy.trustedPolicy)) {
    return { ok: false, reason: "policy.trustedPolicy must be an array of org/repo strings" };
  }
  if (policy.v !== undefined && (!Number.isInteger(policy.v) || policy.v < 1)) {
    return { ok: false, reason: "policy.v must be a positive integer" };
  }
  if (policy.description !== undefined && typeof policy.description !== "string") {
    return { ok: false, reason: "policy.description must be a string" };
  }
  if (
    policy.nodeKinds !== undefined &&
    (!policy.nodeKinds || typeof policy.nodeKinds !== "object" || Array.isArray(policy.nodeKinds))
  ) {
    return { ok: false, reason: "policy.nodeKinds must be a plain JSON object" };
  }
  if (
    policy.scoreableResults !== undefined &&
    (!Array.isArray(policy.scoreableResults) || !policy.scoreableResults.every((r) => typeof r === "string" && r.length > 0))
  ) {
    return { ok: false, reason: "policy.scoreableResults must be an array of non-empty strings" };
  }
  if (
    policy.conflictPolicies !== undefined &&
    (!policy.conflictPolicies || typeof policy.conflictPolicies !== "object" || Array.isArray(policy.conflictPolicies))
  ) {
    return { ok: false, reason: "policy.conflictPolicies must be a plain JSON object" };
  }
  if (
    policy.profileOverrides !== undefined &&
    (!policy.profileOverrides || typeof policy.profileOverrides !== "object" || Array.isArray(policy.profileOverrides))
  ) {
    return { ok: false, reason: "policy.profileOverrides must be a plain JSON object" };
  }
  return { ok: true, reason: null };
}

export function resolveCheckPolicy(checkType, policy) {
  if (typeof checkType !== "string" || !checkType) {
    return { mode: "trusted-set", trustedNodes: [] };
  }
  const hasBundled = Object.hasOwn(BUNDLED_CHECK_POLICIES, checkType);
  if (!hasBundled) {
    return { mode: "trusted-set", trustedNodes: [] };
  }
  const bundled = BUNDLED_CHECK_POLICIES[checkType];
  const checks = policy?.checks;
  const hasPolicyEntry =
    checks && typeof checks === "object" && Object.hasOwn(checks, checkType);
  const entry = hasPolicyEntry ? checks[checkType] : null;

  if (bundled.mode === "trusted-set") {
    if (entry && entry.mode === "trusted-set" && Array.isArray(entry.trustedNodes)) {
      const allowed = new Set(entry.trustedNodes.filter((id) => typeof id === "string"));
      return {
        mode: "trusted-set",
        trustedNodes: bundled.trustedNodes.filter((id) => allowed.has(id)),
      };
    }
    return {
      mode: "trusted-set",
      trustedNodes: [...bundled.trustedNodes],
    };
  }
  if (entry && entry.mode === "trusted-set" && Array.isArray(entry.trustedNodes)) {
    const allowed = new Set(entry.trustedNodes.filter((id) => typeof id === "string"));
    return {
      mode: "trusted-set",
      trustedNodes: BUNDLED_TRUSTED_ATTESTORS.filter((id) => allowed.has(id)),
    };
  }
  return {
    mode: "open",
    trustedNodes: [],
  };
}

// STGB-CLI-001 (observability): in REMOTE mode the local revocation defenses — the §12.1
// derive-stricter key-window narrowing and the LEDGER-A-005 ledger-immutability check — are
// INERT, because they recompute against a local checkout that remote mode does not have. That
// means a remote verification's revocation integrity rests entirely on TRUSTING the source the
// ledger/nodes were fetched from. Without the on-chain --anchored path (which independently
// commits to ledger order + revocation state via the XRPL Merkle anchor), there is no independent
// witness to that trust. This is a LEGIBILITY gap, not a new defence: full remote derive-stricter
// is out of scope. We surface it loudly so an operator is never silently relying on an unverified
// source for a revocation-sensitive decision.
//
// Returns { warn: boolean, escalated: boolean, lines: string[] } — `lines` is empty when no
// warning applies. `escalated` is true when a URL override is present (a non-default source raises
// the stakes: the operator pointed at something the bundled defaults did not vouch for).
export function deriveRemoteRevocationWarning({ local, anchored, ledgerUrl, nodesUrl, manifestsUrl } = {}) {
  // Local mode runs the real derive-stricter + immutability checks; --anchored adds the on-chain
  // independent witness. Either one closes the gap, so no warning is needed.
  if (local || anchored) return { warn: false, escalated: false, lines: [] };

  const overrides = [
    ledgerUrl ? `--ledger-url ${ledgerUrl}` : null,
    nodesUrl ? `--nodes-url ${nodesUrl}` : null,
    manifestsUrl ? `--manifests-url ${manifestsUrl}` : null,
  ].filter(Boolean);
  const escalated = overrides.length > 0;

  const lines = [
    "WARNING: remote verification — local revocation defenses are INERT.",
    "  The derive-stricter key-window narrowing and ledger-immutability check only run against a",
    "  local checkout. In remote mode, revocation integrity rests on TRUSTING the source you fetched",
    "  from; a deleted/forged KeyRevocation in that source would NOT be caught here.",
  ];
  if (escalated) {
    lines.push(
      `  ESCALATED: you overrode the trust source (${overrides.join(", ")}). A non-default source`,
      "  raises the stakes — that endpoint is fully trusted for revocation state.",
    );
  }
  lines.push("  Hint: add --anchored for an independent on-chain witness, or use --local with a trusted clone.");
  return { warn: true, escalated, lines };
}

export function deriveRemotePolicyUrl(opts) {
  if (opts?.policyUrl) return { url: opts.policyUrl, explicit: true };
  if (process.env.REPOMESH_POLICY_URL) return { url: process.env.REPOMESH_POLICY_URL, explicit: true };
  if (typeof opts?.nodesUrl === "string" && opts.nodesUrl.endsWith("/ledger/nodes")) {
    return { url: `${opts.nodesUrl.slice(0, -"/ledger/nodes".length)}/verifier.policy.json`, explicit: false };
  }
  if (typeof opts?.ledgerUrl === "string" && opts.ledgerUrl.endsWith("/ledger/events/events.jsonl")) {
    return { url: `${opts.ledgerUrl.slice(0, -"/ledger/events/events.jsonl".length)}/verifier.policy.json`, explicit: false };
  }
  const forceOffline = process.env.REPOMESH_FORCE_OFFLINE === "1" || process.env.REPOMESH_OFFLINE === "1";
  if (!opts?.nodesUrl && !opts?.ledgerUrl && !forceOffline) {
    return { url: DEFAULT_POLICY_URL, explicit: false };
  }
  return { url: null, explicit: false };
}

export function readVerifierPolicyStateSync(opts) {
  if (opts && typeof opts === "object" && opts.policyState) return opts.policyState;
  const explicitPath = opts?.policyPath || process.env.REPOMESH_VERIFIER_POLICY_PATH;
  if (!opts?.local || (!opts?.root && !explicitPath)) return { ok: true, policy: null, error: null };
  const p = explicitPath || path.join(opts.root, "verifier.policy.json");
  if (!fs.existsSync(p)) {
    if (explicitPath || opts?.requirePresent) {
      const error = {
        code: "VERIFIER_POLICY_MISSING",
        reason: `verifier.policy.json not found at ${p}`,
        hint: "Restore verifier.policy.json at the checkout root or set REPOMESH_VERIFIER_POLICY_PATH to a valid policy file.",
      };
      const state = { ok: false, policy: null, error };
      opts.policyState = state;
      return state;
    }
    const state = { ok: true, policy: null, error: null };
    opts.policyState = state;
    return state;
  }
  try {
    const policy = parseStrictJson(fs.readFileSync(p, "utf8"));
    const shapeCheck = validateVerifierPolicyShape(policy);
    if (!shapeCheck.ok) throw new Error(shapeCheck.reason);
    const state = { ok: true, policy, error: null };
    opts.policyState = state;
    return state;
  } catch (e) {
    const error = {
      code: "VERIFIER_POLICY_UNREADABLE",
      reason: `verifier.policy.json at ${p} could not be parsed: ${e.message}`,
      hint: "Fix the JSON syntax or schema shape in verifier.policy.json or restore it from a clean checkout.",
    };
    const state = { ok: false, policy: null, error };
    opts.policyState = state;
    return state;
  }
}

export async function preloadVerifierPolicy(opts, fetchOpts = { retries: 1, timeoutMs: 5000 }) {
  if (!opts || typeof opts !== "object") return { ok: true, policy: null, error: null };
  if (opts.policyState) return opts.policyState;
  if (opts.local) return readVerifierPolicyStateSync(opts);
  const { url, explicit } = deriveRemotePolicyUrl(opts);
  if (!url) {
    const state = { ok: true, policy: null, error: null };
    opts.policyState = state;
    return state;
  }
  let raw;
  try {
    raw = await fetchText(url, fetchOpts);
  } catch (e) {
    debugLog(`remote verifier.policy.json fetch skipped (${url}): ${e.message}`);
    if (explicit) {
      const error = {
        code: "VERIFIER_POLICY_UNREADABLE",
        reason: `verifier.policy.json at ${url} could not be fetched: ${e.message}`,
        hint: "Verify the policy URL or restore verifier.policy.json at the remote source.",
      };
      const state = { ok: false, policy: null, error };
      opts.policyState = state;
      return state;
    }
    const state = { ok: true, policy: null, error: null };
    opts.policyState = state;
    return state;
  }
  try {
    const policy = parseStrictJson(raw);
    const shapeCheck = validateVerifierPolicyShape(policy);
    if (!shapeCheck.ok) throw new Error(shapeCheck.reason);
    const state = { ok: true, policy, error: null };
    opts.policyState = state;
    return state;
  } catch (e) {
    const error = {
      code: "VERIFIER_POLICY_UNREADABLE",
      reason: `verifier.policy.json at ${url} could not be parsed: ${e.message}`,
      hint: "Fix the JSON syntax or schema shape in verifier.policy.json or restore it from a clean checkout.",
    };
    const state = { ok: false, policy: null, error };
    opts.policyState = state;
    return state;
  }
}

export function readVerifierPolicy(opts) {
  const state = readVerifierPolicyStateSync(opts);
  return state.ok ? state.policy : null;
}

export function checkPolicyForCli(checkType, policyState) {
  if (typeof checkType !== "string" || !checkType || !Object.hasOwn(BUNDLED_CHECK_POLICIES, checkType)) {
    return { mode: "trusted-set", trustedNodes: [] };
  }
  if (policyState && !policyState.ok) {
    const bundled = BUNDLED_CHECK_POLICIES[checkType];
    if (bundled && bundled.mode === "open") {
      return { mode: "open", trustedNodes: [] };
    }
    return { mode: "trusted-set", trustedNodes: [] };
  }
  return resolveCheckPolicy(checkType, policyState?.policy || null);
}
