// STGB-TRUST-004 — writeJsonAtomic publishes a generated JSON file atomically (temp + rename), so a
// crash mid-write can't leave a half-written, unparseable artifact in place. Pins:
//   - the written content is byte-identical to the old direct fs.writeFileSync output
//     (JSON.stringify(value, null, 2) + "\n"), so trust.json / anchors.json are unchanged;
//   - a pre-existing destination is REPLACED wholesale (old complete file → new complete file);
//   - no `.tmp` litter is left behind in the destination directory on success;
//   - a serialization failure does not clobber the existing file (it stays the old content) and
//     leaves no temp litter.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "../lib/common.mjs";

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "rm-atomic-")); }
function tmpLitter(dir, base) {
  return fs.readdirSync(dir).filter((f) => f.startsWith(`.${base}.`) && f.endsWith(".tmp"));
}

describe("STGB-TRUST-004 writeJsonAtomic", () => {
  it("writes byte-identical content to the old direct fs.writeFileSync output (value form)", () => {
    const dir = tmpDir();
    const dest = path.join(dir, "trust.json");
    const value = [{ repo: "a/b", integrityScore: 100 }, { repo: "c/d", integrityScore: 45 }];
    writeJsonAtomic(dest, JSON.stringify(value, null, 2) + "\n");
    const direct = JSON.stringify(value, null, 2) + "\n";
    assert.equal(fs.readFileSync(dest, "utf8"), direct);
  });

  it("serializes a raw value with 2-space indent + trailing newline (matches the generators)", () => {
    const dir = tmpDir();
    const dest = path.join(dir, "anchors.json");
    const value = { partitions: [{ partitionId: "genesis" }], releaseAnchors: {} };
    writeJsonAtomic(dest, value);
    assert.equal(fs.readFileSync(dest, "utf8"), JSON.stringify(value, null, 2) + "\n");
  });

  it("replaces a pre-existing file wholesale (no partial/merged content)", () => {
    const dir = tmpDir();
    const dest = path.join(dir, "trust.json");
    fs.writeFileSync(dest, "OLD COMPLETE CONTENT", "utf8");
    writeJsonAtomic(dest, JSON.stringify({ new: true }, null, 2) + "\n");
    assert.equal(fs.readFileSync(dest, "utf8"), JSON.stringify({ new: true }, null, 2) + "\n");
  });

  it("leaves NO .tmp litter in the destination directory on success", () => {
    const dir = tmpDir();
    const dest = path.join(dir, "trust.json");
    writeJsonAtomic(dest, { ok: 1 });
    assert.equal(tmpLitter(dir, "trust.json").length, 0, "no temp file should remain after a successful write");
    // Only the destination file should be present.
    assert.deepEqual(fs.readdirSync(dir), ["trust.json"]);
  });

  it("on a serialization failure: existing file is untouched and no temp litter remains", () => {
    const dir = tmpDir();
    const dest = path.join(dir, "trust.json");
    fs.writeFileSync(dest, "PREEXISTING", "utf8");
    const circular = {};
    circular.self = circular; // JSON.stringify throws on a circular reference
    assert.throws(() => writeJsonAtomic(dest, circular), /circular|Converting/i);
    assert.equal(fs.readFileSync(dest, "utf8"), "PREEXISTING", "the existing file must not be clobbered");
    assert.equal(tmpLitter(dir, "trust.json").length, 0, "a failed write must not leave a temp file");
  });

  it("requires an outPath", () => {
    assert.throws(() => writeJsonAtomic("", { a: 1 }), /outPath is required/);
  });
});
