// RepoMesh CLI — canonical anchor-note metadata parser (SEAM-PARSE-001).
//
// SELF-CONTAINED COPY of verifiers/lib/anchor-notes.mjs. The published CLI cannot import across the
// package boundary, so the canonical parser is duplicated here. A drift test
// (packages/repomesh-cli/tests/anchor-notes-drift.test.mjs) asserts the parse-function body below is
// BYTE-IDENTICAL to the verifiers/lib copy. Edit BOTH copies identically.
//
// An anchor event's `notes` is written by anchor/xrpl/scripts/emit-anchor-event.mjs as a human prose
// line followed by ONE trailing line that is the WHOLE compact JSON metadata object. The canonical
// rule parses the LAST LINE of `notes` as a single JSON object — immune to a `{`/`}` appearing in the
// prose, behavior-preserving for every live anchor, and fail-closed (null) on anything unparseable.

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
