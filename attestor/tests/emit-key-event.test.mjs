// B-emit — attestor/scripts/emit-key-event.mjs (root-side twin of `repomesh key rotate|revoke`).
// Contract: docs/contracts/key-lifecycle-contract.md §4 (event shapes), §7 (emission), §8 (binding).
//
// This script reuses signEvent from verifiers/lib/common.mjs (contract §7), so we verify the emitted
// signatures the same way the verifier chain does. Written BEFORE the script existed: on the pre-fix
// tree the import below fails (module absent) => every case FAILS. After the fix they PASS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(ROOT, "attestor", "scripts", "emit-key-event.mjs");
function toURL(p) { return pathToFileURL(p).href; }

const emit = await import(toURL(scriptPath));
const { canonicalize } = await import(toURL(path.join(ROOT, "verifiers", "lib", "common.mjs")));

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString().trim(),
  };
}

function verifyEventSig(event, publicPem) {
  const stripped = JSON.parse(JSON.stringify(event));
  delete stripped.signature;
  const hash = crypto.createHash("sha256").update(canonicalize(stripped), "utf8").digest("hex");
  if (hash !== event.signature.canonicalHash) return { ok: false, why: "canonicalHash mismatch" };
  const ok = crypto.verify(null, Buffer.from(hash, "hex"), publicPem, Buffer.from(event.signature.value, "base64"));
  return { ok, why: ok ? null : "ed25519 verify failed" };
}

