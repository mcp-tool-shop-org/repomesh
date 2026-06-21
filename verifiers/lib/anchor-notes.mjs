// RepoMesh — canonical anchor-note metadata parser (SEAM-PARSE-001).
//
// An anchor event is an AttestationPublished carrying a `ledger.anchor` attestation. Its `notes`
// field is written by anchor/xrpl/scripts/emit-anchor-event.mjs as:
//
//   `ledger.anchor: pass — <human prose, single line>\n<compact JSON metadata object>`
//
// i.e. ONE trailing line that is the WHOLE JSON object (JSON.stringify with no indent => no embedded
// newlines), preceded by a single `\n`. That trailing object carries the partition metadata every
// consumer needs (merkleRoot, manifestHash, manifestPath, txHash, network, range, ...).
//
// Before this module the same blob was parsed FOUR+ different ways that AGREED on every live anchor
// but DIVERGED on a brace-in-prose anchor (a `{` appearing in the human prose line):
//   - ledger/scripts/validate-ledger.mjs : notes.indexOf("{") then JSON.parse(slice)  (FIRST brace)
//   - tools/verify-release.mjs           : notes.match(/\n(\{.*\})$/s)                  (GREEDY tail)
//   - registry/scripts/build-trust.mjs   : notes.match(/\n(\{.*\})\s*$/s)               (GREEDY tail)
//   - registry/scripts/build-anchors.mjs : notes.match(/\n(\{.*?\})$/s)                 (NON-GREEDY)
//   - packages/repomesh-cli copy         : notes.match(/\n(\{.*?\})$/s)                 (NON-GREEDY)
// `indexOf("{")` would grab a brace inside the prose; the greedy tail regex would span from the
// FIRST `\n{` (possibly inside prose) to the last `}`; the non-greedy one would stop at the first `}`.
// On a brace-in-prose anchor these produce three different (and mostly wrong) results.
//
// CANONICAL RULE (this module) — the MOST ROBUST rule, and the one that matches how the emitter
// actually writes the blob: parse the LAST LINE of `notes` as a single JSON object. The metadata is
// the entire last line (no embedded newlines), so taking the substring after the final `\n` is
// immune to any `{` or `}` that appears earlier in the prose. Behavior-preserving for every live
// anchor (verified against the real ledger's anchor events), and fail-closed (null) on anything
// that is not a parseable trailing JSON object — exactly as every prior site did.
//
// IMPORTANT (drift): packages/repomesh-cli/src/verify/anchor-notes.mjs is a BYTE-IDENTICAL copy of
// this file's parse function (the published CLI is self-contained and cannot import across the
// package boundary). A drift test (packages/repomesh-cli/tests/anchor-notes-drift.test.mjs) pins the
// two parse-function bodies together. Edit BOTH copies identically.

// parseAnchorPartitionMeta(notes) -> object | null
// Returns the parsed trailing-JSON metadata object, or null if `notes` is not a string, has no
// trailing JSON-object line, or that line does not parse to a plain (non-array) object. Field-level
// validation (range/manifestPath/txHash/etc.) is the CALLER's concern — this returns the raw object
// so each consumer keeps its own downstream checks unchanged.
export function parseAnchorPartitionMeta(notes) {
  if (typeof notes !== "string") return null;
  const nl = notes.lastIndexOf("\n");
  const lastLine = (nl === -1 ? notes : notes.slice(nl + 1)).trim();
  if (lastLine.length === 0 || lastLine[0] !== "{" || lastLine[lastLine.length - 1] !== "}") {
    return null;
  }
  let meta;
  try {
    meta = JSON.parse(lastLine);
  } catch {
    return null; // unparseable trailing block => fail closed (no metadata), exactly as today.
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return meta;
}
