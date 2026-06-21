// Canonical raw GitHub URLs for remote verification (no clone required).
// Override via env vars: REPOMESH_LEDGER_URL, REPOMESH_MANIFESTS_URL
const BASE = "https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main";

export const DEFAULT_LEDGER_URL = process.env.REPOMESH_LEDGER_URL || `${BASE}/ledger/events/events.jsonl`;
export const DEFAULT_NODES_URL = `${BASE}/ledger/nodes`;
export const DEFAULT_MANIFESTS_URL = process.env.REPOMESH_MANIFESTS_URL || `${BASE}/anchor/xrpl/manifests`;
export const DEFAULT_ANCHORS_URL = `${BASE}/registry/anchors.json`;
export const DEFAULT_TRUST_URL = `${BASE}/registry/trust.json`;
export const DEFAULT_ANCHOR_CONFIG_URL = `${BASE}/anchor/xrpl/config.json`;

// D4: bundled fallback for the trusted XRPL anchor account allowlist. config.json is
// user-overridable (via --ws-url and remote fetch), so the Account allowlist MUST be
// pinned in the shipped binary too — a remote config can never WIDEN this set, only
// be cross-checked against it. An anchor signed by any account NOT in this set is
// rejected even if a fetched config claims to trust it.
export const BUNDLED_TRUSTED_ANCHOR_ACCOUNTS = Object.freeze([
  "rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W",
]);

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

// D12: the only node kinds that may sign attestations — dedicated attestor nodes plus the
// network registry (which bootstraps attestations + anchors at genesis). Mirrors
// validate-ledger.mjs ATTESTOR_KINDS and build-trust.mjs ATTESTOR_KINDS exactly.
export const BUNDLED_ATTESTOR_KINDS = Object.freeze(["attestor", "registry"]);

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
