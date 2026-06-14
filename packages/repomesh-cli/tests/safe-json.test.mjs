import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }

describe("CLI-010: strict JSON parsing (no duplicate keys, no non-finite)", () => {
  it("exports parseStrictJson", async () => {
    const m = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    assert.equal(typeof m.parseStrictJson, "function");
  });

  it("rejects duplicate object keys", async () => {
    const { parseStrictJson } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    assert.throws(
      () => parseStrictJson('{"keyId":"good","keyId":"evil"}'),
      /duplicate key/i
    );
  });

  it("rejects nested duplicate keys", async () => {
    const { parseStrictJson } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    assert.throws(
      () => parseStrictJson('{"signature":{"keyId":"a","keyId":"b"}}'),
      /duplicate key/i
    );
  });

  it("rejects non-finite numbers (Infinity/NaN are not valid JSON, but huge exponents round to Infinity)", async () => {
    const { parseStrictJson } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    assert.throws(
      () => parseStrictJson('{"count":1e400}'),
      /non-finite|finite/i
    );
  });

  it("accepts well-formed JSON and returns the parsed object", async () => {
    const { parseStrictJson } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    const o = parseStrictJson('{"a":1,"b":{"c":[1,2,3]}}');
    assert.deepEqual(o, { a: 1, b: { c: [1, 2, 3] } });
  });

  it("throws on malformed JSON", async () => {
    const { parseStrictJson } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    assert.throws(() => parseStrictJson("not json"));
  });

  it("displayCanonical renders the canonicalized object, not the raw bytes", async () => {
    const { displayCanonical } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    // raw has keys out of order and noise; canonical display is sorted, stable
    const obj = { z: 1, a: 2 };
    assert.equal(displayCanonical(obj), '{"a":2,"z":1}');
  });
});
