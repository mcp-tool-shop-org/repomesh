import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }

describe("CLI-011: path.sep-safe containment guard", () => {
  it("exports isPathInside", async () => {
    const m = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    assert.equal(typeof m.isPathInside, "function");
  });

  it("accepts a child path inside the root", async () => {
    const { isPathInside } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    const root = path.resolve("/tmp/repomesh-root");
    assert.equal(isPathInside(root, path.join(root, "anchor", "x.json")), true);
  });

  it("rejects ../ traversal escaping the root", async () => {
    const { isPathInside } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    const root = path.resolve("/tmp/repomesh-root");
    assert.equal(isPathInside(root, path.resolve(root, "..", "secret.json")), false);
  });

  it("rejects a sibling whose name shares the root prefix (the startsWith bug)", async () => {
    const { isPathInside } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    const root = path.resolve("/tmp/repomesh-root");
    // "/tmp/repomesh-rootEVIL/x" naively startsWith("/tmp/repomesh-root") => true, but is NOT inside.
    const sibling = root + "EVIL" + path.sep + "x.json";
    assert.equal(isPathInside(root, sibling), false);
  });

  it("treats the root itself as inside", async () => {
    const { isPathInside } = await import(toURL(resolve(srcDir, "verify", "safe-json.mjs")));
    const root = path.resolve("/tmp/repomesh-root");
    assert.equal(isPathInside(root, root), true);
  });
});
