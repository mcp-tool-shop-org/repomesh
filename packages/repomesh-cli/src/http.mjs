// Fetch helpers with retries and timeouts for remote verification.

const MAX_RETRIES = 3;

// STGB-CLI-006: validate numeric env overrides. The old `parseInt(...) || default` swallowed
// invalid values silently — but a NEGATIVE/ZERO value is truthy and slips through: a `-5` timeout
// makes AbortController fire immediately and abort EVERY fetch; a `0`/negative max-bytes rejects
// every response. A non-numeric value (`abc`) parses to NaN and quietly reverts to the default,
// hiding an operator typo. Fail loud at startup with a message that names the var and the rule.
function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  // Accept only a clean positive integer (no `-5`, no `12abc`, no `1e3`, no whitespace junk).
  if (!/^\d+$/.test(trimmed)) {
    const err = new Error(`Invalid ${name}="${raw}" — must be a positive integer (got a non-numeric or negative value).`);
    err.hint = `Set ${name} to a positive whole number (e.g. ${name}=${fallback}), or unset it to use the default.`;
    throw err;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`Invalid ${name}="${raw}" — must be greater than 0.`);
    err.hint = `Set ${name} to a positive whole number (e.g. ${name}=${fallback}), or unset it to use the default.`;
    throw err;
  }
  return n;
}

const TIMEOUT_MS = positiveIntEnv("REPOMESH_FETCH_TIMEOUT", 10_000);
// CLI-005: hard ceiling on any single fetched body (defends against DoS-on-self
// when a compromised/over-large remote streams an unbounded response). Override
// via REPOMESH_FETCH_MAX_BYTES; defaults to 10 MiB which dwarfs any real ledger/manifest.
const DEFAULT_MAX_BYTES = positiveIntEnv("REPOMESH_FETCH_MAX_BYTES", 10 * 1024 * 1024);
const isDebug = () => process.argv.includes('--debug');
// STGB-CLI-005: the "Retrying..." chatter is informational — it must stay silent for a JSON
// consumer (it would corrupt a single-blob stdout if it leaked there, and it pollutes stderr a
// scripted consumer parses) and under --quiet. Mirrors log.mjs's quiet/json discipline.
const isQuiet = () => process.argv.includes('--quiet') || process.argv.includes('-q');
const isJsonMode = () => process.argv.includes('--json');

// CLI-005: content-types we will accept for trust data. Anything else is suspicious.
const ALLOWED_CONTENT_TYPE = /^(application\/json|application\/.*\+json|text\/plain|application\/octet-stream|application\/jsonl|application\/x-ndjson|text\/)/i;

