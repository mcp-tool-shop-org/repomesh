// repomesh keygen — mint a DISTINCT per-node ed25519 keypair so an operator can follow the
// TUF §6.1 separation-of-duties recommendation (register >=2 maintainer keys, so one key can
// sign the other's revocation) instead of the single-key default.
//
// SELF-CONTAINED on purpose (same constraint as rotate-revoke.mjs): the published CLI ships only
// dist/ (package.json `files`), so it cannot import across the package boundary. The key material
// here is byte-identical in format to what init.mjs, rotate-revoke.mjs and the verifiers expect —
// ed25519, PEM spki public / pkcs8 private. A keygen that produced any other format would be a bug
// (the verifier chain would reject the key).
//
// SECRET DISCIPLINE (non-negotiable): the private key is a SECRET.
//   * generateKeyMaterial() is PURE by default — it returns the material in-memory and writes
//     NOTHING to disk. The caller decides whether to print it (with a loud warning) or persist it.
//   * If `privateKeyOut` is given, the private PEM is written to that EXPLICIT path with 0600 perms
//     (owner read/write only). It is never written to a default / git-tracked path on its own.
//   * The returned `maintainer` object NEVER contains the private key — it is the paste-ready
//     node.json maintainer shape (name/keyId/publicKey), public material only.

import fs from "node:fs";
import crypto from "node:crypto";
// Reuse the shipped key error class so keygen errors carry the same {code,message,hint} shape and
// classify to exit 2 (operator/usage error) in cli.mjs's catch handler.
import { KeyCmdError } from "./rotate-revoke.mjs";

// node.schema.json $defs/maintainer.keyId pattern. A minted keyId MUST satisfy this or it cannot
// be pasted into node.json (the schema validator would reject the manifest).
const KEYID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,118}[a-z0-9]$/;

// Derive a schema-valid default keyId from the repo, matching init.mjs's `ci-<repo>-<year>`
// convention but with a per-key suffix so distinct calls don't collide on the same node (the whole
// point of separation of duties is DISTINCT keys). Lowercase + sanitize to the schema charset.
export function deriveKeyId(repo, { suffix } = {}) {
  const repoName = String(repo || "").split("/").pop() || "node";
  const safeRepo = repoName.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "node";
  const year = new Date().getFullYear();
  // A short random suffix keeps successive mints distinct (SoD => DISTINCT keys per signer).
  const tail = suffix
    ? String(suffix).toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "")
    : crypto.randomBytes(3).toString("hex");
  let id = `ci-${safeRepo}-${year}-${tail}`.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  // Guard the 120-char ceiling (schema max length) — trim from the middle-ish if needed.
  if (id.length > 120) id = id.slice(0, 120).replace(/[^a-z0-9]+$/g, "");
  return id;
}

// generateKeyMaterial(opts) — mint an ed25519 keypair + a paste-ready maintainer block.
//
// opts:
//   repo: 'org/repo'           (used to derive a default keyId; not validated as a path here)
//   keyId: explicit keyId      (must satisfy node.schema.json maintainer.keyId pattern)
//   name: maintainer.name      (defaults to the org segment of repo, or repo, or "maintainer")
//   suffix: keyId suffix       (when deriving; e.g. "signer-a" for a named SoD role)
//   privateKeyOut: file path   (OPTIONAL — when given, write the private PEM there with 0600)
//
// returns: { keyId, publicKey, privateKey, maintainer, privateKeyWritten|null }
export function generateKeyMaterial(opts = {}) {
  const repo = opts.repo;
  const keyId = opts.keyId ? String(opts.keyId) : deriveKeyId(repo, { suffix: opts.suffix });
  if (!KEYID_PATTERN.test(keyId)) {
    throw new KeyCmdError(
      `Invalid keyId "${keyId}": must match ${KEYID_PATTERN} (lowercase alnum/._- , 2..120 chars, no leading/trailing punctuation).`,
      { code: "REPOMESH_KEYGEN_BAD_KEYID", hint: "Use a keyId like ci-myrepo-2026-signer-a (matches node.schema.json maintainer.keyId)." },
    );
  }

  let publicKey, privateKey;
  try {
    const pair = crypto.generateKeyPairSync("ed25519");
    privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
    publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
  } catch (e) {
    throw new KeyCmdError(`ed25519 keypair generation failed: ${e.message}`, { code: "REPOMESH_KEYGEN_FAILED" });
  }

  const name = (opts.name && String(opts.name)) || String(repo || "").split("/")[0] || repo || "maintainer";

  // Paste-ready node.json maintainer shape (public material only — never the secret).
  const maintainer = { name, keyId, publicKey, contact: "" };

  let privateKeyWritten = null;
  if (opts.privateKeyOut) {
    const out = String(opts.privateKeyOut);
    // mode 0600: owner read/write only. On Windows the bits are advisory but we still pass them.
    fs.writeFileSync(out, privateKey + "\n", { encoding: "utf8", mode: 0o600 });
    // Best-effort tighten in case the file pre-existed with looser perms (POSIX).
    try { fs.chmodSync(out, 0o600); } catch { /* non-POSIX */ }
    privateKeyWritten = out;
  }

  return { keyId, publicKey, privateKey, maintainer, privateKeyWritten };
}
