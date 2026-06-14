import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }

// A tiny local server we can drive into specific responses by path.
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/huge") {
      res.writeHead(200, { "content-type": "application/json" });
      // Stream way more than the cap.
      const chunk = "x".repeat(64 * 1024);
      let sent = 0;
      const target = 50 * 1024 * 1024; // 50 MB
      const pump = () => {
        while (sent < target) {
          if (!res.write(chunk)) { sent += chunk.length; res.once("drain", pump); return; }
          sent += chunk.length;
        }
        res.end();
      };
      pump();
    } else if (req.url === "/redirect") {
      res.writeHead(302, { location: base + "/evil" });
      res.end();
    } else if (req.url === "/evil") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"evil":true}');
    } else if (req.url === "/ok") {
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

describe("CLI-005: size cap on fetchText", () => {
  it("rejects responses exceeding the byte cap", async () => {
    const { fetchText } = await import(toURL(resolve(srcDir, "http.mjs")));
    await assert.rejects(
      () => fetchText(`${base}/huge`, { maxBytes: 1024 * 1024 }),
      (err) => {
        assert.match(err.message, /too large|exceeds|cap|size/i, `expected size error, got: ${err.message}`);
        return true;
      }
    );
  });

  it("accepts a normal small response", async () => {
    const { fetchJson } = await import(toURL(resolve(srcDir, "http.mjs")));
    const j = await fetchJson(`${base}/ok`);
    assert.deepEqual(j, { ok: true });
  });
});

describe("CLI-006: redirect:manual for trust-critical fetches", () => {
  it("does NOT silently follow a redirect when manualRedirect is set", async () => {
    const { fetchText } = await import(toURL(resolve(srcDir, "http.mjs")));
    await assert.rejects(
      () => fetchText(`${base}/redirect`, { manualRedirect: true }),
      (err) => {
        // Must reject on the redirect itself (and therefore never RETURN the /evil body).
        assert.match(err.message, /refus.*follow.*redirect/i, `expected redirect rejection, got: ${err.message}`);
        // It may name the destination for diagnostics, but it must NOT have returned content.
        assert.ok(!("evilReturned" in err), "must not have fetched redirect target body");
        return true;
      }
    );
  });
});