// CLI-A-003: trust data (node.json, ledger, registry) must travel over TLS. A
// plaintext http:// fetch is exposed to a network MITM that could strip a
// revocation or swap a key. We require https: with a NARROW exception for
// loopback so local dev + the http://127.0.0.1 test fixtures keep working.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(h)) return true;
  // 127.0.0.0/8 is all loopback.
  if (/^127(?:\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

/**
 * CLI-A-003: reject plaintext http:// for non-loopback hosts. Runs once, before
 * the retry loop — a bad scheme is deterministic, so retrying is pointless.
 * Throws a structured error (what was wrong + how to fix) on rejection.
 */
function assertScheme(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // STGB-CLI-007: a malformed/unparseable URL is a DETERMINISTIC failure — retrying it 3x
    // cannot change the outcome, it just wastes ~1.5s and buries the real problem under network
    // chatter. Throw a clear, non-retryable error now (the retry loop fails fast on it).
    const err = new Error(
      `Malformed URL "${url}" — could not be parsed. Provide an absolute https:// URL ` +
      `(e.g. https://host/path), or use --local for offline verification.`,
    );
    err.nonRetryable = true;
    throw err;
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) return;
  if (parsed.protocol === "http:") {
    throw new Error(
      `Refusing to fetch trust data over plaintext ${url} — use https:// instead ` +
      `(loopback http:// is allowed for local testing). Plaintext exposes the ledger, ` +
      `node manifest, and registry to a network attacker who could strip a revocation or swap a key.`,
    );
  }
  // Any other scheme (file:, ftp:, data:, …) is not a remote trust fetch we support.
  throw new Error(
    `Unsupported URL scheme "${parsed.protocol}" for ${url} — use https:// for remote trust data ` +
    `(loopback http:// is allowed for local testing).`,
  );
}

/**
 * Read a fetch Response body with a hard byte cap, aborting the stream if exceeded.
 * Returns the decoded text. Throws a structured error if the cap is hit.
 */
async function readCapped(res, url, maxBytes) {
  // content-length short-circuit (cheap rejection before reading the body).
  const declared = parseInt(res.headers.get("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response from ${url} too large: content-length ${declared} exceeds cap of ${maxBytes} bytes`);
  }
  if (!res.body) return await res.text();

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* best-effort */ }
        throw new Error(`Response from ${url} too large: exceeds size cap of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf8");
}

/**
 * Fetch text content from a URL with retries.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.maxBytes]        Hard cap on the body size (CLI-005).
 * @param {boolean} [opts.manualRedirect] When true, a 3xx redirect is REJECTED
 *                                         rather than silently followed (CLI-006).
 *                                         Trust-critical fetches set this so that a
 *                                         pinned URL cannot be bounced to attacker content.
 * @param {boolean} [opts.checkContentType] Reject non-text/JSON content-types (CLI-005).
 */
export async function fetchText(url, opts = {}) {
  const maxBytes = Number.isFinite(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const manualRedirect = opts.manualRedirect === true;
  const checkContentType = opts.checkContentType !== false; // on by default
  // CLI-A-003: enforce https (or loopback http) BEFORE any network attempt or retry.
  assertScheme(url);
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let nonRetryable = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        // CLI-006: 'manual' surfaces the redirect to us instead of transparently following it.
        redirect: manualRedirect ? "manual" : "follow",
      });
      clearTimeout(timer);

      // CLI-006: a trust-critical fetch must not be silently bounced elsewhere.
      if (manualRedirect && (res.status >= 300 && res.status < 400 || res.type === "opaqueredirect")) {
        const loc = res.headers.get("location") || "(unknown)";
        nonRetryable = true;
        throw new Error(`Refusing to follow redirect from ${url} -> ${loc} (trust-critical fetch; pin the final URL or use --local)`);
      }

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(`Not found: ${url}. Check the URL or run: npx repomesh doctor --repo <org/repo>`);
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      // CLI-005: reject content-types that are not text/JSON for trust data.
      if (checkContentType) {
        const ct = (res.headers.get("content-type") || "").trim();
        if (ct && !ALLOWED_CONTENT_TYPE.test(ct)) {
          nonRetryable = true;
          throw new Error(`Unexpected content-type "${ct}" from ${url}; refusing to treat as trust data`);
        }
      }

      return await readCapped(res, url, maxBytes);
    } catch (err) {
      if (err.name === 'AbortError') {
        lastError = new Error(`Timeout after ${TIMEOUT_MS / 1000}s fetching ${url}. Try --local for offline verification or set REPOMESH_FETCH_TIMEOUT`);
      } else if (err.message?.includes('ENOTFOUND')) {
        lastError = new Error(`Cannot resolve host for ${url}. Check your network connection or use --local for offline verification`);
      } else {
        lastError = err;
      }
      // Redirect refusals, content-type rejections, size-cap hits, and malformed URLs (STGB-CLI-007)
      // are deterministic — retrying cannot change the outcome, so fail fast.
      if (nonRetryable || err?.nonRetryable ||
          /too large|exceeds size cap|content-length|Refusing to follow redirect|Unexpected content-type|Malformed URL/.test(lastError.message || "")) {
        throw lastError;
      }
      if (attempt < MAX_RETRIES) {
        // STGB-CLI-005: keep the retry chatter out of --quiet and --json output (--debug still
        // shows the per-attempt cause). A JSON consumer must get a clean single blob; --quiet
        // means quiet.
        if (!isQuiet() && !isJsonMode()) console.error(`Retrying... (attempt ${attempt + 1}/${MAX_RETRIES})`);
        if (isDebug()) console.error(`[http] ${url}: ${lastError.message}`);
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }
  const msg = lastError.message?.includes('fetch') || lastError.message?.includes('ENOTFOUND')
    ? `Network unavailable. Use --local with a local ledger clone for offline verification. (${lastError.message})`
    : `Failed to fetch ${url} after ${MAX_RETRIES} attempts: ${lastError.message}`;
  throw new Error(msg);
}

/**
 * Fetch and parse JSON from a URL with retries.
 * Trust-critical callers should pass { manualRedirect: true }.
 */
export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON from ${url}: ${e.message}`);
  }
}
