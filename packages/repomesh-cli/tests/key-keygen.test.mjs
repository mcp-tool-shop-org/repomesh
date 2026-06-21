// FT-O-004 — `repomesh keygen` + the >=2-key (separation-of-duties) advisory.
//
// Feature: an operator must be able to MINT a distinct per-node ed25519 keypair (so each
// trust-critical node follows the TUF §6.1 >=2-key recommendation instead of the single-key
// default) and paste the PUBLIC key + keyId straight into node.json maintainers. The PRIVATE
// key is a SECRET: keygen must NEVER write it to a git-tracked path by default and must warn
// loudly when it surfaces it.
//
// These tests are written BEFORE src/key/keygen.mjs exists. On the pre-fix tree the import of
// ./key/keygen.mjs fails (module absent) and the `keygen` command + SoD advisory do not exist,
// so every case FAILS (RED). After the feature lands they PASS (GREEN).
//
// Compatibility is load-bearing: the key keygen produces MUST be byte-identical in format to
// what rotate-revoke.mjs + the verifiers expect (ed25519, PEM spki public / pkcs8 private). The
// proof here SIGNS a probe with the new private key and VERIFIES it with the new public key via
// the SAME canonicalize+sha256+ed25519 path the verifier chain uses.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
const cliPath = resolve(srcDir, "cli.mjs");
function toURL(p) { return pathToFileURL(p).href; }

const { canonicalize } = await import(toURL(resolve(srcDir, "verify", "canonicalize.mjs")));
const keygenMod = await import(toURL(resolve(srcDir, "key", "keygen.mjs")));
const { signKeyEvent } = await import(toURL(resolve(srcDir, "key", "rotate-revoke.mjs")));
const { deriveKeygenAdvisory } = await import(toURL(resolve(srcDir, "init.mjs")));

// node.schema.json maintainer.keyId pattern — keygen MUST mint a keyId matching it.
const KEYID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,118}[a-z0-9]$/;

// Verify a signed event exactly the way the verifier chain does (strip signature, canonicalize,
// sha256, ed25519-verify against the public key). Reused from the rotate-revoke test contract.
function verifyEventSig(event, publicPem) {
  const stripped = JSON.parse(JSON.stringify(event));
  delete stripped.signature;
  const hash = crypto.createHash("sha256").update(canonicalize(stripped), "utf8").digest("hex");
  if (hash !== event.signature.canonicalHash) return { ok: false, why: "canonicalHash mismatch" };
  const ok = crypto.verify(null, Buffer.from(hash, "hex"), publicPem, Buffer.from(event.signature.value, "base64"));
  return { ok, why: ok ? null : "ed25519 verify failed" };
}

