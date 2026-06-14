// RepoMesh Verifier — overrides loader with schema validation (SEC-003, SEC-009).
//
// Per-repo overrides (`ledger/nodes/<org>/<repo>/repomesh.overrides.json`) are attacker-influenceable
// (a repo maintainer controls their own node tree). Before any verifier honors an override, the file
// MUST validate against schemas/repomesh.overrides.schema.json. On any validation failure we REJECT
// the override (throw) rather than silently returning null — a malformed override must not be treated
// as "no override" (which could mask a downgrade attempt) nor be honored blindly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SCHEMA_PATH = path.join(ROOT, "schemas", "repomesh.overrides.schema.json");

const REPO_ID_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

// Defense-in-depth caps (SEC-003): bound list sizes so a hostile override file cannot
// blow up memory or hide an unbounded suppression list.
export const MAX_IGNORE_VULNS = 200;
export const MAX_ALLOWLIST_ENTRIES = 500;

let _validate = null;
function getValidator() {
  if (_validate) return _validate;
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  _validate = ajv.compile(schema);
  return _validate;
}

export class OverridesValidationError extends Error {
  constructor(message, repo, errors) {
    super(message);
    this.name = "OverridesValidationError";
    this.code = "REPOMESH_OVERRIDES_INVALID";
    this.repo = repo;
    this.errors = errors || null;
  }
}

function overridesPathFor(repo, baseDir) {
  const [org, repoName] = repo.split("/");
  const base = baseDir || path.join(process.cwd(), "ledger", "nodes");
  return path.join(base, org, repoName, "repomesh.overrides.json");
}

// Load + schema-validate the FULL overrides object for a repo.
// Returns null when the file does not exist (genuinely no override).
// Throws OverridesValidationError on malformed JSON or schema-invalid contents.
// Throws on a malformed repo id (path-traversal guard).
export function loadValidatedOverrides(repo, { baseDir } = {}) {
  if (!REPO_ID_RE.test(repo)) {
    throw new OverridesValidationError(`Invalid repo id "${repo}" (expected org/repo)`, repo);
  }
  const p = overridesPathFor(repo, baseDir);
  if (!fs.existsSync(p)) return null;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new OverridesValidationError(
      `Overrides for ${repo} are not valid JSON (${p}): ${e.message}`,
      repo
    );
  }

  const validate = getValidator();
  if (!validate(raw)) {
    const msg = (validate.errors || [])
      .map(err => `${err.instancePath || "/"} ${err.message}`)
      .join("; ");
    throw new OverridesValidationError(
      `Overrides for ${repo} failed schema validation (${p}): ${msg}`,
      repo,
      validate.errors
    );
  }

  // Enforce caps the schema does not express (SEC-003 size bound).
  if (raw.security?.ignoreVulns && raw.security.ignoreVulns.length > MAX_IGNORE_VULNS) {
    throw new OverridesValidationError(
      `Overrides for ${repo}: security.ignoreVulns exceeds cap of ${MAX_IGNORE_VULNS}`,
      repo
    );
  }
  const allowAdd = raw.license?.allowlistAdd?.length || 0;
  const allowRemove = raw.license?.allowlistRemove?.length || 0;
  if (allowAdd > MAX_ALLOWLIST_ENTRIES || allowRemove > MAX_ALLOWLIST_ENTRIES) {
    throw new OverridesValidationError(
      `Overrides for ${repo}: license allowlist override exceeds cap of ${MAX_ALLOWLIST_ENTRIES}`,
      repo
    );
  }

  return raw;
}
