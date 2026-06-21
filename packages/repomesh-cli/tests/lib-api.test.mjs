// FT-C-002 — the stable PROGRAMMATIC API surface.
//
// The published package exposes its verification engine as a library (not only a CLI) via
// `import { verifyRelease } from "@mcptoolshop/repomesh"`. This test imports the library entry
// (src/index.mjs — the file the build copies verbatim to dist/index.mjs, the published `exports`
// target) and asserts the curated public surface is present + the pure functions are callable.
//
// It is RED before src/index.mjs exists (and before package.json declares `exports`), GREEN after.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve the entry the way the published `exports` map points (src/index.mjs locally; the build
// copies it to dist/index.mjs in the tarball). Import via a file URL for Windows-safe resolution.
const ENTRY = pathToFileURL(join(__dirname, "..", "src", "index.mjs")).href;

describe("FT-C-002 stable library API", () => {
  it("exposes the curated public surface as callable functions", async () => {
    const lib = await import(ENTRY);
    const required = [
      "verifyRelease",
      "computeVerifyResult",
      "verifyAll",
      "buildSarif",
      "exitCodeForStatus",
      "isKeyValidForSignature",
      "keyWindow",
      "verifyAnchorTx",
    ];
    for (const name of required) {
      assert.equal(typeof lib[name], "function", `expected ${name} to be an exported function`);
    }
  });

  it("exitCodeForStatus maps the tri-state to the exit-code contract", async () => {
    const { exitCodeForStatus } = await import(ENTRY);
    // The engine's statuses are canonical UPPERCASE ("PASS"/"FAIL"/"UNVERIFIED"/"ERROR"); any
    // unrecognized value (incl. lowercase "pass") falls through to ERROR(2) by design.
    assert.equal(exitCodeForStatus("PASS"), 0);
    assert.equal(exitCodeForStatus("FAIL"), 1);
    assert.equal(exitCodeForStatus("ERROR"), 2);
    assert.equal(exitCodeForStatus("UNVERIFIED"), 3);
    // --fail-on=fail relaxes UNVERIFIED to success (0); PASS/FAIL are unaffected.
    assert.equal(exitCodeForStatus("UNVERIFIED", "fail"), 0);
    assert.equal(exitCodeForStatus("FAIL", "fail"), 1);
  });

  it("buildSarif returns a valid SARIF 2.1.0 skeleton for an empty input", async () => {
    const { buildSarif } = await import(ENTRY);
    const sarif = buildSarif([]);
    assert.equal(sarif.version, "2.1.0");
    assert.ok(typeof sarif.$schema === "string" && sarif.$schema.includes("sarif"));
    assert.ok(Array.isArray(sarif.runs) && sarif.runs.length === 1);
    const run = sarif.runs[0];
    assert.equal(run.tool.driver.name, "repomesh");
    assert.ok(Array.isArray(run.results) && run.results.length === 0);
  });

  it("isKeyValidForSignature grandfathers a window-less maintainer", async () => {
    const { isKeyValidForSignature } = await import(ENTRY);
    const dec = isKeyValidForSignature({ keyId: "k1" }, { time: null, provable: false, source: "none" });
    assert.equal(dec.valid, true);
    assert.equal(dec.reason, null);
  });

  it("keyWindow reports a grandfathered (window-less) maintainer as not windowed", async () => {
    const { keyWindow } = await import(ENTRY);
    const w = keyWindow({ keyId: "k1" });
    assert.equal(w.isWindowed, false);
  });
});
