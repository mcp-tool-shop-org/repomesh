// B-emit — `repomesh key rotate` / `repomesh key revoke` emission tests.
// Contract: docs/contracts/key-lifecycle-contract.md §4 (event shapes), §7 (emission), §8 (binding).
//
// Regression target (the bug this swarm closes): a rotation/revocation must produce BOTH a
// well-formed, SIGNED KeyRotation/KeyRevocation event AND the matching node.json window edit, so
// validate-ledger's binding check (§8.5) passes. These tests are written BEFORE the emit module
// existed; on the pre-fix tree the import of ./key/rotate-revoke.mjs fails (module absent) and the
// `key` subcommand does not exist, so every case FAILS. After the fix they PASS.
//
// GRANDFATHER INVARIANT: a maintainer the command does not touch is left byte-identical.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
const cliPath = resolve(srcDir, "cli.mjs");
function toURL(p) { return pathToFileURL(p).href; }

const { canonicalize } = await import(toURL(resolve(srcDir, "verify", "canonicalize.mjs")));
const keyMod = await import(toURL(resolve(srcDir, "key", "rotate-revoke.mjs")));

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString().trim(),
  };
}

// Verify a signed event the same way the verifier chain does: strip signature, canonicalize,
// sha256, ed25519-verify against the public key.
function verifyEventSig(event, publicPem) {
  const stripped = JSON.parse(JSON.stringify(event));
  delete stripped.signature;
  const hash = crypto.createHash("sha256").update(canonicalize(stripped), "utf8").digest("hex");
  if (hash !== event.signature.canonicalHash) return { ok: false, why: "canonicalHash mismatch" };
  const ok = crypto.verify(null, Buffer.from(hash, "hex"), publicPem, Buffer.from(event.signature.value, "base64"));
  return { ok, why: ok ? null : "ed25519 verify failed" };
}

