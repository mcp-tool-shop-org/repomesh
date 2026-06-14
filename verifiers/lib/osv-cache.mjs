// RepoMesh Verifier — OSV result cache (FC11 / STGB-VER-011).
//
// A small, dependency-free, in-process cache keyed on the OSV coordinate (ecosystem, name, version).
// Two jobs:
//   1. IDEMPOTENT  — a coordinate computed once is served from memory on every later get, so a
//      package queried twice (across releases in one verify-all run, or duplicated within a single
//      SBOM) hits the OSV network exactly once.
//   2. PARALLEL-SAFE — concurrent gets for the SAME coordinate share ONE in-flight promise (single-
//      flight dedup), so the bounded-concurrency pool in osv.mjs never fires two requests for the
//      same coordinate even when they overlap in time.
//
// DOCTRINE (load-bearing — do NOT change):
//   - A FAILED compute is NEVER cached. A transient ECONNRESET / 429 / timeout must not poison a
//     later retry, and Stage A per-package failure isolation requires each failure to surface
//     independently (one package's failure -> that package unscored; siblings' criticals survive).
//     We therefore drop the in-flight entry on rejection and let the next get recompute.
//   - The cache stores ONLY successful per-coordinate OSV payloads. It makes no scoring decision and
//     changes no trust verdict; it is purely a network-deduplication layer. Removing the cache must
//     leave every verdict identical (additive guarantee).
//
// FORWARD-COMPAT (FC11 explicit requirement): a future verifier-plugin (#7) constructs its own
// OsvCache (or is handed one) and calls getOrCompute(key, loader). The key derivation is exported
// (osvCacheKey) so any verifier keys on the identical coordinate string. Nothing here is OSV-
// specific except the documented key shape; the store would back any coordinate-keyed lookup.

// Canonical coordinate key for an OSV /v1/query body: ecosystem, name, version joined by a NUL
// (\x00) delimiter. NUL cannot appear in a package coordinate, so the key is collision-free even if
// a name or version contained whitespace (a space delimiter would be ambiguous; NUL is not).
// `version` is the package version being scanned (queries carry it as a sibling of `package`).
// Ecosystem + name are normalized to a trimmed string; a missing field becomes the empty string so
// the key is always well-formed (a malformed query degrades to a stable-but-distinct key rather
// than throwing — the caller's 1:1 alignment guarantee still holds).
export const OSV_CACHE_KEY_DELIM = "\x00";
export function osvCacheKey(query) {
  const eco = String(query?.package?.ecosystem ?? "").trim();
  const name = String(query?.package?.name ?? "").trim();
  const version = String(query?.version ?? "").trim();
  return [eco, name, version].join(OSV_CACHE_KEY_DELIM);
}

export class OsvCache {
  constructor() {
    // key -> { value }  (resolved successes only)
    this._done = new Map();
    // key -> Promise     (in-flight single-flight dedup; cleared on settle)
    this._inflight = new Map();
  }

  // Has a SUCCESSFUL value been cached for this key? (in-flight does not count as cached).
  has(key) {
    return this._done.has(key);
  }

  // Number of distinct coordinates with a cached success — handy for receipts/telemetry.
  get size() {
    return this._done.size;
  }

  // Return the cached value for `key`, else run `loader()` exactly once and cache its resolved
  // value. Concurrent callers for the same key await the SAME in-flight promise (single-flight).
  // A rejected loader is NOT cached: the in-flight entry is removed and the rejection propagates,
  // so the caller's per-package try/catch can record the failure and a later get may retry.
  async getOrCompute(key, loader) {
    if (this._done.has(key)) {
      return this._done.get(key).value;
    }
    const existing = this._inflight.get(key);
    if (existing) return existing;

    const p = (async () => {
      const value = await loader();
      // Promote to the resolved store only on success.
      this._done.set(key, { value });
      return value;
    })();

    this._inflight.set(key, p);
    try {
      return await p;
    } finally {
      // Always clear the in-flight slot (success already promoted to _done; failure leaves no trace).
      this._inflight.delete(key);
    }
  }
}
