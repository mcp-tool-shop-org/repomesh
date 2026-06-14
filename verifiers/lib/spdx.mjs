// RepoMesh Verifier — SPDX license expression parser + classifier (SEC-006).
//
// The original license verifier treated each license token as a flat string. A compound SPDX
// expression like "MIT OR GPL-3.0-only" was checked verbatim against the allowlist (never present),
// and the copyleft prefix "GPL-" never matched via startsWith on the whole string — so compound
// expressions defeated copyleft detection in BOTH directions (false unknowns AND missed copyleft).
//
// This module tokenizes AND / OR / parentheses, strips trailing "+" and "WITH <exception>", and
// classifies the whole expression with proper semantics:
//   OR  = any arm allowed  -> allowed if any arm allowed; else copyleft if any arm copyleft; else unknown
//   AND = every arm allowed -> copyleft if any arm copyleft (poisons AND); else unknown if any unknown; else allowed

// Tokenize an SPDX expression into AND/OR/(/) and license identifiers.
export function tokenizeSpdx(expr) {
  const tokens = [];
  // Insert spaces around parentheses so split() separates them.
  const spaced = String(expr).replace(/\(/g, " ( ").replace(/\)/g, " ) ");
  for (const raw of spaced.split(/\s+/)) {
    const t = raw.trim();
    if (!t) continue;
    const upper = t.toUpperCase();
    if (upper === "AND" || upper === "OR" || t === "(" || t === ")") {
      tokens.push({ kind: upper === "AND" ? "AND" : upper === "OR" ? "OR" : t });
    } else if (upper === "WITH") {
      tokens.push({ kind: "WITH" });
    } else {
      tokens.push({ kind: "ID", value: t });
    }
  }
  return tokens;
}

// Normalize a single license identifier: strip a trailing "+" (or-later) for classification.
export function normalizeLicenseId(id) {
  return String(id).replace(/\+$/, "").trim();
}

// Recursive-descent parser. Grammar (OR binds looser than AND, standard SPDX precedence):
//   expr := term (OR term)*
//   term := factor (AND factor)*
//   factor := ID [WITH ID] | ( expr )
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let node = parseTerm();
    while (peek() && peek().kind === "OR") {
      next();
      const rhs = parseTerm();
      node = { op: "OR", args: [node, rhs] };
    }
    return node;
  }
  function parseTerm() {
    let node = parseFactor();
    while (peek() && peek().kind === "AND") {
      next();
      const rhs = parseFactor();
      node = { op: "AND", args: [node, rhs] };
    }
    return node;
  }
  function parseFactor() {
    const t = peek();
    if (!t) return { op: "ID", value: "" };
    if (t.kind === "(") {
      next();
      const node = parseExpr();
      if (peek() && peek().kind === ")") next();
      return node;
    }
    if (t.kind === "ID") {
      next();
      // Skip a trailing WITH <exception> — the exception does not change allow/copyleft class.
      if (peek() && peek().kind === "WITH") {
        next();
        if (peek() && peek().kind === "ID") next();
      }
      return { op: "ID", value: normalizeLicenseId(t.value) };
    }
    // Unexpected operator at factor position; consume to avoid infinite loop.
    next();
    return { op: "ID", value: "" };
  }

  return parseExpr();
}

// classify a single normalized id -> "allowed" | "copyleft" | "unknown"
function classifyId(id, { allow, coexact, coprefix }) {
  if (!id) return "unknown";
  if (coexact.has(id) || coprefix.some(p => id.startsWith(p))) return "copyleft";
  if (allow.has(id)) return "allowed";
  return "unknown";
}

function evalNode(node, ctx) {
  if (node.op === "ID") return classifyId(node.value, ctx);
  const classes = node.args.map(a => evalNode(a, ctx));
  if (node.op === "OR") {
    if (classes.includes("allowed")) return "allowed";
    if (classes.includes("copyleft")) return "copyleft";
    return "unknown";
  }
  // AND: copyleft arm poisons; then any unknown -> unknown; else allowed.
  if (classes.includes("copyleft")) return "copyleft";
  if (classes.includes("unknown")) return "unknown";
  return "allowed";
}

// Classify a full SPDX expression string. ctx = { allow:Set, coexact:Set, coprefix:string[] }.
// Returns "allowed" | "copyleft" | "unknown".
export function classifySpdxExpression(expr, ctx) {
  const tokens = tokenizeSpdx(expr);
  if (tokens.length === 0) return "unknown";
  const ast = parse(tokens);
  return evalNode(ast, ctx);
}