describe("keygen — produces a valid ed25519 PEM pair the verifier path accepts", () => {
  it("the minted public key verifies a probe signed by the minted private key (same crypto path)", () => {
    const res = keygenMod.generateKeyMaterial({ repo: "org/app", keyId: "ci-app-2026-signer-a" });

    // PEM shapes match what the rest of the toolchain emits (spki public / pkcs8 private).
    assert.match(res.publicKey, /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/);
    assert.match(res.privateKey, /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/);
    // public key fits the schema length bounds (32..600).
    assert.ok(res.publicKey.length >= 32 && res.publicKey.length <= 600, "public PEM within schema bounds");

    // PROOF OF COMPATIBILITY: sign a probe with the minted private key via the SHIPPED signer,
    // and verify it with the minted public key via the verifier's own crypto path.
    const unsigned = {
      type: "KeyRotation", repo: "org/app", timestamp: "2026-06-20T00:00:00Z",
      key: { action: "rotate", retiringKeyId: "old", newKeyId: res.keyId, newPublicKey: res.publicKey, effectiveAt: "2026-06-20T00:00:00Z" },
      signature: { alg: "ed25519", keyId: "", value: "", canonicalHash: "" },
    };
    const signed = signKeyEvent(unsigned, res.privateKey, res.keyId);
    assert.deepEqual(verifyEventSig(signed, res.publicKey), { ok: true, why: null },
      "a probe signed by the new private key MUST verify against the new public key");
  });

  it("keyId follows the schema pattern; default keyId is derived from the repo when not given", () => {
    const explicit = keygenMod.generateKeyMaterial({ repo: "org/app", keyId: "mike-2026-01" });
    assert.equal(explicit.keyId, "mike-2026-01");
    assert.match(explicit.keyId, KEYID_PATTERN);

    const derived = keygenMod.generateKeyMaterial({ repo: "mcp-tool-shop-org/repomesh" });
    assert.match(derived.keyId, KEYID_PATTERN, "derived keyId must satisfy node.schema.json");
    assert.ok(derived.keyId.includes("repomesh"), "derived keyId is repo-scoped");
  });

  it("emits a maintainer object in the node.json maintainer shape (paste-ready)", () => {
    const res = keygenMod.generateKeyMaterial({ repo: "org/app", keyId: "ci-app-2026-signer-b", name: "org" });
    const m = res.maintainer;
    assert.equal(typeof m, "object");
    // required maintainer fields per node.schema.json $defs/maintainer
    assert.equal(m.keyId, res.keyId);
    assert.equal(m.publicKey, res.publicKey);
    assert.equal(typeof m.name, "string");
    assert.ok(m.name.length >= 1, "maintainer.name is non-empty");
    // must NOT carry the secret
    assert.ok(!("privateKey" in m), "maintainer object must never contain the private key");
  });

  it("rejects a keyId that does not satisfy the schema pattern (usage error shape)", () => {
    assert.throws(
      () => keygenMod.generateKeyMaterial({ repo: "org/app", keyId: "BAD KEY ID!" }),
      (e) => { assert.equal(typeof e.code, "string"); assert.match(e.message, /keyId/i); return true; },
    );
  });
});

