// repomesh key rotate / key revoke — build + sign + append a KeyRotation/KeyRevocation
// event AND apply the matching node.json maintainer-window edit, against a LOCAL ledger
// root the user points at (--local <dir> / --dir <dir>; default cwd). Never broadcasts.
//
// Contract: docs/contracts/key-lifecycle-contract.md §4 (event shapes), §7 (emission),
// §8 (the node.json edits validate-ledger's binding check asserts).
//
// SELF-CONTAINED on purpose: the published CLI ships only dist/ (package.json `files`),
// so it cannot import across the package boundary into verifiers/lib/common.mjs. The
// signing here is byte-identical to verifiers/lib/common.mjs#signEvent — same canonical
// JSON (sorted keys), same sha256 leaf, same ed25519 over the hash bytes. The root-side
// attestor/scripts/emit-key-event.mjs DOES reuse signEvent directly (contract §7).
//
// node.json window edits (contract §4.1 / §4.2 — the read surface §6, the binding §8):
//   rotate:  retiring key -> validUntil = revokedAt = effectiveAt, revocationReason = "rotation";
//            new key appended with validFrom = effectiveAt.
//   revoke:  revoked key  -> revokedAt = <timestamp>, revocationReason = <reason>,
//            and (reason === "compromise") invalidAfter = <key.invalidAfter>.
//
// GRANDFATHER INVARIANT: a maintainer the command does not touch is left byte-identical.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalize } from "../verify/canonicalize.mjs";

// org/repo path guard — same shape as the rest of the codebase (path-traversal safe).
const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/;

export class KeyCmdError extends Error {
  constructor(message, { code, hint } = {}) {
    super(message);
    this.name = "KeyCmdError";
    this.code = code || "REPOMESH_KEY_ERROR";
    if (hint) this.hint = hint;
  }
}

// --- signing (byte-identical to verifiers/lib/common.mjs#signEvent) --------------------
export function computeCanonicalHash(evWithoutSignature) {
  return crypto.createHash("sha256").update(canonicalize(evWithoutSignature), "utf8").digest("hex");
}

export function signKeyEvent(event, privateKeyPem, keyId) {
  const ev = JSON.parse(JSON.stringify(event));
  delete ev.signature;
  const canonicalHash = computeCanonicalHash(ev);
  const sig = crypto.sign(null, Buffer.from(canonicalHash, "hex"), privateKeyPem).toString("base64");
  return { ...ev, signature: { alg: "ed25519", keyId, value: sig, canonicalHash } };
}

// --- event builders (contract §4) ------------------------------------------------------
// KeyRotation/KeyRevocation carry NO version/commit/artifacts — only the `key` object plus
// the base envelope (type/repo/timestamp/signature). See event.schema.json conditional.
export function buildKeyRotationEvent({ repo, retiringKeyId, newKeyId, newPublicKey, effectiveAt, timestamp }) {
  return {
    type: "KeyRotation",
    repo,
    timestamp: timestamp || new Date().toISOString(),
    key: {
      action: "rotate",
      retiringKeyId,
      newKeyId,
      newPublicKey,
      effectiveAt,
    },
    signature: { alg: "ed25519", keyId: "", value: "", canonicalHash: "" },
  };
}

export function buildKeyRevocationEvent({ repo, revokedKeyId, reason, invalidAfter, timestamp }) {
  const key = { action: "revoke", revokedKeyId, reason };
  // invalidAfter is the RFC 5280 §5.3.2 invalidity date; carried only for compromise (it may
  // precede revokedAt). For rotation/retirement reasons it is omitted (validate-ledger §8.2
  // requires it ONLY when reason === "compromise").
  if (reason === "compromise" && invalidAfter) key.invalidAfter = invalidAfter;
  return {
    type: "KeyRevocation",
    repo,
    timestamp: timestamp || new Date().toISOString(),
    key,
    signature: { alg: "ed25519", keyId: "", value: "", canonicalHash: "" },
  };
}

// --- node.json window edits (contract §4 / §6 / §8 binding) ----------------------------
// Returns a NEW node object (does not mutate the input). Every maintainer the edit does not
// target is copied through byte-identically (grandfather invariant).
export function applyRotationToNode(node, { retiringKeyId, newKeyId, newPublicKey, effectiveAt }) {
  const next = JSON.parse(JSON.stringify(node));
  const ms = Array.isArray(next.maintainers) ? next.maintainers : (next.maintainers = []);
  const retiring = ms.find((m) => m?.keyId === retiringKeyId);
  if (!retiring) {
    throw new KeyCmdError(`Retiring keyId "${retiringKeyId}" not found in ${node.id || "node.json"} maintainers`, {
      code: "REPOMESH_KEY_RETIRING_NOT_FOUND",
      hint: "Pass --retiring-key-id matching an existing maintainer.keyId in the target node.json.",
    });
  }
  if (ms.some((m) => m?.keyId === newKeyId)) {
    throw new KeyCmdError(`New keyId "${newKeyId}" already exists in ${node.id || "node.json"} maintainers`, {
      code: "REPOMESH_KEY_NEW_EXISTS",
      hint: "Choose a --new-key-id that is not already registered.",
    });
  }
  // Retiring key: prospective retirement. Past signatures (trusted time < effectiveAt) stay valid.
  retiring.validUntil = effectiveAt;
  retiring.revokedAt = effectiveAt;
  retiring.revocationReason = "rotation";
  // New key: valid from the rotation moment.
  ms.push({
    name: retiring.name || (node.id || "").split("/")[0] || "",
    keyId: newKeyId,
    publicKey: newPublicKey,
    contact: retiring.contact || "",
    validFrom: effectiveAt,
  });
  return next;
}

