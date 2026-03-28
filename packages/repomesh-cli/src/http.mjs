// Fetch helpers with retries and timeouts for remote verification.

const MAX_RETRIES = 3;
const TIMEOUT_MS = parseInt(process.env.REPOMESH_FETCH_TIMEOUT, 10) || 10_000;
const isDebug = () => process.argv.includes('--debug');

/**
 * Fetch text content from a URL with retries.
 */
export async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(`Not found: ${url}. Check the URL or run: npx repomesh doctor --repo <org/repo>`);
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (err) {
      if (err.name === 'AbortError') {
        lastError = new Error(`Timeout after ${TIMEOUT_MS / 1000}s fetching ${url}. Try --local for offline verification or set REPOMESH_FETCH_TIMEOUT`);
      } else if (err.message?.includes('ENOTFOUND')) {
        lastError = new Error(`Cannot resolve host for ${url}. Check your network connection or use --local for offline verification`);
      } else {
        lastError = err;
      }
      if (attempt < MAX_RETRIES) {
        console.error(`Retrying... (attempt ${attempt + 1}/${MAX_RETRIES})`);
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
 */
export async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON from ${url}: ${e.message}`);
  }
}
