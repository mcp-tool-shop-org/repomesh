// COMPOSED FORGED-WINDOW PROBE — key-lifecycle re-audit (contract §9 / §10).
//
// This is the re-auditor's load-bearing artifact. It is NOT a per-site unit test (those already
// exist: registry-key-window, ledger/key-lifecycle, {tools,cli}/key-window-verify-release,
// verifiers/sec-keywindow-common, attestor/sec-keywindow-sigchain). It is ONE internally-consistent
// forged ReleasePublished pushed through EVERY verification layer at once, proving the closed bug
// stays closed *consistently* across the family of call sites (the v2.0.0 drift seam class).
//
// THE FORGERY (mirrors the existing v2.0.0 forged-ANCHOR probe in tools.test.mjs, adapted to the
// key-window threat): a real, crypto-valid ReleasePublished signed by a key that node.json marks
//   revokedAt = 2026-06-20 , revocationReason = "compromise" , invalidAfter = C (2026-06-18)
// The signature carries a BACKDATED self-`timestamp` (2026-06-01, i.e. claims < C). The attacker
// holds the stolen key, so the signature itself verifies — the ONLY defense is the trusted-time gate:
//   * UNANCHORED  -> self-time is unprovable -> compromise demands a provable time -> REJECT.
//   * ANCHORED-AFTER-C -> provable time >= C -> REJECT.
// CONVERSE (must stay VALID, proving non-destructiveness):
//   * ANCHORED-BEFORE-C -> a signature provably older than the compromise is still trusted.
//   * ROUTINE ROTATION pre-R -> a routine rotation does NOT retroactively invalidate old signatures.
//
// Every assertion below is "the forgery is REJECTED" or "the legitimately-old/rotated sig is VALID",
// run against: build-trust scorer, validate-ledger, tools/verify-release, CLI verify-release,
// verifiers/common.getPublicKeyForKeyId, and the attestor sig-chain. Six layers, one fixture family.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { canonicalizeForHash } from "../../ledger/scripts/canonicalize.mjs";
import { buildTrust } from "../../registry/scripts/build-trust.mjs";
import { getPublicKeyForKeyId } from "../../verifiers/lib/common.mjs";
import {
  isKeyValidForSignature,
  resolveTrustedSignatureTimeSync,
} from "../../verifiers/lib/key-window.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

