// Fetch helpers with retries and timeouts for remote verification.

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10_000;

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
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

/**
 * Fetch and parse JSON from a URL with retries.
 */
export async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}
