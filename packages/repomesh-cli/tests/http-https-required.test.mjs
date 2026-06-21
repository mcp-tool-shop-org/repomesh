import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }

// Local loopback server — http://127.0.0.1 must remain allowed (dev + existing fixtures).
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    } else {
      res.writeHead(404); res.end("nope");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => { await new Promise((r) => server.close(r)); });

describe("CLI-A-003: https scheme required for remote trust-data fetches", () => {
  it("REJECTS a non-loopback http:// URL with an actionable error", async () => {
    const { fetchText } = await import(toURL(resolve(srcDir, "http.mjs")));
    await assert.rejects(
      // Must reject BEFORE any network attempt — host is bogus on purpose.
      () => fetchText("http://example.com/ledger.jsonl"),
      (err) => {
        assert.match(
          err.message,
          /plaintext|https/i,
          `expected a plaintext/https rejection, got: ${err.message}`,
        );
        // Actionable: should tell the user to use https.
        assert.match(err.message, /https:\/\//i, `expected https:// guidance, got: ${err.message}`);
        return true;
      },
    );
  });

  it("ALLOWS an https:// URL (passes the scheme guard, fails later on network — not on scheme)", async () => {
    const { fetchText } = await import(toURL(resolve(srcDir, "http.mjs")));
    // Unresolvable host so we never hit the real network; the point is the scheme
    // guard must NOT be what rejects it.
    await assert.rejects(
      () => fetchText("https://nonexistent.invalid.example/ledger.jsonl"),
      (err) => {
        assert.doesNotMatch(
          err.message,
          /plaintext/i,
          `https URL must not be rejected by the scheme guard, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("ALLOWS loopback http://127.0.0.1 (local dev + existing fixtures)", async () => {
    const { fetchJson } = await import(toURL(resolve(srcDir, "http.mjs")));
    const j = await fetchJson(`${base}/ok`);
    assert.deepEqual(j, { ok: true });
  });

  it("ALLOWS loopback http://localhost", async () => {
    const { fetchJson } = await import(toURL(resolve(srcDir, "http.mjs")));
    const { port } = server.address();
    const j = await fetchJson(`http://localhost:${port}/ok`);
    assert.deepEqual(j, { ok: true });
  });
});
