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
