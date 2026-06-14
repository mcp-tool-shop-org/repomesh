// safe-json — strict JSON parsing for trust-critical inputs (CLI-010).
//
// JSON.parse silently accepts duplicate object keys (last-wins) and silently
// coerces over-large numeric literals to Infinity. For a trust ledger, a
// duplicate key is a smuggling vector: a forger can present one keyId/value to
// a permissive parser and another to a strict one, splitting the signed view
// from the displayed view. We reject both here, and always DISPLAY from the
// canonicalized parsed object rather than echoing attacker-controlled raw bytes.
import path from "node:path";
import { canonicalize } from "./canonicalize.mjs";

/**
 * Path-traversal-safe containment check (CLI-011).
 *
 * The naive `resolved.startsWith(root)` is wrong: "/a/root" startsWith-matches
 * "/a/rootEVIL/x", letting a sibling directory masquerade as inside the root.
 * We resolve both paths and require either exact equality OR that `target`
 * begins with `root + path.sep`, using the platform separator.
 */
export function isPathInside(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  if (t === r) return true;
  const rWithSep = r.endsWith(path.sep) ? r : r + path.sep;
  return t.startsWith(rWithSep);
}

/**
 * Parse JSON, rejecting:
 *  - duplicate keys anywhere in the document
 *  - non-finite numbers (literals that JSON.parse coerces to ±Infinity)
 * Throws a structured Error on any violation.
 */
export function parseStrictJson(text) {
  // Track duplicate keys via a reviver. The reviver is called bottom-up; to see
  // duplicate keys within a single object we need the raw text, because by the
  // time the reviver runs the duplicates have already collapsed. So we do a
  // two-pass approach: JSON.parse (with a non-finite guard reviver) for the
  // value, plus a structural scan of the token stream for duplicate keys.
  const value = JSON.parse(text, (key, val) => {
    if (typeof val === "number" && !Number.isFinite(val)) {
      throw new Error(`Rejecting non-finite number for key "${key}"`);
    }
    return val;
  });
  assertNoDuplicateKeys(text);
  return value;
}

/**
 * Scan the JSON token stream and throw if any object contains a repeated key.
 * Implemented as a minimal tokenizer that tracks object scopes and the set of
 * keys seen at each scope. Strings (including keys) honor JSON escaping.
 */
function assertNoDuplicateKeys(text) {
  const STACK = []; // each frame: { type: 'object'|'array', keys: Set, expecting: 'key'|'colon'|'value'|'comma', pendingKey: string|null }
  let i = 0;
  const n = text.length;

  function skipWs() { while (i < n && /\s/.test(text[i])) i++; }

  function readString() {
    // assumes text[i] === '"'
    let s = "";
    i++; // opening quote
    while (i < n) {
      const c = text[i];
      if (c === "\\") {
        const next = text[i + 1];
        if (next === "u") { s += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 6; }
        else {
          const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          s += map[next] ?? next; i += 2;
        }
      } else if (c === '"') { i++; return s; }
      else { s += c; i++; }
    }
    throw new Error("Unterminated string in JSON");
  }

  function skipScalar() {
    // numbers, true, false, null
    while (i < n && !/[,\]}\s]/.test(text[i])) i++;
  }

  skipWs();
  while (i < n) {
    const c = text[i];
    const top = STACK[STACK.length - 1];

    if (c === "{") {
      STACK.push({ type: "object", keys: new Set(), state: "key" });
      i++; skipWs(); continue;
    }
    if (c === "[") {
      STACK.push({ type: "array" });
      i++; skipWs(); continue;
    }
    if (c === "}") { STACK.pop(); i++; skipWs(); continue; }
    if (c === "]") { STACK.pop(); i++; skipWs(); continue; }
    if (c === "," || c === ":") {
      if (top?.type === "object" && c === ",") top.state = "key";
      i++; skipWs(); continue;
    }

    if (top?.type === "object" && top.state === "key" && c === '"') {
      const key = readString();
      if (top.keys.has(key)) {
        throw new Error(`Rejecting JSON with duplicate key "${key}"`);
      }
      top.keys.add(key);
      top.state = "value";
      skipWs(); continue;
    }

    // value position (object value or array element or top-level)
    if (c === '"') { readString(); skipWs(); continue; }
    skipScalar(); skipWs();
  }
}

/**
 * Canonical display string: render from the PARSED object (sorted keys, stable),
 * never the raw attacker-supplied bytes. Use for any echo of ledger-derived data.
 */
export function displayCanonical(obj) {
  return canonicalize(obj);
}