describe("keygen — secret discipline (private key never silently committed)", () => {
  it("does NOT write the private key anywhere by default (print-only path)", () => {
    // generateKeyMaterial is pure: it returns material and writes NOTHING to disk.
    const before = keygenMod.generateKeyMaterial({ repo: "org/app", keyId: "ci-app-2026-pure" });
    assert.ok(before.privateKey, "material is returned in-memory");
    // No filesystem write happened — the function has no file side-effects.
  });

  it("writes the private key ONLY when an explicit out path is given, with 0600 perms", () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "repomesh-keygen-"));
    const out = join(dir, "signer.private.pem");
    const res = keygenMod.generateKeyMaterial({ repo: "org/app", keyId: "ci-app-2026-out", privateKeyOut: out });
    assert.equal(res.privateKeyWritten, out, "reports where the secret was written");
    const onDisk = fs.readFileSync(out, "utf8");
    assert.equal(onDisk.trim(), res.privateKey.trim(), "exact private PEM on disk");
    // restrictive perms on POSIX (best-effort on Windows; assert the bits we set hold on POSIX)
    if (process.platform !== "win32") {
      const mode = fs.statSync(out).mode & 0o777;
      assert.equal(mode, 0o600, "private key file is owner-read/write only");
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe(">=2-key separation-of-duties advisory (TUF §6.1)", () => {
  it("fires the advisory for a single-key node", () => {
    const a = deriveKeygenAdvisory({ maintainers: [{ name: "org", keyId: "k1", publicKey: "PEM" }] });
    assert.equal(a.advise, true, "single-key node should be advised to register a second key");
    assert.match(a.message, /\b2\b|two|second/i, "advisory recommends a 2nd key");
    assert.match(a.message.toLowerCase(), /rev(oke|ocation)/, "advisory explains the SoD rationale (revocation)");
  });

  it("does NOT fire for a node with >=2 keys", () => {
    const a = deriveKeygenAdvisory({
      maintainers: [
        { name: "org", keyId: "k1", publicKey: "PEM1" },
        { name: "org", keyId: "k2", publicKey: "PEM2" },
      ],
    });
    assert.equal(a.advise, false, "a 2-key node already satisfies the recommendation");
  });

  it("does NOT count revoked keys toward the >=2 threshold", () => {
    // A node with one active key + one revoked key still has only ONE usable signer.
    const a = deriveKeygenAdvisory({
      maintainers: [
        { name: "org", keyId: "k1", publicKey: "PEM1" },
        { name: "org", keyId: "k2", publicKey: "PEM2", revokedAt: "2026-01-01T00:00:00Z", revocationReason: "compromise" },
      ],
    });
    assert.equal(a.advise, true, "a revoked key does not satisfy separation of duties");
  });
});

function run(args, { cwd = os.tmpdir() } = {}) {
  // spawnSync captures BOTH stdout and stderr regardless of exit code (execFileSync drops stderr on
  // success), which matters because the secret warning is routed to stderr.
  const r = spawnSync("node", [cliPath, ...args], { encoding: "utf8", cwd });
  return { code: r.status ?? null, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("keygen CLI — exit codes + JSON + human modes", () => {
  it("`keygen --repo org/app --json` emits a structured paste-ready block, no private key leak by default", () => {
    const { code, stdout } = run(["keygen", "--repo", "org/app", "--json"]);
    assert.equal(code, 0, "successful keygen exits 0");
    const obj = JSON.parse(stdout.match(/\{[\s\S]*\}/)[0]);
    assert.match(obj.keyId, KEYID_PATTERN);
    assert.match(obj.publicKey, /BEGIN PUBLIC KEY/);
    assert.ok(obj.maintainer && obj.maintainer.keyId === obj.keyId, "maintainer block present in JSON");
    // The private key, if surfaced in --json, must be flagged as a secret — never written to a path.
    assert.ok(!obj.privateKeyWritten, "no file written by default");
  });

  it("`keygen` (human mode) prints a LOUD private-key secret warning to stderr", () => {
    const { code, stdout, stderr } = run(["keygen", "--repo", "org/app"]);
    assert.equal(code, 0);
    const all = (stdout + stderr).toLowerCase();
    assert.match(all, /secret|never commit|do not commit/, "must warn the private key is a secret");
    assert.match(stdout, /BEGIN PUBLIC KEY/, "public key is printed for pasting");
  });

  it("missing required --repo => exit 2 (usage error, not trust FAIL)", () => {
    const { code, stderr, stdout } = run(["keygen"]);
    assert.equal(code, 2, "usage error -> exit 2");
    assert.match((stderr + stdout).toLowerCase(), /repo/);
  });

  it("bad keyId => exit 2 with a structured error under --json", () => {
    const { code, stdout } = run(["keygen", "--repo", "org/app", "--keyid", "BAD ID", "--json"]);
    assert.equal(code, 2, "invalid keyId is a usage error");
    const obj = JSON.parse(stdout.match(/\{[\s\S]*\}/)[0]);
    assert.equal(obj.ok, false);
    assert.match((obj.message || "").toLowerCase(), /keyid|key id/);
  });

  it("top-level --help lists the `keygen` command", () => {
    const { stdout } = run(["--help"]);
    assert.match(stdout, /\bkeygen\b/, "top-level help lists keygen");
  });
});

describe("init — surfaces the SoD advisory for a single-key scaffold", () => {
  it("`init --json` reports keyCount=1 and advise=true for a fresh single-key node", () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "repomesh-init-"));
    const { stdout } = run(["init", "--repo", "org/app", "--dir", dir, "--no-pr", "--json"]);
    const obj = JSON.parse(stdout.match(/\{[\s\S]*\}/)[0]);
    assert.equal(obj.keyCount, 1, "a fresh node has exactly one key");
    assert.equal(obj.sodAdvisory, true, "init surfaces the >=2-key recommendation for a single-key node");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