// --- crypto helpers (canonicalization identical to validate-ledger / build-trust / attestor) ----
function genKeyPair() {
  return crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
function canonicalHash(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.signature;
  return crypto.createHash("sha256").update(canonicalizeForHash(copy), "utf8").digest("hex");
}
// Real Ed25519 signature — the attacker possesses the compromised private key, so this verifies.
function sign(ev, keyId, privateKey) {
  const unsigned = { ...ev };
  delete unsigned.signature;
  const hash = canonicalHash(unsigned);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  return { ...unsigned, signature: { alg: "ed25519", keyId, value: sig.toString("base64"), canonicalHash: hash } };
}

// --- the threat constants -----------------------------------------------------------------------
const RELEASE_REPO = "probe-org/widget";
const ANCHOR_REPO = "probe-org/anchor";          // trusted anchor/attestor node (publishes ledger.anchor)
const KEY_ID = "ci-widget-2026";
const ANCHOR_KEY = "ci-anchor-2026";

const C = "2026-06-18T00:00:00.000Z";            // compromise invalidity date
const BACKDATED_SELF = "2026-06-01T00:00:00.000Z"; // forged self-timestamp (claims < C)
const ROT_R = "2026-06-14T12:00:00.000Z";        // routine-rotation effective time

// node.json maintainer marked compromise-revoked with invalidAfter = C.
const COMPROMISED_MAINTAINER = {
  name: "Widget Maintainer",
  keyId: KEY_ID,
  contact: "sec@widget.example",
  revokedAt: "2026-06-20T09:00:00.000Z",
  revocationReason: "compromise",
  invalidAfter: C,
};
// node.json maintainer routinely rotated out at R (prospective; old sigs trusted).
const ROTATED_MAINTAINER = {
  name: "Widget Maintainer",
  keyId: KEY_ID,
  contact: "ops@widget.example",
  validUntil: ROT_R,
  revokedAt: ROT_R,
  revocationReason: "rotation",
};

// A ReleasePublished signed by KEY_ID with the given self-timestamp.
function forgedRelease(timestamp, privateKey, publicKeyPem, over = {}) {
  return sign(
    {
      type: "ReleasePublished",
      repo: RELEASE_REPO,
      version: "1.0.0",
      commit: "a".repeat(40),
      timestamp,
      artifacts: [{ name: "bundle.js", sha256: "b".repeat(64), uri: "https://example.com/b.js" }],
      attestations: [],
      notes: "",
      ...over,
    },
    KEY_ID,
    privateKey
  );
}

// An anchor AttestationPublished whose lexicographic leaf-range covers `coveredLeaf`, timestamped
// `ts`, signed by the trusted ANCHOR node. This is the build-trust / verify-release leaf-range
// partition format (notes end in a JSON block with `range` = [min,max] of covered leaf hashes).
function leafRangeAnchor(coveredLeaf, ts, anchorKey) {
  const meta = {
    txHash: "DEADBEEF".repeat(8),
    network: "testnet",
    partitionId: "p1",
    merkleRoot: "f".repeat(64),
    eventCount: 1,
    range: [coveredLeaf, coveredLeaf],
  };
  return sign(
    {
      type: "AttestationPublished",
      repo: ANCHOR_REPO,
      version: "1.0.0",
      commit: "c".repeat(40),
      timestamp: ts,
      artifacts: [],
      attestations: [{ type: "ledger.anchor" }],
      notes: `Anchor partition\n${JSON.stringify(meta)}`,
    },
    ANCHOR_KEY,
    anchorKey
  );
}

// --- offline trusted-time ctx (leaf-range partition; same shape build-trust/verify-release build)
function leafRangeCtx(events, trustedAnchorRepos) {
  const trusted = new Set(trustedAnchorRepos);
  const anchors = [];
  for (const ev of events) {
    if (ev.type !== "AttestationPublished") continue;
    if (!(ev.attestations || []).some((a) => a.type === "ledger.anchor")) continue;
    const m = (ev.notes || "").match(/\n(\{.*\})\s*$/s);
    if (!m) continue;
    let meta;
    try { meta = JSON.parse(m[1]); } catch { continue; }
    if (!Array.isArray(meta.range) || meta.range.length !== 2) continue;
    anchors.push({ ev, range: meta.range });
  }
  return {
    findEarliestAnchorForLeaf(leaf) {
      let best = null;
      for (const a of anchors) {
        const [lo, hi] = a.range;
        if (typeof lo !== "string" || typeof hi !== "string") continue;
        if (leaf < lo || leaf > hi) continue;
        if (best === null || new Date(a.ev.timestamp) < new Date(best.ev.timestamp)) best = a;
      }
      return best ? { anchor: best.ev } : null;
    },
    isBundledTrustedAnchor(anchorEvent) {
      return trusted.has(anchorEvent?.repo);
    },
  };
}

// =================================================================================================
// LAYER 0 — the shared predicate itself (the stable secret). If this is wrong, every layer is wrong.
// =================================================================================================
describe("forged-window probe — LAYER predicate (verifiers/lib/key-window)", () => {
  it("UNANCHORED compromised forgery (self-time < C) is REJECTED (unprovable)", () => {
    const tt = { time: new Date(BACKDATED_SELF), provable: false, source: "self" };
    const dec = isKeyValidForSignature(COMPROMISED_MAINTAINER, tt);
    assert.equal(dec.valid, false);
    assert.match(dec.reason, /provable \(anchored\) signature time/);
  });
  it("ANCHORED-AFTER-C forgery is REJECTED (provably post-invalidity)", () => {
    const tt = { time: new Date("2026-06-19T00:00:00.000Z"), provable: true, source: "anchor-event" };
    const dec = isKeyValidForSignature(COMPROMISED_MAINTAINER, tt);
    assert.equal(dec.valid, false);
    assert.match(dec.reason, /compromise invalidity date/);
  });
  it("CONVERSE: ANCHORED-BEFORE-C is VALID (provably-old sig survives the compromise)", () => {
    const tt = { time: new Date("2026-06-17T00:00:00.000Z"), provable: true, source: "anchor-event" };
    const dec = isKeyValidForSignature(COMPROMISED_MAINTAINER, tt);
    assert.equal(dec.valid, true);
  });
  it("CONVERSE: routine ROTATION pre-R is VALID (rotation is not retroactive)", () => {
    const tt = { time: new Date("2026-06-10T00:00:00.000Z"), provable: false, source: "self" };
    const dec = isKeyValidForSignature(ROTATED_MAINTAINER, tt);
    assert.equal(dec.valid, true);
  });
});

// =================================================================================================
// LAYER 1 — build-trust scorer (sites 1/2/11). buildTrust verifies every event's signature + window
// before scoring; a dropped forgery contributes ZERO integrity (the release is unscored, not VALID).
// =================================================================================================
describe("forged-window probe — LAYER build-trust scorer", () => {
  function setup(maintainer, events) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-bt-"));
    const nodesDir = path.join(dir, "nodes");
    const reg = (id, node) => {
      const [org, repo] = id.split("/");
      fs.mkdirSync(path.join(nodesDir, org, repo), { recursive: true });
      fs.writeFileSync(path.join(nodesDir, org, repo, "node.json"), JSON.stringify(node, null, 2));
    };
    reg(RELEASE_REPO, { id: RELEASE_REPO, kind: "tool", maintainers: [maintainer] });
    reg(ANCHOR_REPO, { id: ANCHOR_REPO, kind: "attestor", maintainers: [{ keyId: ANCHOR_KEY, publicKey: anchorPub, contact: "a@x" }] });
    const ledgerPath = path.join(dir, "events.jsonl");
    fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    fs.mkdirSync(path.join(dir, "profiles"), { recursive: true });
    fs.writeFileSync(path.join(dir, "verifier.policy.json"), JSON.stringify({ trustedAttestors: [ANCHOR_REPO], trustedPolicy: [ANCHOR_REPO] }));
    return { dir, nodesDir, ledgerPath };
  }
  let widgetPub, widgetPriv, anchorPub, anchorPriv;
  {
    const w = genKeyPair(); widgetPub = w.publicKey; widgetPriv = w.privateKey;
    const a = genKeyPair(); anchorPub = a.publicKey; anchorPriv = a.privateKey;
  }

  // buildTrust returns an ARRAY of scored release entries; a dropped (window-gated) release never
  // gets an entry. So the crisp invariant is: the forged release is ABSENT from the output entirely.
  function entryFor(out) {
    return (Array.isArray(out) ? out : []).find((e) => e.repo === RELEASE_REPO && e.version === "1.0.0") || null;
  }

  it("UNANCHORED compromised forgery is dropped — ABSENT from the scored trust index", () => {
    const maintainer = { ...COMPROMISED_MAINTAINER, publicKey: widgetPub };
    const release = forgedRelease(BACKDATED_SELF, widgetPriv, widgetPub);
    const { dir, nodesDir, ledgerPath } = setup(maintainer, [release]);
    try {
      const out = buildTrust({ root: dir, nodesDir, ledgerPath, profilesDir: path.join(dir, "profiles"), policyPath: path.join(dir, "verifier.policy.json"), write: false });
      assert.equal(entryFor(out), null, "a compromise-gated forgery must contribute ZERO scored entries");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("CONVERSE: anchored-before-C release IS scored by the same buildTrust path", () => {
    const maintainer = { ...COMPROMISED_MAINTAINER, publicKey: widgetPub };
    const release = forgedRelease("2026-06-15T00:00:00.000Z", widgetPriv, widgetPub);
    const anchor = leafRangeAnchor(release.signature.canonicalHash, "2026-06-17T00:00:00.000Z", anchorPriv);
    const { dir, nodesDir, ledgerPath } = setup(maintainer, [release, anchor]);
    try {
      const out = buildTrust({ root: dir, nodesDir, ledgerPath, profilesDir: path.join(dir, "profiles"), policyPath: path.join(dir, "verifier.policy.json"), write: false });
      const entry = entryFor(out);
      assert.ok(entry, "a provably-pre-compromise release must still be scored (not retroactively killed)");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// =================================================================================================
// LAYER 2 — verifiers/lib/common.getPublicKeyForKeyId (site 9, shared lib). The timed path THROWS
// carrying the window reason; the converse returns the PEM.
// =================================================================================================
describe("forged-window probe — LAYER verifiers/common.getPublicKeyForKeyId", () => {
  const w = genKeyPair();
  const node = (maintainer) => ({ id: RELEASE_REPO, maintainers: [{ ...maintainer, publicKey: w.publicKey }] });

  it("UNANCHORED compromised forgery: THROWS (compromise requires provable time)", () => {
    const release = forgedRelease(BACKDATED_SELF, w.privateKey, w.publicKey);
    const ctx = leafRangeCtx([release], [ANCHOR_REPO]); // no anchor -> self time only
    assert.throws(
      () => getPublicKeyForKeyId(node(COMPROMISED_MAINTAINER), KEY_ID, release, ctx),
      /provable \(anchored\) signature time/
    );
  });
  it("ANCHORED-AFTER-C forgery: THROWS (provably post-invalidity)", () => {
    const a = genKeyPair();
    const release = forgedRelease(BACKDATED_SELF, w.privateKey, w.publicKey);
    const anchor = leafRangeAnchor(release.signature.canonicalHash, "2026-06-19T00:00:00.000Z", a.privateKey);
    const ctx = leafRangeCtx([release, anchor], [ANCHOR_REPO]);
    assert.throws(
      () => getPublicKeyForKeyId(node(COMPROMISED_MAINTAINER), KEY_ID, release, ctx),
      /compromise invalidity date/
    );
  });
  it("CONVERSE: anchored-before-C returns the PEM (not retroactively killed)", () => {
    const a = genKeyPair();
    const release = forgedRelease("2026-06-15T00:00:00.000Z", w.privateKey, w.publicKey);
    const anchor = leafRangeAnchor(release.signature.canonicalHash, "2026-06-17T00:00:00.000Z", a.privateKey);
    const ctx = leafRangeCtx([release, anchor], [ANCHOR_REPO]);
    const pem = getPublicKeyForKeyId(node(COMPROMISED_MAINTAINER), KEY_ID, release, ctx);
    assert.ok(pem.includes("BEGIN PUBLIC KEY"));
  });
  it("CONVERSE: routine-rotation pre-R returns the PEM (self-time trusted)", () => {
    const release = forgedRelease("2026-06-10T00:00:00.000Z", w.privateKey, w.publicKey);
    const ctx = leafRangeCtx([release], [ANCHOR_REPO]); // unanchored -> self time, OK for rotation
    const pem = getPublicKeyForKeyId(node(ROTATED_MAINTAINER), KEY_ID, release, ctx);
    assert.ok(pem.includes("BEGIN PUBLIC KEY"));
  });
});

// =================================================================================================
// LAYER 3 — attestor sig-chain (site 10). computeGatedChecks' signature.chain check must FAIL on the
// forgery (code "key-time-invalid") and PASS on the converse.
// =================================================================================================
describe("forged-window probe — LAYER attestor sig-chain (subprocess)", () => {
  const w = genKeyPair();

  // The attestor reads NODES_DIR / LEDGER_PATH at MODULE LOAD via env, so we must drive it as a
  // subprocess (an in-process import would capture the default repo paths). --dry-run computes the
  // gated checks (incl. signature.chain) without writing. These cases are UNANCHORED, so the
  // attestor's bundled trusted-anchor set is irrelevant (self-time path only).
  function stage(maintainer, events) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-att-"));
    const reg = (id, node) => {
      const [org, repo] = id.split("/");
      fs.mkdirSync(path.join(dir, "nodes", org, repo), { recursive: true });
      fs.writeFileSync(path.join(dir, "nodes", org, repo, "node.json"), JSON.stringify(node, null, 2));
    };
    reg(RELEASE_REPO, { id: RELEASE_REPO, kind: "tool", maintainers: [{ ...maintainer, publicKey: w.publicKey }] });
    const ledger = path.join(dir, "events.jsonl");
    fs.writeFileSync(ledger, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return { dir, ledger };
  }

  function runAttest({ dir, ledger }, repo, version) {
    try {
      const stdout = execFileSync("node", [path.join(REPO_ROOT, "attestor", "scripts", "attest-release.mjs"), "--repo", repo, "--version", version, "--dry-run"], {
        env: { ...process.env, REPOMESH_LEDGER_PATH: ledger, REPOMESH_NODES_PATH: path.join(dir, "nodes") },
        encoding: "utf8",
      });
      return { status: 0, stdout };
    } catch (e) {
      return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
    }
  }

  // Parse the dry-run JSON events for the signature.chain check on the emitted attestation.
  function sigChainResult(stdout) {
    const start = stdout.indexOf("[");
    // dry-run prints each attestation event as pretty JSON; find the signature.chain attestation.
    const m = stdout.match(/"type":\s*"signature\.chain"[\s\S]*?"result":\s*"(pass|fail)"/);
    if (m) return m[1];
    // fall back to the console check line "❌/✅ signature.chain: ..."
    if (/signature\.chain/.test(stdout) && /❌\s*signature\.chain/.test(stdout)) return "fail";
    if (/✅\s*signature\.chain/.test(stdout)) return "pass";
    return null;
  }

  it("UNANCHORED compromised forgery: attestor signature.chain FAILS (key-time-invalid)", () => {
    const release = forgedRelease(BACKDATED_SELF, w.privateKey, w.publicKey);
    const staged = stage(COMPROMISED_MAINTAINER, [release]);
    try {
      const r = runAttest(staged, RELEASE_REPO, "1.0.0");
      const all = `${r.stdout}${r.stderr || ""}`;
      assert.equal(sigChainResult(all), "fail", `forged compromised release must fail attestor sig-chain. Output:\n${all}`);
      assert.match(all, /key-time-invalid|not valid for this signature|provable|compromise/i);
    } finally { fs.rmSync(staged.dir, { recursive: true, force: true }); }
  });

  it("CONVERSE: routine-rotation pre-R passes the attestor sig-chain", () => {
    const release = forgedRelease("2026-06-10T00:00:00.000Z", w.privateKey, w.publicKey);
    const staged = stage(ROTATED_MAINTAINER, [release]);
    try {
      const r = runAttest(staged, RELEASE_REPO, "1.0.0");
      const all = `${r.stdout}${r.stderr || ""}`;
      assert.equal(sigChainResult(all), "pass", `a pre-rotation signature must still verify. Output:\n${all}`);
    } finally { fs.rmSync(staged.dir, { recursive: true, force: true }); }
  });
});

// =================================================================================================
// LAYER 4 — tools/verify-release.mjs (sites 6/7) via SUBPROCESS (the real CLI surface, offline).
// =================================================================================================
describe("forged-window probe — LAYER tools/verify-release (subprocess)", () => {
  const w = genKeyPair();
  const a = genKeyPair();

  function stage(maintainer, events) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-tools-"));
    const reg = (id, node) => {
      const [org, repo] = id.split("/");
      fs.mkdirSync(path.join(dir, "ledger", "nodes", org, repo), { recursive: true });
      fs.writeFileSync(path.join(dir, "ledger", "nodes", org, repo, "node.json"), JSON.stringify(node, null, 2));
    };
    reg(RELEASE_REPO, { id: RELEASE_REPO, kind: "tool", maintainers: [{ ...maintainer, publicKey: w.publicKey }] });
    reg(ANCHOR_REPO, { id: ANCHOR_REPO, kind: "attestor", maintainers: [{ keyId: ANCHOR_KEY, publicKey: a.publicKey, contact: "a@x" }] });
    fs.mkdirSync(path.join(dir, "ledger", "events"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ledger", "events", "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "verifier.policy.json"), JSON.stringify({ trustedAttestors: [ANCHOR_REPO] }));
    return dir;
  }

  function runVerify(dir, args) {
    try {
      const stdout = execFileSync("node", [path.join(REPO_ROOT, "tools", "verify-release.mjs"), ...args], {
        env: {
          ...process.env,
          REPOMESH_LEDGER_PATH: path.join(dir, "ledger", "events", "events.jsonl"),
          REPOMESH_NODES_PATH: path.join(dir, "ledger", "nodes"),
          REPOMESH_ROOT: dir,
          REPOMESH_OFFLINE: "1",
        },
        encoding: "utf8",
      });
      return { status: 0, stdout };
    } catch (e) {
      return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
    }
  }

  it("UNANCHORED compromised forgery: verify FAILS (no usable key for the compromised keyId)", () => {
    const release = forgedRelease(BACKDATED_SELF, w.privateKey, w.publicKey);
    const dir = stage(COMPROMISED_MAINTAINER, [release]);
    try {
      const r = runVerify(dir, ["--repo", RELEASE_REPO, "--version", "1.0.0", "--json"]);
      assert.notEqual(r.status, 0, "forged compromised release must NOT verify (exit != 0)");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("CONVERSE: routine-rotation pre-R verifies (exit 0)", () => {
    const release = forgedRelease("2026-06-10T00:00:00.000Z", w.privateKey, w.publicKey);
    const dir = stage(ROTATED_MAINTAINER, [release]);
    try {
      const r = runVerify(dir, ["--repo", RELEASE_REPO, "--version", "1.0.0", "--json"]);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, true, "a pre-rotation signature must still verify");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// =================================================================================================
// LAYER 5 — packages/repomesh-cli verify-release (site 8) via SUBPROCESS (the published surface).
// =================================================================================================
describe("forged-window probe — LAYER CLI verify-release (subprocess)", () => {
  const w = genKeyPair();
  const a = genKeyPair();
  const CLI = path.join(REPO_ROOT, "packages", "repomesh-cli", "src", "cli.mjs");
  const haveCli = fs.existsSync(CLI);

  function stage(maintainer, events) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-cli-"));
    const reg = (id, node) => {
      const [org, repo] = id.split("/");
      fs.mkdirSync(path.join(dir, "ledger", "nodes", org, repo), { recursive: true });
      fs.writeFileSync(path.join(dir, "ledger", "nodes", org, repo, "node.json"), JSON.stringify(node, null, 2));
    };
    reg(RELEASE_REPO, { id: RELEASE_REPO, kind: "tool", maintainers: [{ ...maintainer, publicKey: w.publicKey }] });
    reg(ANCHOR_REPO, { id: ANCHOR_REPO, kind: "attestor", maintainers: [{ keyId: ANCHOR_KEY, publicKey: a.publicKey, contact: "a@x" }] });
    fs.mkdirSync(path.join(dir, "ledger", "events"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ledger", "events", "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "verifier.policy.json"), JSON.stringify({ trustedAttestors: [ANCHOR_REPO] }));
    return dir;
  }

  function runVerify(dir, args) {
    try {
      const stdout = execFileSync("node", [CLI, "verify-release", ...args], {
        env: { ...process.env, REPOMESH_FORCE_OFFLINE: "1" },
        encoding: "utf8",
        cwd: dir,
      });
      return { status: 0, stdout };
    } catch (e) {
      return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
    }
  }

  it("UNANCHORED compromised forgery: verify FAILS (exit != 0)", { skip: !haveCli ? "CLI bin not found" : false }, () => {
    const release = forgedRelease(BACKDATED_SELF, w.privateKey, w.publicKey);
    const dir = stage(COMPROMISED_MAINTAINER, [release]);
    try {
      const r = runVerify(dir, ["--repo", RELEASE_REPO, "--version", "1.0.0", "--local", "--json"]);
      assert.notEqual(r.status, 0, "forged compromised release must NOT verify");
      const out = JSON.parse(r.stdout);
      assert.equal(out.ok, false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("CONVERSE: routine-rotation pre-R verifies", { skip: !haveCli ? "CLI bin not found" : false }, () => {
    const release = forgedRelease("2026-06-10T00:00:00.000Z", w.privateKey, w.publicKey);
    const dir = stage(ROTATED_MAINTAINER, [release]);
    try {
      const r = runVerify(dir, ["--repo", RELEASE_REPO, "--version", "1.0.0", "--local", "--json"]);
      const out = JSON.parse(r.stdout);
      assert.equal(out.release.signatureValid, true, "a pre-rotation signature must still verify");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// =================================================================================================
// LAYER 6 — validate-ledger.mjs (sites 4/5 + §8) via SUBPROCESS. A node.json that revokes a key with
// NO backing signed event is itself a §8 binding violation, so here we focus on the time gate: a
// compromise-windowed key whose ReleasePublished is unanchored must FAIL validation.
// =================================================================================================
describe("forged-window probe — LAYER validate-ledger (subprocess)", () => {
  const w = genKeyPair();

  function stage(maintainer, events) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-vl-"));
    const reg = (id, node) => {
      const [org, repo] = id.split("/");
      fs.mkdirSync(path.join(dir, "nodes", org, repo), { recursive: true });
      fs.writeFileSync(path.join(dir, "nodes", org, repo, "node.json"), JSON.stringify(node, null, 2));
    };
    // validate-ledger validates node.json against the FULL node.schema (unlike the verify-release
    // scripts), so the manifest must carry every required field + a valid `kind`.
    reg(RELEASE_REPO, {
      id: RELEASE_REPO,
      kind: "compute",
      provides: ["widget.v1"],
      consumes: [],
      interfaces: [{ name: "widget-api", version: "v1", schemaPath: "./schemas/widget.schema.json", stability: "stable" }],
      invariants: { deterministicBuild: false, signedReleases: true, semver: true, changelog: true },
      maintainers: [{ ...maintainer, publicKey: w.publicKey }],
    });
    const head = path.join(dir, "head.jsonl");
    fs.writeFileSync(head, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "verifier.policy.json"), JSON.stringify({ trustedAttestors: [] }));
    // Empty manifests dir so the LDG-001 immutability check (which pins the REAL repo's committed
    // partition manifests by default) does not fire before we reach the key-window gate.
    fs.mkdirSync(path.join(dir, "manifests"), { recursive: true });
    return { dir, head };
  }

  function runValidate({ dir, head }) {
    try {
      const stdout = execFileSync("node", [path.join(REPO_ROOT, "ledger", "scripts", "validate-ledger.mjs")], {
        env: {
          ...process.env,
          HEAD_LEDGER: head,
          BASE_LEDGER: "",
          REPOMESH_NODES_PATH: path.join(dir, "nodes"),
          REPOMESH_VERIFIER_POLICY_PATH: path.join(dir, "verifier.policy.json"),
          REPOMESH_MANIFESTS_PATH: path.join(dir, "manifests"),
        },
        encoding: "utf8",
      });
      return { status: 0, stdout };
    } catch (e) {
      return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
    }
  }

  it("UNANCHORED compromised forgery: validate-ledger FAILS (no usable key at trusted time)", () => {
    const release = forgedRelease(BACKDATED_SELF, w.privateKey, w.publicKey);
    const { dir, head } = stage(COMPROMISED_MAINTAINER, [release]);
    try {
      const r = runValidate({ dir, head });
      assert.notEqual(r.status, 0, "forged compromised release must fail ledger validation");
      assert.match(`${r.stdout}${r.stderr || ""}`, /No usable key|lifecycle window|provable|compromise/i);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("CONVERSE: routine-rotation pre-R passes ledger validation", () => {
    const release = forgedRelease("2026-06-10T00:00:00.000Z", w.privateKey, w.publicKey);
    const { dir, head } = stage(ROTATED_MAINTAINER, [release]);
    try {
      const r = runValidate({ dir, head });
      assert.equal(r.status, 0, `a pre-rotation signature must still validate; got: ${r.stdout}${r.stderr || ""}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// =================================================================================================
// GRANDFATHER — a window-less maintainer + an unanchored release verifies VALID at every layer that
// runs locally (predicate, common, attestor). Proves the fix is non-destructive.
// =================================================================================================
describe("forged-window probe — GRANDFATHER (non-destructive)", () => {
  const w = genKeyPair();
  const GF = { name: "Legacy", keyId: KEY_ID, contact: "legacy@x", publicKey: w.publicKey };

  it("predicate: window-less key is VALID regardless of (even unresolvable) time", () => {
    const dec = isKeyValidForSignature(GF, { time: null, provable: false, source: "none" });
    assert.equal(dec.valid, true);
  });
  it("common: window-less key returns the PEM on the timed path", () => {
    const release = forgedRelease(BACKDATED_SELF, w.privateKey, w.publicKey);
    const ctx = leafRangeCtx([release], [ANCHOR_REPO]);
    const pem = getPublicKeyForKeyId({ id: RELEASE_REPO, maintainers: [GF] }, KEY_ID, release, ctx);
    assert.ok(pem.includes("BEGIN PUBLIC KEY"));
  });
});