function setupLedger({ repo = "org/app", maintainers }) {
  const root = fs.mkdtempSync(join(os.tmpdir(), "repomesh-emit-"));
  const [org, repoName] = repo.split("/");
  const nodeDir = join(root, "ledger", "nodes", org, repoName);
  fs.mkdirSync(nodeDir, { recursive: true });
  const node = {
    id: repo, kind: "compute", description: "", provides: [], consumes: [], interfaces: [],
    invariants: {}, maintainers,
  };
  fs.writeFileSync(join(nodeDir, "node.json"), JSON.stringify(node, null, 2) + "\n");
  fs.mkdirSync(join(root, "ledger", "events"), { recursive: true });
  return { root, nodePath: join(nodeDir, "node.json"), eventsPath: join(root, "ledger", "events", "events.jsonl") };
}
function readNode(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

describe("key rotate — event + node.json edit (contract §4.1, §8)", () => {
  it("produces a well-formed SIGNED KeyRotation and the correct node.json edits", () => {
    const retiring = makeKeypair();
    const minted = makeKeypair();
    const { root, nodePath, eventsPath } = setupLedger({
      maintainers: [{ name: "org", keyId: "k1", publicKey: retiring.publicPem, contact: "a@x.com" }],
    });

    const res = keyMod.keyCommand({
      action: "rotate", repo: "org/app", root,
      retiringKeyId: "k1", newKeyId: "k2", newPublicKey: minted.publicPem,
      effectiveAt: "2026-06-14T12:00:00Z", timestamp: "2026-06-14T12:00:00Z",
      signingKeyId: "k1", signingKey: retiring.privatePem,
    });

    // --- event shape (contract §4.1) ---
    const ev = res.event;
    assert.equal(ev.type, "KeyRotation");
    assert.equal(ev.repo, "org/app");
    assert.equal(ev.timestamp, "2026-06-14T12:00:00Z");
    assert.equal(ev.key.action, "rotate");
    assert.equal(ev.key.retiringKeyId, "k1");
    assert.equal(ev.key.newKeyId, "k2");
    assert.equal(ev.key.newPublicKey, minted.publicPem);
    assert.equal(ev.key.effectiveAt, "2026-06-14T12:00:00Z");
    // KeyRotation carries NO version/commit/artifacts (the key-family envelope).
    assert.ok(!("version" in ev) && !("commit" in ev) && !("artifacts" in ev));
    // signed by the retiring key; signature verifies against the retiring public key.
    assert.equal(ev.signature.alg, "ed25519");
    assert.equal(ev.signature.keyId, "k1");
    assert.match(ev.signature.canonicalHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(verifyEventSig(ev, retiring.publicPem), { ok: true, why: null });

    // --- node.json edit (contract §4.1 / §8.5 binding) ---
    const node = readNode(nodePath);
    const k1 = node.maintainers.find((m) => m.keyId === "k1");
    const k2 = node.maintainers.find((m) => m.keyId === "k2");
    assert.equal(k1.validUntil, "2026-06-14T12:00:00Z");
    assert.equal(k1.revokedAt, "2026-06-14T12:00:00Z");
    assert.equal(k1.revocationReason, "rotation");
    assert.ok(k2, "new key appended");
    assert.equal(k2.validFrom, "2026-06-14T12:00:00Z");
    assert.equal(k2.publicKey, minted.publicPem);
    // retiring key keeps its original publicKey (past signatures still verify).
    assert.equal(k1.publicKey, retiring.publicPem);

    // --- event was appended to the local ledger ---
    const lines = fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), ev);
    assert.equal(res.wrote.event, true);
    assert.equal(res.wrote.node, true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("--dry-run writes NOTHING (no event line, node.json unchanged)", () => {
    const retiring = makeKeypair();
    const minted = makeKeypair();
    const { root, nodePath, eventsPath } = setupLedger({
      maintainers: [{ name: "org", keyId: "k1", publicKey: retiring.publicPem, contact: "a@x.com" }],
    });
    const before = fs.readFileSync(nodePath, "utf8");

    const res = keyMod.keyCommand({
      action: "rotate", repo: "org/app", root, dryRun: true,
      retiringKeyId: "k1", newKeyId: "k2", newPublicKey: minted.publicPem,
      effectiveAt: "2026-06-14T12:00:00Z", timestamp: "2026-06-14T12:00:00Z",
      signingKeyId: "k1", signingKey: retiring.privatePem,
    });

    assert.equal(res.dryRun, true);
    assert.equal(res.event.type, "KeyRotation");          // still computed + signed
    assert.deepEqual(verifyEventSig(res.event, retiring.publicPem), { ok: true, why: null });
    assert.equal(res.wrote.event, false);
    assert.equal(res.wrote.node, false);
    assert.equal(fs.existsSync(eventsPath), false, "no ledger written on dry-run");
    assert.equal(fs.readFileSync(nodePath, "utf8"), before, "node.json untouched on dry-run");

    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("key revoke — compromise (contract §4.2, §8)", () => {
  it("produces revokedAt + reason + invalidAfter and a verifiable signature by a surviving key", () => {
    const compromised = makeKeypair();
    const surviving = makeKeypair();
    const { root, nodePath } = setupLedger({
      maintainers: [
        { name: "org", keyId: "k1", publicKey: compromised.publicPem, contact: "a@x.com" },
        { name: "org", keyId: "k2", publicKey: surviving.publicPem, contact: "b@x.com" },
      ],
    });

    const res = keyMod.keyCommand({
      action: "revoke", repo: "org/app", root,
      revokedKeyId: "k1", reason: "compromise", invalidAfter: "2026-06-18T00:00:00Z",
      timestamp: "2026-06-20T09:00:00Z",
      signingKeyId: "k2", signingKey: surviving.privatePem,   // SURVIVING same-node key signs
    });

    const ev = res.event;
    assert.equal(ev.type, "KeyRevocation");
    assert.equal(ev.key.action, "revoke");
    assert.equal(ev.key.revokedKeyId, "k1");
    assert.equal(ev.key.reason, "compromise");
    assert.equal(ev.key.invalidAfter, "2026-06-18T00:00:00Z");
    assert.equal(ev.signature.keyId, "k2");
    assert.deepEqual(verifyEventSig(ev, surviving.publicPem), { ok: true, why: null });

    const node = readNode(nodePath);
    const k1 = node.maintainers.find((m) => m.keyId === "k1");
    assert.equal(k1.revokedAt, "2026-06-20T09:00:00Z");
    assert.equal(k1.revocationReason, "compromise");
    assert.equal(k1.invalidAfter, "2026-06-18T00:00:00Z");
    // surviving key untouched (grandfather invariant for the key we did NOT target).
    const k2 = node.maintainers.find((m) => m.keyId === "k2");
    assert.ok(!("revokedAt" in k2) && !("revocationReason" in k2) && !("invalidAfter" in k2));

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("compromise without --invalid-after defaults invalidAfter to the revocation timestamp", () => {
    const compromised = makeKeypair();
    const surviving = makeKeypair();
    const { root, nodePath } = setupLedger({
      maintainers: [
        { name: "org", keyId: "k1", publicKey: compromised.publicPem, contact: "a@x.com" },
        { name: "org", keyId: "k2", publicKey: surviving.publicPem, contact: "b@x.com" },
      ],
    });
    const res = keyMod.keyCommand({
      action: "revoke", repo: "org/app", root,
      revokedKeyId: "k1", reason: "compromise", timestamp: "2026-06-20T09:00:00Z",
      signingKeyId: "k2", signingKey: surviving.privatePem,
    });
    // event omits invalidAfter (not supplied) but node.json defaults it to revokedAt.
    assert.ok(!("invalidAfter" in res.event.key));
    const k1 = readNode(nodePath).maintainers.find((m) => m.keyId === "k1");
    assert.equal(k1.invalidAfter, "2026-06-20T09:00:00Z");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("retirement revoke sets revokedAt + reason but NO invalidAfter", () => {
    const retiring = makeKeypair();
    const surviving = makeKeypair();
    const { root, nodePath } = setupLedger({
      maintainers: [
        { name: "org", keyId: "k1", publicKey: retiring.publicPem, contact: "a@x.com" },
        { name: "org", keyId: "k2", publicKey: surviving.publicPem, contact: "b@x.com" },
      ],
    });
    const res = keyMod.keyCommand({
      action: "revoke", repo: "org/app", root,
      revokedKeyId: "k1", reason: "retirement", timestamp: "2026-06-20T09:00:00Z",
      signingKeyId: "k2", signingKey: surviving.privatePem,
    });
    assert.ok(!("invalidAfter" in res.event.key));
    const k1 = readNode(nodePath).maintainers.find((m) => m.keyId === "k1");
    assert.equal(k1.revokedAt, "2026-06-20T09:00:00Z");
    assert.equal(k1.revocationReason, "retirement");
    assert.ok(!("invalidAfter" in k1), "retirement must NOT set invalidAfter");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("emission guards", () => {
  it("rotate fails when the retiring keyId is absent from node.json", () => {
    const k = makeKeypair();
    const { root } = setupLedger({
      maintainers: [{ name: "org", keyId: "k1", publicKey: k.publicPem, contact: "a@x.com" }],
    });
    assert.throws(() => keyMod.keyCommand({
      action: "rotate", repo: "org/app", root,
      retiringKeyId: "nope", newKeyId: "k2", newPublicKey: k.publicPem,
      effectiveAt: "2026-06-14T12:00:00Z", signingKeyId: "k1", signingKey: k.privatePem,
    }), /not found/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("revoke rejects an invalid reason", () => {
    const k = makeKeypair();
    const { root } = setupLedger({
      maintainers: [
        { name: "org", keyId: "k1", publicKey: k.publicPem, contact: "a@x.com" },
        { name: "org", keyId: "k2", publicKey: makeKeypair().publicPem, contact: "b@x.com" },
      ],
    });
    assert.throws(() => keyMod.keyCommand({
      action: "revoke", repo: "org/app", root,
      revokedKeyId: "k1", reason: "bogus", signingKeyId: "k2", signingKey: k.privatePem,
    }), /Invalid --reason/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects a traversal-y --repo", () => {
    assert.throws(() => keyMod.nodeJsonPath("/tmp/x", "../../etc/passwd"), /Invalid --repo/);
  });
});

describe("CLI --help is accurate", () => {
  it("`key --help` lists rotate and revoke", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("node", [cliPath, "key", "--help"], { encoding: "utf8" });
    assert.ok(out.includes("rotate"), "lists rotate subcommand");
    assert.ok(out.includes("revoke"), "lists revoke subcommand");
    assert.ok(/local/i.test(out), "mentions it is local-only");
  });

  it("`key rotate --help` documents the rotation flags and node.json effect", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("node", [cliPath, "key", "rotate", "--help"], { encoding: "utf8" });
    assert.ok(out.includes("--retiring-key-id"));
    assert.ok(out.includes("--new-key-id"));
    assert.ok(out.includes("--new-public-key"));
    assert.ok(out.includes("--effective-at"));
    assert.ok(out.includes("--signing-key-id"));
    assert.ok(out.includes("--dry-run"));
    assert.ok(/validFrom/.test(out), "documents validFrom on the new key");
  });

  it("`key revoke --help` documents the revocation flags incl. compromise/invalidAfter", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("node", [cliPath, "key", "revoke", "--help"], { encoding: "utf8" });
    assert.ok(out.includes("--revoked-key-id"));
    assert.ok(out.includes("--reason"));
    assert.ok(out.includes("--invalid-after"));
    assert.ok(/compromise/.test(out), "mentions compromise reason");
    assert.ok(out.includes("--dry-run"));
  });

  it("top-level --help lists the `key` command", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("node", [cliPath, "--help"], { encoding: "utf8" });
    assert.ok(/\bkey\b/.test(out), "top-level help lists key");
  });
});

describe("CLI end-to-end (spawned, --json + --dry-run)", () => {
  it("`key rotate --dry-run --json` emits a signed event and writes nothing", async () => {
    const { execFileSync } = await import("node:child_process");
    const retiring = makeKeypair();
    const minted = makeKeypair();
    const { root, nodePath, eventsPath } = setupLedger({
      maintainers: [{ name: "org", keyId: "k1", publicKey: retiring.publicPem, contact: "a@x.com" }],
    });
    const keyFile = join(root, "retiring.priv.pem");
    fs.writeFileSync(keyFile, retiring.privatePem);
    const pubFile = join(root, "new.pub.pem");
    fs.writeFileSync(pubFile, minted.publicPem);
    const before = fs.readFileSync(nodePath, "utf8");

    const out = execFileSync("node", [
      cliPath, "key", "rotate",
      "--repo", "org/app", "--local", root,
      "--retiring-key-id", "k1", "--new-key-id", "k2",
      "--new-public-key-file", pubFile,
      "--effective-at", "2026-06-14T12:00:00Z", "--timestamp", "2026-06-14T12:00:00Z",
      "--signing-key-id", "k1", "--signing-key-file", keyFile,
      "--dry-run", "--json",
    ], { encoding: "utf8" });

    const res = JSON.parse(out);
    assert.equal(res.dryRun, true);
    assert.equal(res.event.type, "KeyRotation");
    assert.deepEqual(verifyEventSig(res.event, retiring.publicPem), { ok: true, why: null });
    assert.equal(fs.existsSync(eventsPath), false);
    assert.equal(fs.readFileSync(nodePath, "utf8"), before);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("`key revoke` (real write) appends the event and edits node.json", async () => {
    const { execFileSync } = await import("node:child_process");
    const compromised = makeKeypair();
    const surviving = makeKeypair();
    const { root, nodePath, eventsPath } = setupLedger({
      maintainers: [
        { name: "org", keyId: "k1", publicKey: compromised.publicPem, contact: "a@x.com" },
        { name: "org", keyId: "k2", publicKey: surviving.publicPem, contact: "b@x.com" },
      ],
    });
    const keyFile = join(root, "surviving.priv.pem");
    fs.writeFileSync(keyFile, surviving.privatePem);

    execFileSync("node", [
      cliPath, "key", "revoke",
      "--repo", "org/app", "--dir", root,
      "--revoked-key-id", "k1", "--reason", "compromise",
      "--invalid-after", "2026-06-18T00:00:00Z", "--timestamp", "2026-06-20T09:00:00Z",
      "--signing-key-id", "k2", "--signing-key-file", keyFile,
    ], { encoding: "utf8" });

    const lines = fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const ev = JSON.parse(lines[0]);
    assert.equal(ev.type, "KeyRevocation");
    assert.deepEqual(verifyEventSig(ev, surviving.publicPem), { ok: true, why: null });
    const k1 = readNode(nodePath).maintainers.find((m) => m.keyId === "k1");
    assert.equal(k1.revokedAt, "2026-06-20T09:00:00Z");
    assert.equal(k1.invalidAfter, "2026-06-18T00:00:00Z");

    fs.rmSync(root, { recursive: true, force: true });
  });
});
