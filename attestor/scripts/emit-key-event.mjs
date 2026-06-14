#!/usr/bin/env node
// RepoMesh Attestor — emit a KeyRotation / KeyRevocation event AND apply the matching
// node.json maintainer-window edit, against a LOCAL ledger checkout. This is the root-side
// twin of `repomesh key rotate|revoke`; it reuses signEvent from verifiers/lib/common.mjs
// directly (contract §7 — "Reuse signEvent"), since the root scripts CAN import across the
// repo (unlike the published, self-contained CLI which mirrors the same algorithm).
//
// It writes ONLY to the local ledger/node files the operator points it at — it NEVER
// broadcasts to the real network. The emitted event is validated by validate-ledger (§8),
// whose binding check requires the node.json window edit this script applies.
//
// Usage:
//   node attestor/scripts/emit-key-event.mjs rotate \
//     --repo org/repo --retiring-key-id k1 --new-key-id k2 \
//     --new-public-key-file new.pub.pem --effective-at 2026-06-14T12:00:00Z \
//     --signing-key-id k1 --signing-key-file retiring.priv.pem [--root <dir>] [--dry-run]
//
//   node attestor/scripts/emit-key-event.mjs revoke \
//     --repo org/repo --revoked-key-id k1 --reason compromise \
//     --invalid-after 2026-06-18T00:00:00Z \
//     --signing-key-id k2 --signing-key-file surviving.priv.pem [--root <dir>] [--dry-run]
//
//   REPOMESH_SIGNING_KEY env may supply the PEM instead of --signing-key-file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signEvent } from "../../verifiers/lib/common.mjs";

const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/;

export function buildKeyRotationEvent({ repo, retiringKeyId, newKeyId, newPublicKey, effectiveAt, timestamp }) {
  return {
    type: "KeyRotation",
    repo,
    timestamp: timestamp || new Date().toISOString(),
    key: { action: "rotate", retiringKeyId, newKeyId, newPublicKey, effectiveAt },
  };
}

export function buildKeyRevocationEvent({ repo, revokedKeyId, reason, invalidAfter, timestamp }) {
  const key = { action: "revoke", revokedKeyId, reason };
  if (reason === "compromise" && invalidAfter) key.invalidAfter = invalidAfter;
  return { type: "KeyRevocation", repo, timestamp: timestamp || new Date().toISOString(), key };
}

export function applyRotationToNode(node, { retiringKeyId, newKeyId, newPublicKey, effectiveAt }) {
  const next = JSON.parse(JSON.stringify(node));
  const ms = Array.isArray(next.maintainers) ? next.maintainers : (next.maintainers = []);
  const retiring = ms.find((m) => m?.keyId === retiringKeyId);
  if (!retiring) throw new Error(`Retiring keyId "${retiringKeyId}" not found in ${node.id || "node.json"} maintainers`);
  if (ms.some((m) => m?.keyId === newKeyId)) throw new Error(`New keyId "${newKeyId}" already exists in ${node.id || "node.json"} maintainers`);
  retiring.validUntil = effectiveAt;
  retiring.revokedAt = effectiveAt;
  retiring.revocationReason = "rotation";
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
  if (!target) throw new Error(`Revoked keyId "${revokedKeyId}" not found in ${node.id || "node.json"} maintainers`);
  target.revokedAt = revokedAt;
  target.revocationReason = reason;
  if (reason === "compromise") target.invalidAfter = invalidAfter || revokedAt;
  return next;
}

function nodeJsonPath(root, repo) {
  const parts = (repo || "").split("/");
  const [org, repoName] = parts;
  const safe = (s) => SAFE_SEGMENT.test(s) && s !== "." && s !== "..";
  if (parts.length !== 2 || !org || !repoName || !safe(org) || !safe(repoName)) {
    throw new Error(`Invalid --repo "${repo}": must be org/repo matching /^[a-zA-Z0-9_.-]+$/ (no path traversal).`);
  }
  return path.join(root, "ledger", "nodes", org, repoName, "node.json");
}

function ledgerEventsPath(root) {
  return path.join(root, "ledger", "events", "events.jsonl");
}

