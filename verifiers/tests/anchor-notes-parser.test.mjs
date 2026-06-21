// SEAM-PARSE-001 — the unified anchor-note parser is behavior-preserving and brace-in-prose robust.
//
// Asserts THREE things:
//  1. Behavior-equivalence: for every REAL anchor event in the committed ledger, the canonical
//     parseAnchorPartitionMeta(notes) returns the SAME structured result as ALL FOUR legacy parsers
//     it replaces (the divergent rules previously embedded in validate-ledger / build-trust /
//     build-anchors / tools+cli verify-release). This is the "every existing anchor parses to the
//     same result as before" guarantee.
//  2. Brace-in-prose divergence: on a synthetic anchor whose human prose line contains a `{`, the
//     legacy `indexOf("{")` and greedy/non-greedy tail regexes DISAGREE with each other, while the
//     canonical parser returns the correct trailing metadata object. This is the seam the fix closes.
//  3. Fail-closed: unparseable / non-string / no-trailing-JSON notes return null.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseAnchorPartitionMeta } from "../lib/anchor-notes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const LEDGER = resolve(REPO_ROOT, "ledger", "events", "events.jsonl");

// --- The FOUR legacy parsers, reproduced verbatim from their pre-fix call sites. -----------------
// validate-ledger.mjs: brace = notes.indexOf("{"); JSON.parse(notes.slice(brace)).
function legacyValidateLedger(notes) {
  try {
    const brace = typeof notes === "string" ? notes.indexOf("{") : -1;
    if (brace === -1) return null;
    return JSON.parse(notes.slice(brace));
  } catch { return null; }
}
// build-trust.mjs parseAnchorMeta: greedy /\n(\{.*\})\s*$/s.
function legacyBuildTrust(notes) {
  const m = (notes || "").match(/\n(\{.*\})\s*$/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
// build-anchors.mjs: non-greedy /\n(\{.*?\})$/s.
function legacyBuildAnchors(notes) {
  const m = (notes || "").match(/\n(\{.*?\})$/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
// tools/verify-release.mjs findAnchorForHash: greedy /\n(\{.*\})$/s.
function legacyToolsVerify(notes) {
  const m = (notes || "").match(/\n(\{.*\})$/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function loadAnchorNotes() {
  const lines = readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const events = lines.map((l) => JSON.parse(l));
  return events
    .filter((ev) => ev.type === "AttestationPublished"
      && (ev.attestations || []).some((a) => a.type === "ledger.anchor"))
    .map((ev) => ev.notes);
}

describe("SEAM-PARSE-001 unified anchor-note parser", () => {
  it("parses the same result as ALL legacy parsers for every real anchor (behavior-preserving)", () => {
    const allNotes = loadAnchorNotes();
    assert.ok(allNotes.length > 0, "expected at least one anchor event in the committed ledger");
    for (const notes of allNotes) {
      const canonical = JSON.stringify(parseAnchorPartitionMeta(notes));
      const legacy = [
        legacyValidateLedger(notes),
        legacyBuildTrust(notes),
        legacyBuildAnchors(notes),
        legacyToolsVerify(notes),
      ].map((x) => JSON.stringify(x));
      for (const got of legacy) {
        assert.equal(canonical, got,
          `canonical parser diverged from a legacy parser on a real anchor:\n  canonical=${canonical}\n  legacy=${got}`);
      }
      // And the parsed object must carry the load-bearing fields every consumer reads.
      const meta = parseAnchorPartitionMeta(notes);
      assert.ok(meta && typeof meta === "object", "real anchor must parse to an object");
      assert.ok(Array.isArray(meta.range) && meta.range.length === 2, "meta.range must be a 2-element array");
      assert.equal(typeof meta.manifestHash, "string", "meta.manifestHash must be a string");
      assert.equal(typeof meta.manifestPath, "string", "meta.manifestPath must be a string");
    }
  });

  it("brace-in-prose: legacy parsers DIVERGE, the canonical parser is correct", () => {
    // A real-shaped anchor note whose HUMAN PROSE line contains a stray "{" (e.g. quoting JSON in the
    // reason). The canonical metadata is the trailing line.
    const meta = { txHash: "ABC", network: "testnet", manifestPath: "anchor/xrpl/manifests/genesis.json", range: ["aa", "bb"], merkleRoot: "deadbeef" };
    const notes = `ledger.anchor: pass — anchored partition {genesis} to XRPL testnet\n${JSON.stringify(meta)}`;

    const canonical = parseAnchorPartitionMeta(notes);
    assert.deepEqual(canonical, meta, "canonical parser must return the trailing metadata object intact");

    // The legacy first-brace parser grabs the brace inside the prose => garbage / null.
    const vl = legacyValidateLedger(notes);
    assert.notDeepEqual(vl, meta, "legacy indexOf('{') would NOT return the correct metadata here");

    // At least two legacy parsers disagree with each other on this input (that IS the seam).
    const results = [
      JSON.stringify(legacyValidateLedger(notes)),
      JSON.stringify(legacyBuildTrust(notes)),
      JSON.stringify(legacyBuildAnchors(notes)),
      JSON.stringify(legacyToolsVerify(notes)),
    ];
    assert.ok(new Set(results).size > 1,
      "the legacy parsers must DIVERGE on a brace-in-prose anchor (otherwise the seam test is vacuous)");
  });

  it("fail-closed on non-parseable / non-string / no-trailing-JSON notes", () => {
    assert.equal(parseAnchorPartitionMeta(undefined), null);
    assert.equal(parseAnchorPartitionMeta(null), null);
    assert.equal(parseAnchorPartitionMeta(42), null);
    assert.equal(parseAnchorPartitionMeta(""), null);
    assert.equal(parseAnchorPartitionMeta("just prose, no json"), null);
    assert.equal(parseAnchorPartitionMeta("prose\n{not valid json}"), null);
    assert.equal(parseAnchorPartitionMeta("prose\n[1,2,3]"), null, "a trailing JSON ARRAY is not metadata");
    assert.equal(parseAnchorPartitionMeta("prose\n{\"ok\":true} trailing"), null,
      "a trailing-line that is not WHOLLY a JSON object is rejected");
  });

  it("a single-line notes that is itself the JSON object parses (no leading newline)", () => {
    const meta = { range: ["a", "b"], manifestPath: "p" };
    assert.deepEqual(parseAnchorPartitionMeta(JSON.stringify(meta)), meta);
  });
});