export function applyRevocationToNode(node, { revokedKeyId, reason, invalidAfter, revokedAt }) {
  const next = JSON.parse(JSON.stringify(node));
  const ms = Array.isArray(next.maintainers) ? next.maintainers : (next.maintainers = []);
  const target = ms.find((m) => m?.keyId === revokedKeyId);
  if (!target) {
    throw new KeyCmdError(`Revoked keyId "${revokedKeyId}" not found in ${node.id || "node.json"} maintainers`, {
      code: "REPOMESH_KEY_REVOKED_NOT_FOUND",
      hint: "Pass --revoked-key-id matching an existing maintainer.keyId in the target node.json.",
    });
  }
  target.revokedAt = revokedAt;
  target.revocationReason = reason;
  if (reason === "compromise") {
    // Default invalidAfter to revokedAt when not provided (matches the predicate's boundary
    // default in key-window.mjs and event.schema.json keyLifecycle.invalidAfter description).
    target.invalidAfter = invalidAfter || revokedAt;
  }
  return next;
}

// --- local ledger / node.json I/O ------------------------------------------------------
export function nodeJsonPath(root, repo) {
  const parts = (repo || "").split("/");
  const [org, repoName] = parts;
  // Exactly org/repo (2 parts), each matching the safe charset and NOT a traversal segment.
  const safe = (s) => SAFE_SEGMENT.test(s) && s !== "." && s !== "..";
  if (parts.length !== 2 || !org || !repoName || !safe(org) || !safe(repoName)) {
    throw new KeyCmdError(`Invalid --repo "${repo}": must be org/repo matching /^[a-zA-Z0-9_.-]+$/ (no path traversal).`, {
      code: "REPOMESH_KEY_BAD_REPO",
      hint: "Use the org/repo form, e.g. mcp-tool-shop-org/foo.",
    });
  }
  return path.join(root, "ledger", "nodes", org, repoName, "node.json");
}

export function ledgerEventsPath(root) {
  return path.join(root, "ledger", "events", "events.jsonl");
}

function readNode(root, repo) {
  const p = nodeJsonPath(root, repo);
  if (!fs.existsSync(p)) {
    throw new KeyCmdError(`node.json not found for ${repo} at ${p}`, {
      code: "REPOMESH_KEY_NODE_MISSING",
      hint: "Point --local / --dir at a RepoMesh ledger checkout that contains ledger/nodes/<org>/<repo>/node.json.",
    });
  }
  try {
    return { node: JSON.parse(fs.readFileSync(p, "utf8")), path: p };
  } catch (e) {
    throw new KeyCmdError(`Invalid JSON in ${p}: ${e.message}`, { code: "REPOMESH_KEY_NODE_PARSE" });
  }
}

function loadSigningKey({ signingKey, signingKeyFile }) {
  // Explicit value wins; then file; then env (matches the rest of the toolchain).
  if (signingKey) return signingKey;
  if (signingKeyFile) {
    if (!fs.existsSync(signingKeyFile)) {
      throw new KeyCmdError(`Signing key file not found: ${signingKeyFile}`, { code: "REPOMESH_KEY_SIGNKEY_MISSING" });
    }
    return fs.readFileSync(signingKeyFile, "utf8");
  }
  if (process.env.REPOMESH_SIGNING_KEY) return process.env.REPOMESH_SIGNING_KEY;
  throw new KeyCmdError("No signing key: pass --signing-key-file <pem>, --signing-key <pem>, or set REPOMESH_SIGNING_KEY.", {
    code: "REPOMESH_KEY_NO_SIGNKEY",
    hint: "The retiring key (rotate) or a surviving / trustedPolicy key (revoke) must sign the event — contract §4.",
  });
}

