// SEC-005 — sbom.present / provenance.present must NOT award pass when the release's
// signature.chain does not verify. Presence is read from the release event's own attestation list,
// which is only trustworthy if the event signature verifies.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Set the nodes path BEFORE importing the attestor (NODES_DIR is read at module load).
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-sec005-"));
const NODES = path.join(baseDir, "nodes");
process.env.REPOMESH_NODES_PATH = NODES;

let computeGatedChecks;

const REPO = "test-org/widget";

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}

function makeSignedRelease({ privateKey, publicKeyPem, keyId, tamper = false }) {
  const [org, repoName] = REPO.split("/");
  fs.mkdirSync(path.join(NODES, org, repoName), { recursive: true });
  fs.writeFileSync(
    path.join(NODES, org, repoName, "node.json"),
    JSON.stringify({
      id: REPO,
      maintainers: [{ name: "Test Dev", keyId, publicKey: publicKeyPem }],
    }),
    "utf8"
  );

  const ev = {
    type: "ReleasePublished",
    repo: REPO,
    version: "1.0.0",
    commit: "a".repeat(40),
    timestamp: "2026-01-01T00:00:00.000Z",
    artifacts: [{ name: "x.tgz", sha256: "b".repeat(64), uri: "https://example.com/x.tgz" }],
    attestations: [
      { type: "sbom", uri: "https://example.com/sbom.json" },
      { type: "provenance", uri: "https://example.com/prov.json" },
    ],
    signature: { alg: "ed25519", keyId, value: "", canonicalHash: "" },
  };
  const stripped = JSON.parse(JSON.stringify(ev));
  delete stripped.signature;
  const hash = crypto.createHash("sha256").update(JSON.stringify(canonicalize(stripped)), "utf8").digest("hex");
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  ev.signature.value = tamper ? Buffer.from("x".repeat(64)).toString("base64") : sig.toString("base64");
  ev.signature.canonicalHash = hash;
  return ev;
}

describe("SEC-005 presence checks gated on signature.chain", () => {
  let keyPair;
  before(async () => {
    keyPair = crypto.generateKeyPairSync("ed25519");
    ({ computeGatedChecks } = await import("../scripts/attest-release.mjs"));
  });

  it("a VALID release signature -> sbom.present + provenance.present pass", () => {
    const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const ev = makeSignedRelease({ privateKey: keyPair.privateKey, publicKeyPem, keyId: "ci-test-2026" });
    const checks = computeGatedChecks(ev);
    const byKind = Object.fromEntries(checks.map(c => [c.kind, c.result]));
    assert.equal(byKind["signature.chain"], "pass", "valid signature must verify");
    assert.equal(byKind["sbom.present"], "pass");
    assert.equal(byKind["provenance.present"], "pass");
  });

  it("an INVALID release signature -> presence checks WITHHELD (not pass)", () => {
    const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const ev = makeSignedRelease({ privateKey: keyPair.privateKey, publicKeyPem, keyId: "ci-test-2026", tamper: true });
    const checks = computeGatedChecks(ev);
    const byKind = Object.fromEntries(checks.map(c => [c.kind, c.result]));
    assert.notEqual(byKind["signature.chain"], "pass", "tampered signature must NOT verify");
    assert.notEqual(byKind["sbom.present"], "pass", "presence must be withheld when signature fails (SEC-005)");
    assert.notEqual(byKind["provenance.present"], "pass", "presence must be withheld when signature fails (SEC-005)");
  });
});