// emitKeyEvent(opts) — the importable core. Mirrors the CLI orchestrator but uses signEvent
// from common.mjs. Returns { event, eventsPath, nodePath, editedNode, dryRun, wrote }.
export function emitKeyEvent(opts) {
  const action = opts.action;
  if (action !== "rotate" && action !== "revoke") throw new Error(`Unknown action "${action}" (expected rotate|revoke).`);
  if (!opts.repo) throw new Error("Missing --repo <org/repo>.");
  if (!opts.signingKeyId) throw new Error("Missing --signing-key-id.");
  const root = opts.root || process.cwd();
  const nodePath = nodeJsonPath(root, opts.repo);
  if (!fs.existsSync(nodePath)) throw new Error(`node.json not found for ${opts.repo} at ${nodePath}`);
  const node = JSON.parse(fs.readFileSync(nodePath, "utf8"));
  const now = opts.timestamp || new Date().toISOString();

  let unsigned;
  let editedNode;
  if (action === "rotate") {
    const effectiveAt = opts.effectiveAt || now;
    let newPublicKey = opts.newPublicKey;
    if (!newPublicKey && opts.newPublicKeyFile) newPublicKey = fs.readFileSync(opts.newPublicKeyFile, "utf8").trim();
    if (!opts.retiringKeyId || !opts.newKeyId || !newPublicKey) {
      throw new Error("rotate requires --retiring-key-id, --new-key-id, --new-public-key(-file).");
    }
    unsigned = buildKeyRotationEvent({ repo: opts.repo, retiringKeyId: opts.retiringKeyId, newKeyId: opts.newKeyId, newPublicKey, effectiveAt, timestamp: now });
    editedNode = applyRotationToNode(node, { retiringKeyId: opts.retiringKeyId, newKeyId: opts.newKeyId, newPublicKey, effectiveAt });
  } else {
    if (!opts.revokedKeyId) throw new Error("revoke requires --revoked-key-id.");
    if (!opts.reason) throw new Error("revoke requires --reason <rotation|compromise|retirement>.");
    if (!["rotation", "compromise", "retirement"].includes(opts.reason)) throw new Error(`Invalid --reason "${opts.reason}".`);
    unsigned = buildKeyRevocationEvent({ repo: opts.repo, revokedKeyId: opts.revokedKeyId, reason: opts.reason, invalidAfter: opts.invalidAfter, timestamp: now });
    editedNode = applyRevocationToNode(node, { revokedKeyId: opts.revokedKeyId, reason: opts.reason, invalidAfter: opts.invalidAfter, revokedAt: now });
  }

  const privatePem = opts.signingKey
    || (opts.signingKeyFile && fs.readFileSync(opts.signingKeyFile, "utf8"))
    || process.env.REPOMESH_SIGNING_KEY;
  if (!privatePem) throw new Error("No signing key: pass --signing-key-file <pem> or set REPOMESH_SIGNING_KEY.");

  // Contract §7 — reuse signEvent from verifiers/lib/common.mjs.
  const event = signEvent(unsigned, privatePem, opts.signingKeyId);

  const eventsPath = ledgerEventsPath(root);
  const result = { action, repo: opts.repo, root, event, editedNode, eventsPath, nodePath, dryRun: !!opts.dryRun, wrote: { event: false, node: false } };
  if (opts.dryRun) return result;

  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  const needsNl = fs.existsSync(eventsPath) && fs.statSync(eventsPath).size > 0 && !fs.readFileSync(eventsPath, "utf8").endsWith("\n");
  fs.appendFileSync(eventsPath, (needsNl ? "\n" : "") + JSON.stringify(event) + "\n", "utf8");
  result.wrote.event = true;
  fs.writeFileSync(nodePath, JSON.stringify(editedNode, null, 2) + "\n", "utf8");
  result.wrote.node = true;
  return result;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function usage() {
  console.error("Usage:");
  console.error("  node attestor/scripts/emit-key-event.mjs rotate --repo org/repo \\");
  console.error("    --retiring-key-id <k1> --new-key-id <k2> --new-public-key-file <pem> \\");
  console.error("    [--effective-at <iso>] --signing-key-id <k1> --signing-key-file <pem> [--root <dir>] [--dry-run]");
  console.error("  node attestor/scripts/emit-key-event.mjs revoke --repo org/repo \\");
  console.error("    --revoked-key-id <k1> --reason <rotation|compromise|retirement> [--invalid-after <iso>] \\");
  console.error("    --signing-key-id <k2> --signing-key-file <pem> [--root <dir>] [--dry-run]");
}

function main() {
  const raw = process.argv.slice(2);
  const action = raw[0];
  if (!action || action === "--help" || action === "-h" || (action !== "rotate" && action !== "revoke")) {
    usage();
    process.exit(action === "--help" || action === "-h" ? 0 : 1);
  }
  const a = parseArgs(raw.slice(1));
  try {
    const result = emitKeyEvent({
      action,
      repo: a.repo,
      root: typeof a.root === "string" ? a.root : process.cwd(),
      dryRun: !!a.dryRun,
      signingKeyId: a.signingKeyId,
      signingKey: typeof a.signingKey === "string" ? a.signingKey : undefined,
      signingKeyFile: typeof a.signingKeyFile === "string" ? a.signingKeyFile : undefined,
      timestamp: typeof a.timestamp === "string" ? a.timestamp : undefined,
      retiringKeyId: a.retiringKeyId,
      newKeyId: a.newKeyId,
      newPublicKey: typeof a.newPublicKey === "string" ? a.newPublicKey : undefined,
      newPublicKeyFile: typeof a.newPublicKeyFile === "string" ? a.newPublicKeyFile : undefined,
      effectiveAt: typeof a.effectiveAt === "string" ? a.effectiveAt : undefined,
      revokedKeyId: a.revokedKeyId,
      reason: a.reason,
      invalidAfter: typeof a.invalidAfter === "string" ? a.invalidAfter : undefined,
    });
    if (result.dryRun) {
      console.log(`--- DRY RUN: ${action} ${result.repo} (nothing written) ---`);
      console.log(JSON.stringify(result.event, null, 2));
      console.log(`\nWould append to: ${result.eventsPath}`);
      console.log(`Would edit:      ${result.nodePath}`);
    } else {
      console.log(`Emitted ${action} for ${result.repo}`);
      console.log(`  appended event -> ${result.eventsPath}`);
      console.log(`  edited node    -> ${result.nodePath}`);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