// --- orchestrator ----------------------------------------------------------------------
// keyCommand(opts) — builds the event, signs it, computes the node.json edit, and (unless
// dryRun) appends the event to the local ledger + writes the edited node.json. Returns a
// structured plan/result object (the CLI prints it; --json passes it through).
//
// opts:
//   action: 'rotate' | 'revoke'
//   repo: 'org/repo'                (required)
//   root: local ledger root         (default process.cwd())
//   dryRun: boolean                 (compute only; write nothing)
//   signingKeyId: keyId for signature.keyId (required)
//   signingKey / signingKeyFile / REPOMESH_SIGNING_KEY  (the private PEM)
//   timestamp / effectiveAt / invalidAfter: ISO date-time strings (effectiveAt/timestamp default now)
//   rotate:  retiringKeyId, newKeyId, newPublicKey (or newPublicKeyFile), effectiveAt
//   revoke:  revokedKeyId, reason, invalidAfter
export function keyCommand(opts) {
  const action = opts.action;
  if (action !== "rotate" && action !== "revoke") {
    throw new KeyCmdError(`Unknown key action "${action}" (expected "rotate" or "revoke").`, { code: "REPOMESH_KEY_BAD_ACTION" });
  }
  const repo = opts.repo;
  if (!repo) throw new KeyCmdError("Missing --repo <org/repo>.", { code: "REPOMESH_KEY_NO_REPO" });
  const root = opts.root || process.cwd();
  const signingKeyId = opts.signingKeyId;
  if (!signingKeyId) {
    throw new KeyCmdError("Missing --signing-key-id (the keyId recorded in signature.keyId).", {
      code: "REPOMESH_KEY_NO_SIGNKEYID",
      hint: "rotate: sign with the retiring key. revoke: sign with a surviving same-node key or a trustedPolicy key (contract §4).",
    });
  }

  const { node, path: nodePath } = readNode(root, repo);
  const now = opts.timestamp || new Date().toISOString();

  let unsigned;
  let editedNode;
  if (action === "rotate") {
    const effectiveAt = opts.effectiveAt || now;
    let newPublicKey = opts.newPublicKey;
    if (!newPublicKey && opts.newPublicKeyFile) {
      if (!fs.existsSync(opts.newPublicKeyFile)) {
        throw new KeyCmdError(`New public key file not found: ${opts.newPublicKeyFile}`, { code: "REPOMESH_KEY_NEWPUB_MISSING" });
      }
      newPublicKey = fs.readFileSync(opts.newPublicKeyFile, "utf8").trim();
    }
    for (const [k, v] of [["--retiring-key-id", opts.retiringKeyId], ["--new-key-id", opts.newKeyId], ["new public key", newPublicKey]]) {
      if (!v) throw new KeyCmdError(`rotate requires ${k}.`, { code: "REPOMESH_KEY_ROTATE_INCOMPLETE", hint: "rotate => --retiring-key-id, --new-key-id, --new-public-key(-file), [--effective-at]." });
    }
    unsigned = buildKeyRotationEvent({ repo, retiringKeyId: opts.retiringKeyId, newKeyId: opts.newKeyId, newPublicKey, effectiveAt, timestamp: now });
    editedNode = applyRotationToNode(node, { retiringKeyId: opts.retiringKeyId, newKeyId: opts.newKeyId, newPublicKey, effectiveAt });
  } else {
    const reason = opts.reason;
    if (!opts.revokedKeyId) throw new KeyCmdError("revoke requires --revoked-key-id.", { code: "REPOMESH_KEY_REVOKE_INCOMPLETE" });
    if (!reason) throw new KeyCmdError("revoke requires --reason <rotation|compromise|retirement>.", { code: "REPOMESH_KEY_REVOKE_NO_REASON" });
    if (!["rotation", "compromise", "retirement"].includes(reason)) {
      throw new KeyCmdError(`Invalid --reason "${reason}" (expected rotation|compromise|retirement).`, { code: "REPOMESH_KEY_BAD_REASON" });
    }
    if (reason === "compromise" && !opts.invalidAfter) {
      // Permitted but defaulted: validate-ledger §8.2 wants invalidAfter present for compromise.
      // We default it to the revocation timestamp so the emitted event is self-consistent.
    }
    unsigned = buildKeyRevocationEvent({ repo, revokedKeyId: opts.revokedKeyId, reason, invalidAfter: opts.invalidAfter, timestamp: now });
    editedNode = applyRevocationToNode(node, { revokedKeyId: opts.revokedKeyId, reason, invalidAfter: opts.invalidAfter, revokedAt: now });
  }

  const signingKey = loadSigningKey(opts);
  const event = signKeyEvent(unsigned, signingKey, signingKeyId);

  const eventsPath = ledgerEventsPath(root);
  const nodeText = JSON.stringify(editedNode, null, 2) + "\n";
  const eventLine = JSON.stringify(event);

  const result = {
    action,
    repo,
    root,
    dryRun: !!opts.dryRun,
    event,
    eventsPath,
    nodePath,
    wrote: { event: false, node: false },
  };

  if (opts.dryRun) return result;

  // Append event + write node.json. Append-only ledger invariant (contract §11): we only
  // append a line; we never rewrite existing ledger lines.
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  const needsNl = fs.existsSync(eventsPath) && fs.statSync(eventsPath).size > 0 &&
    !fs.readFileSync(eventsPath, "utf8").endsWith("\n");
  fs.appendFileSync(eventsPath, (needsNl ? "\n" : "") + eventLine + "\n", "utf8");
  result.wrote.event = true;
  fs.writeFileSync(nodePath, nodeText, "utf8");
  result.wrote.node = true;
  return result;
}
