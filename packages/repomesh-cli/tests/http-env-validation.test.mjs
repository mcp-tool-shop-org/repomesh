// Stage C — env validation + fail-fast for malformed URLs (STGB-CLI-006, STGB-CLI-007).
//
// STGB-CLI-006: REPOMESH_FETCH_TIMEOUT / REPOMESH_FETCH_MAX_BYTES must reject negative/non-numeric
//   values with a clear error. A `-5` timeout would otherwise make AbortController fire immediately
//   and abort EVERY fetch; a `0`/negative max-bytes would reject every response.
// STGB-CLI-007: a malformed/unparseable URL is a DETERMINISTIC failure — it must fail fast with a
//   clear message, not be retried 3x (which wastes time and muddies the error).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }

// http.mjs reads env at module evaluation time, so each scenario sets env BEFORE a fresh import
// (cache-busted via a query string).
async function importHttpWithEnv(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await import(toURL(resolve(srcDir, "http.mjs")) + `?t=${Date.now()}${Math.random()}`);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("STGB-CLI-006: REPOMESH_FETCH_TIMEOUT validation", () => {
  it("a negative timeout (-5) is rejected at import with a clear error", async () => {
    await assert.rejects(
      () => importHttpWithEnv({ REPOMESH_FETCH_TIMEOUT: "-5" }),
      (e) => {
        assert.match(e.message, /REPOMESH_FETCH_TIMEOUT/, "names the offending env var");
        assert.match(e.message.toLowerCase(), /positive|negative|number|invalid/, "explains the constraint");
        return true;
      },
      "a -5 timeout must not silently abort every fetch",
    );
  });

  it("a non-numeric timeout (abc) is rejected", async () => {
    await assert.rejects(
      () => importHttpWithEnv({ REPOMESH_FETCH_TIMEOUT: "abc" }),
      /REPOMESH_FETCH_TIMEOUT/,
    );
  });

  it("zero timeout is rejected (0 would abort instantly)", async () => {
    await assert.rejects(
      () => importHttpWithEnv({ REPOMESH_FETCH_TIMEOUT: "0" }),
      /REPOMESH_FETCH_TIMEOUT/,
    );
  });

  it("a valid positive timeout imports fine", async () => {
    const mod = await importHttpWithEnv({ REPOMESH_FETCH_TIMEOUT: "5000" });
    assert.equal(typeof mod.fetchText, "function", "module loads with a valid timeout");
  });

  it("unset timeout falls back to the default (no throw)", async () => {
    const mod = await importHttpWithEnv({ REPOMESH_FETCH_TIMEOUT: undefined });
    assert.equal(typeof mod.fetchText, "function");
  });
});

describe("STGB-CLI-006: REPOMESH_FETCH_MAX_BYTES validation", () => {
  it("a negative max-bytes is rejected", async () => {
    await assert.rejects(
      () => importHttpWithEnv({ REPOMESH_FETCH_MAX_BYTES: "-100" }),
      (e) => {
        assert.match(e.message, /REPOMESH_FETCH_MAX_BYTES/);
        return true;
      },
    );
  });

  it("zero max-bytes is rejected (would reject every response)", async () => {
    await assert.rejects(
      () => importHttpWithEnv({ REPOMESH_FETCH_MAX_BYTES: "0" }),
      /REPOMESH_FETCH_MAX_BYTES/,
    );
  });

  it("a non-numeric max-bytes is rejected", async () => {
    await assert.rejects(
      () => importHttpWithEnv({ REPOMESH_FETCH_MAX_BYTES: "lots" }),
      /REPOMESH_FETCH_MAX_BYTES/,
    );
  });

  it("a valid max-bytes imports fine", async () => {
    const mod = await importHttpWithEnv({ REPOMESH_FETCH_MAX_BYTES: "1048576" });
    assert.equal(typeof mod.fetchText, "function");
  });
});

describe("STGB-CLI-007: malformed URL fails fast (no 3x retry)", () => {
  it("an unparseable URL throws immediately with a clear message, no retries", async () => {
    const mod = await importHttpWithEnv({ REPOMESH_FETCH_TIMEOUT: "10000" });
    const origErr = console.error;
    let retryChatter = 0;
    console.error = (m) => { if (typeof m === "string" && /Retrying/.test(m)) retryChatter++; };
    let threw = null;
    try {
      await mod.fetchText("not a valid url at all");
    } catch (e) { threw = e; }
    finally { console.error = origErr; }
    assert.ok(threw, "a malformed URL must throw");
    assert.match(threw.message.toLowerCase(), /url|parse|invalid|malformed/, "message names the URL problem");
    assert.equal(retryChatter, 0, "a deterministic URL-parse failure must NOT be retried");
  });

  it("a relative/no-scheme URL also fails fast (no retry)", async () => {
    const mod = await importHttpWithEnv({ REPOMESH_FETCH_TIMEOUT: "10000" });
    const origErr = console.error;
    let retryChatter = 0;
    console.error = (m) => { if (typeof m === "string" && /Retrying/.test(m)) retryChatter++; };
    let threw = null;
    try {
      await mod.fetchText("/just/a/path");
    } catch (e) { threw = e; }
    finally { console.error = origErr; }
    assert.ok(threw, "a scheme-less URL must throw");
    assert.equal(retryChatter, 0, "no retries on a deterministic parse failure");
  });
});
