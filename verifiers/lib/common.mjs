#!/usr/bin/env node
// RepoMesh Verifier — Shared utilities for all verifier scripts.
// Extracted from attestor/scripts/attest-release.mjs patterns.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function readEvents(ledgerPath) {
  const p = ledgerPath || path.join(process.cwd(), "ledger/events/events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

export function findReleaseEvent(events, repo, version) {
  return events.find(ev =>
    ev?.type === "ReleasePublished" &&
    ev?.repo === repo &&
    ev?.version === version
  );
}

export function hasAttestationEvent(events, repo, version, attestationType) {
  return events.some(ev => {
    if (ev?.type !== "AttestationPublished") return false;
    if (ev?.repo !== repo || ev?.version !== version) return false;
    const ats = Array.isArray(ev.attestations) ? ev.attestations : [];
    return ats.some(a => a?.type === attestationType);
  });
}

export function findNodeManifest(repoId) {
  const [org, repo] = repoId.split("/");
  const p = path.join(process.cwd(), "ledger/nodes", org, repo, "node.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Node manifest not found for ${repoId} at ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function getPublicKeyForKeyId(nodeManifest, keyId) {
  const ms = nodeManifest?.maintainers || [];
  const m = ms.find(x => x?.keyId === keyId);
  if (!m?.publicKey) throw new Error(`No maintainer publicKey for keyId=${keyId} in ${nodeManifest.id}`);
  return String(m.publicKey).trim();
}

export function computeCanonicalHash(evWithoutSignature) {
  const canon = canonicalize(evWithoutSignature);
  return crypto.createHash("sha256").update(canon, "utf8").digest("hex");
}

export function signEvent(event, privateKeyPem, keyId) {
  const ev = JSON.parse(JSON.stringify(event));
  delete ev.signature;

  const canonicalHash = computeCanonicalHash(ev);
  const sig = crypto.sign(null, Buffer.from(canonicalHash, "hex"), privateKeyPem).toString("base64");

  return {
    ...ev,
    signature: {
      alg: "ed25519",
      keyId,
      value: sig,
      canonicalHash
    }
  };
}

export function buildAttestationEvent({ repo, version, commit, artifacts, attestations, notes }) {
  return {
    type: "AttestationPublished",
    repo,
    version,
    commit,
    timestamp: new Date().toISOString(),
    artifacts: artifacts || [],
    attestations,
    notes: notes || "",
    signature: { alg: "ed25519", keyId: "", value: "", canonicalHash: "" }
  };
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

export function writeJsonlLine(outPath, obj) {
  if (!outPath) return;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.appendFileSync(outPath, JSON.stringify(obj) + "\n", "utf8");
}

export function loadSigningKeyFromEnvOrFile({ envVar = "REPOMESH_SIGNING_KEY", filePath }) {
  if (process.env[envVar]) return process.env[envVar];
  if (!filePath) throw new Error(`Missing signing key: set ${envVar} or pass --signing-key <path>`);
  return fs.readFileSync(filePath, "utf8");
}