function setupLedger({ repo = "org/app", maintainers }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rm-emit-att-"));
  const [org, repoName] = repo.split("/");
  const nodeDir = path.join(root, "ledger", "nodes", org, repoName);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, "node.json"), JSON.stringify({
    id: repo, kind: "compute", description: "", provides: [], consumes: [], interfaces: [],
    invariants: {}, maintainers,
  }, null, 2) + "\n");
  fs.mkdirSync(path.join(root, "ledger", "events"), { recursive: true });
  return { root, nodePath: path.join(nodeDir, "node.json"), eventsPath: path.join(root, "ledger", "events", "events.jsonl") };
}
function readNode(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

describe("emitKeyEvent rotate (reuses signEvent — contract §7)", () => {
  it("produces a well-formed signed KeyRotation + node.json validUntil/validFrom edits", () => {
    const retiring = makeKeypair();
    const minted = makeKeypair();
    const { root, nodePath, eventsPath } = setupLedger({
      maintainers: [{ name: "org", keyId: "k1", publicKey: retiring.publicPem, contact: "a@x.com" }],
    });

    const res = emit.emitKeyEvent({
      action: "rotate", repo: "org/app", root,
      retiringKeyId: "k1", newKeyId: "k2", newPublicKey: minted.publicPem,
      effectiveAt: "2026-06-14T12:00:00Z", timestamp: "2026-06-14T12:00:00Z",
      signingKeyId: "k1", signingKey: retiring.privatePem,
    });

    const ev = res.event;
    assert.equal(ev.type, "KeyRotation");
    assert.equal(ev.key.action, "rotate");
    assert.equal(ev.key.retiringKeyId, "k1");
    assert.equal(ev.key.newKeyId, "k2");
    assert.equal(ev.key.effectiveAt, "2026-06-14T12:00:00Z");
    assert.ok(!("version" in ev) && !("artifacts" in ev));
    assert.equal(ev.signature.keyId, "k1");
    assert.deepEqual(verifyEventSig(ev, retiring.publicPem), { ok: true, why: null });

    const node = readNode(nodePath);
    const k1 = node.maintainers.find((m) => m.keyId === "k1");
    const k2 = node.maintainers.find((m) => m.keyId === "k2");
    assert.equal(k1.validUntil, "2026-06-14T12:00:00Z");
    assert.equal(k1.revokedAt, "2026-06-14T12:00:00Z");
    assert.equal(k1.revocationReason, "rotation");
    assert.equal(k2.validFrom, "2026-06-14T12:00:00Z");

    const lines = fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), ev);

    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("emitKeyEvent revoke compromise (contract §4.2, §8)", () => {
  it("sets revokedAt/reason/invalidAfter and signs with a surviving key", () => {
    const compromised = makeKeypair();
    const surviving = makeKeypair();
    const { root, nodePath } = setupLedger({
      maintainers: [
        { name: "org", keyId: "k1", publicKey: compromised.publicPem, contact: "a@x.com" },
        { name: "org", keyId: "k2", publicKey: surviving.publicPem, contact: "b@x.com" },
      ],
    });
    const res = emit.emitKeyEvent({
      action: "revoke", repo: "org/app", root,
      revokedKeyId: "k1", reason: "compromise", invalidAfter: "2026-06-18T00:00:00Z",
      timestamp: "2026-06-20T09:00:00Z", signingKeyId: "k2", signingKey: surviving.privatePem,
    });
    const ev = res.event;
    assert.equal(ev.type, "KeyRevocation");
    assert.equal(ev.key.reason, "compromise");
    assert.equal(ev.key.invalidAfter, "2026-06-18T00:00:00Z");
    assert.deepEqual(verifyEventSig(ev, surviving.publicPem), { ok: true, why: null });

    const k1 = readNode(nodePath).maintainers.find((m) => m.keyId === "k1");
    assert.equal(k1.revokedAt, "2026-06-20T09:00:00Z");
    assert.equal(k1.revocationReason, "compromise");
    assert.equal(k1.invalidAfter, "2026-06-18T00:00:00Z");

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("--dry-run writes nothing", () => {
    const retiring = makeKeypair();
    const minted = makeKeypair();
    const { root, nodePath, eventsPath } = setupLedger({
      maintainers: [{ name: "org", keyId: "k1", publicKey: retiring.publicPem, contact: "a@x.com" }],
    });
    const before = fs.readFileSync(nodePath, "utf8");
    const res = emit.emitKeyEvent({
      action: "rotate", repo: "org/app", root, dryRun: true,
      retiringKeyId: "k1", newKeyId: "k2", newPublicKey: minted.publicPem,
      effectiveAt: "2026-06-14T12:00:00Z", signingKeyId: "k1", signingKey: retiring.privatePem,
    });
    assert.equal(res.dryRun, true);
    assert.equal(res.event.type, "KeyRotation");
    assert.equal(fs.existsSync(eventsPath), false);
    assert.equal(fs.readFileSync(nodePath, "utf8"), before);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("emit-key-event CLI (spawned)", () => {
  it("rotate via CLI appends a signed event + edits node.json", async () => {
    const { execFileSync } = await import("node:child_process");
    const retiring = makeKeypair();
    const minted = makeKeypair();
    const { root, nodePath, eventsPath } = setupLedger({
      maintainers: [{ name: "org", keyId: "k1", publicKey: retiring.publicPem, contact: "a@x.com" }],
    });
    const keyFile = path.join(root, "retiring.priv.pem");
    fs.writeFileSync(keyFile, retiring.privatePem);
    const pubFile = path.join(root, "new.pub.pem");
    fs.writeFileSync(pubFile, minted.publicPem);

    execFileSync("node", [
      scriptPath, "rotate",
      "--repo", "org/app", "--root", root,
      "--retiring-key-id", "k1", "--new-key-id", "k2",
      "--new-public-key-file", pubFile,
      "--effective-at", "2026-06-14T12:00:00Z",
      "--signing-key-id", "k1", "--signing-key-file", keyFile,
    ], { encoding: "utf8" });

    const lines = fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const ev = JSON.parse(lines[0]);
    assert.equal(ev.type, "KeyRotation");
    assert.deepEqual(verifyEventSig(ev, retiring.publicPem), { ok: true, why: null });
    const k2 = readNode(nodePath).maintainers.find((m) => m.keyId === "k2");
    assert.equal(k2.validFrom, "2026-06-14T12:00:00Z");

    fs.rmSync(root, { recursive: true, force: true });
  });
});
