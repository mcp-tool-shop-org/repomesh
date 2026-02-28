// doctor — Diagnose a local repo's RepoMesh integration.
// Validates node.json, profile, overrides, workflow against schemas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

function loadSchema(name) {
  const p = path.join(PKG_ROOT, "schemas", name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export async function doctor({ dir, repo, json }) {
  const target = dir || ".";
  const checks = [];

  function check(name, fn) {
    try {
      const result = fn();
      checks.push({ name, ...result });
    } catch (e) {
      checks.push({ name, ok: false, message: e.message });
    }
  }

  // 1. node.json
  check("node.json", () => {
    const p = path.join(target, "node.json");
    if (!fs.existsSync(p)) return { ok: false, message: "File not found" };
    const node = JSON.parse(fs.readFileSync(p, "utf8"));

    const schema = loadSchema("node.schema.json");
    if (schema) {
      const ajv = new Ajv2020({ allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      if (!validate(node)) {
        return { ok: false, message: `Schema errors: ${validate.errors.map(e => `${e.instancePath} ${e.message}`).join("; ")}` };
      }
    }

    if (repo && node.id !== repo) {
      return { ok: false, message: `node.id="${node.id}" does not match --repo "${repo}"` };
    }

    const hasMaintainers = (node.maintainers || []).length > 0;
    const hasPublicKey = (node.maintainers || []).some(m => m.publicKey);
    return {
      ok: true,
      message: `id=${node.id}, kind=${node.kind}, maintainers=${(node.maintainers || []).length}`,
      warnings: !hasPublicKey ? ["No maintainer has a public key"] : [],
    };
  });

  // 2. repomesh.profile.json
  check("repomesh.profile.json", () => {
    const p = path.join(target, "repomesh.profile.json");
    if (!fs.existsSync(p)) return { ok: false, message: "File not found" };
    const profile = JSON.parse(fs.readFileSync(p, "utf8"));

    const schema = loadSchema("repomesh.profile.schema.json");
    if (schema) {
      const ajv = new Ajv2020({ allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      if (!validate(profile)) {
        return { ok: false, message: `Schema errors: ${validate.errors.map(e => `${e.instancePath} ${e.message}`).join("; ")}` };
      }
    }

    return { ok: true, message: `profile=${profile.profileId}, version=${profile.profileVersion}` };
  });

  // 3. repomesh.overrides.json
  check("repomesh.overrides.json", () => {
    const p = path.join(target, "repomesh.overrides.json");
    if (!fs.existsSync(p)) return { ok: true, message: "Not present (optional)" };
    const overrides = JSON.parse(fs.readFileSync(p, "utf8"));

    const schema = loadSchema("repomesh.overrides.schema.json");
    if (schema) {
      const ajv = new Ajv2020({ allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      if (!validate(overrides)) {
        return { ok: false, message: `Schema errors: ${validate.errors.map(e => `${e.instancePath} ${e.message}`).join("; ")}` };
      }
    }

    return { ok: true, message: `${Object.keys(overrides).length} override(s)` };
  });

  // 4. Broadcast workflow
  check("repomesh-broadcast.yml", () => {
    const p = path.join(target, ".github", "workflows", "repomesh-broadcast.yml");
    if (!fs.existsSync(p)) return { ok: false, message: "Workflow file not found" };
    const content = fs.readFileSync(p, "utf8");
    const hasKeyId = content.includes("REPOMESH_KEY_ID");
    const hasLedgerRepo = content.includes("REPOMESH_LEDGER_REPO");
    const warnings = [];
    if (!hasKeyId) warnings.push("Missing REPOMESH_KEY_ID env");
    if (!hasLedgerRepo) warnings.push("Missing REPOMESH_LEDGER_REPO env");
    return { ok: true, message: "Workflow present", warnings };
  });

  // 5. .gitignore has repomesh-keys/
  check(".gitignore (repomesh-keys/)", () => {
    const p = path.join(target, ".gitignore");
    if (!fs.existsSync(p)) return { ok: false, message: ".gitignore not found" };
    const content = fs.readFileSync(p, "utf8");
    if (!content.includes("repomesh-keys")) {
      return { ok: false, message: "repomesh-keys/ not in .gitignore — private keys may be committed!" };
    }
    return { ok: true, message: "repomesh-keys/ excluded" };
  });

  // Output
  const allOk = checks.every(c => c.ok);

  if (json) {
    console.log(JSON.stringify({ ok: allOk, checks }, null, 2));
  } else {
    console.log(`\nRepoMesh Doctor — ${path.resolve(target)}\n`);
    for (const c of checks) {
      const icon = c.ok ? "\u2705" : "\u274C";
      console.log(`  ${icon} ${c.name}: ${c.message}`);
      if (c.warnings?.length) {
        for (const w of c.warnings) console.log(`     \u26A0\uFE0F  ${w}`);
      }
    }
    console.log(`\n  ${allOk ? "All checks passed." : "Some checks failed."}\n`);
  }

  if (!allOk) process.exit(1);
}
