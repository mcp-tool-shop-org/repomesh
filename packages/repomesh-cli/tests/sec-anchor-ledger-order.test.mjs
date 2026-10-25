// CLI anchor signers and ledger order (#153).
//
// Verifies that the published CLI (packages/repomesh-cli/src/verify/verify-release.mjs)
// decides anchor trust with the shared isBundledTrustedAnchorEvent rule in both --local
// and remote (default) modes, failing closed when events or nodes needed to place and
// judge the anchor cannot be loaded, and agreeing with VL, LVR, and AR across all cases.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "..", "..");
const VALIDATOR = path.join(REPO_ROOT, "ledger", "scripts", "validate-ledger.mjs");

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-cli-anchor-order-"));
const NODES = path.join(baseDir, "nodes");
const EMPTY_CWD = path.join(baseDir, "empty-cwd");
fs.mkdirSync(EMPTY_CWD, { recursive: true });
process.env.REPOMESH_NODES_PATH = NODES;

const REL_REPO = "test-org/widget";
const ANCHOR_REPO = "mcp-tool-shop-org/repomesh-xrpl-anchor";
const ROT = "2026-08-01T00:00:00.000Z";
const MANIFEST_REL_PATH = "anchor/xrpl/manifests/p-order.json";

const LEDGER_URL = "https://fixture.repomesh.test/ledger/events/events.jsonl";
const NODES_URL = "https://fixture.repomesh.test/ledger/nodes";
const MANIFESTS_URL = "https://fixture.repomesh.test/anchor/xrpl/manifests";

let buildAttestorTimeCtx;
let checkSignatureChain;
let isKeyValidForSignature;
let computeVerifyResult;

function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonicalize(v[k]);
    return o;
  }
  return v;
}

function sign(ev, privateKey) {
  const s = JSON.parse(JSON.stringify(ev));
  delete s.signature;
  const h = crypto.createHash("sha256").update(JSON.stringify(canonicalize(s)), "utf8").digest("hex");
  ev.signature.canonicalHash = h;
  ev.signature.value = crypto.sign(null, Buffer.from(h, "hex"), privateKey).toString("base64");
  return ev;
}

const pemOf = (k) => k.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
const relKp = crypto.generateKeyPairSync("ed25519");
const oldKp = crypto.generateKeyPairSync("ed25519");
const newKp = crypto.generateKeyPairSync("ed25519");

function buildAnchorManifest(leaf) {
  const base = {
    v: 1,
    algo: "sha256-merkle-v1",
    partitionId: "p-order",
    network: "testnet",
    prev: null,
    range: [leaf, leaf],
    count: 1,
    root: leaf,
  };
  const manifestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(base)), "utf8")
    .digest("hex");
  return { ...base, manifestHash };
}

function release() {
  return sign({
    type: "ReleasePublished", repo: REL_REPO, version: "1.0.0", commit: "a".repeat(40),
    timestamp: "2026-07-10T00:00:00.000Z",
    artifacts: [{ name: "x.tgz", sha256: "b".repeat(64), uri: "https://example.com/x.tgz" }],
    attestations: [{ type: "sbom", uri: "https://example.com/sbom.json" }],
    signature: { alg: "ed25519", keyId: "compromised-key", value: "", canonicalHash: "" },
  }, relKp.privateKey);
}

function anchor(leaf, repoOverride = ANCHOR_REPO) {
  const m = buildAnchorManifest(leaf);
  const meta = {
    txHash: "TX-ORDER", network: "testnet", partitionId: "p-order",
    partitionStart: "2026-05-01T00:00:00.000Z", partitionEnd: "2026-10-01T00:00:00.000Z",
    range: [leaf, leaf], merkleRoot: leaf,
    manifestPath: MANIFEST_REL_PATH, manifestHash: m.manifestHash,
  };
  return sign({
    type: "AttestationPublished", repo: repoOverride, version: "0.0.0-anchor", commit: "c".repeat(40),
    timestamp: "2026-07-15T00:00:00.000Z",
    artifacts: [{ name: "anchor.json", sha256: m.manifestHash, uri: "https://example.com/anchor.json" }],
    attestations: [{ type: "ledger.anchor", uri: "xrpl:tx:TX-ORDER" }],
    notes: `ledger.anchor: pass\n${JSON.stringify(meta)}`,
    signature: { alg: "ed25519", keyId: "anchor-old", value: "", canonicalHash: "" },
  }, oldKp.privateKey);
}

function keyRotation() {
  return sign({
    type: "KeyRotation", repo: ANCHOR_REPO, timestamp: "2026-07-31T23:00:00.000Z",
    key: { action: "rotate", retiringKeyId: "anchor-old", newKeyId: "anchor-new", newPublicKey: pemOf(newKp), effectiveAt: ROT },
    signature: { alg: "ed25519", keyId: "anchor-old", value: "", canonicalHash: "" },
  }, oldKp.privateKey);
}

function keyRevocation() {
  return sign({
    type: "KeyRevocation", repo: ANCHOR_REPO, timestamp: "2026-06-20T00:00:00.000Z",
    key: { action: "revoke", revokedKeyId: "anchor-old", reason: "compromise", invalidAfter: "2026-06-16T00:00:00.000Z" },
    signature: { alg: "ed25519", keyId: "anchor-new", value: "", canonicalHash: "" },
  }, newKp.privateKey);
}

const OLD = { name: "Old", keyId: "anchor-old", publicKey: pemOf(oldKp), contact: "o@example.com" };
const NEW = { name: "New", keyId: "anchor-new", publicKey: pemOf(newKp), contact: "n@example.com" };
const ROTATED = [{ ...OLD, validUntil: ROT, revokedAt: ROT, revocationReason: "rotation" }, { ...NEW, validFrom: ROT }];
const NO_REASON_REVOKED = [{ ...OLD, revokedAt: ROT }, { ...NEW, validFrom: ROT }];

function nodeManifest(id, kind, maintainers) {
  return {
    id, kind, description: `${kind} node`, provides: [`${kind}.test.v1`], consumes: [],
    interfaces: [{ name: "iface", version: "v1", schemaPath: "./schemas/event.schema.json" }],
    invariants: { deterministicBuild: false, signedReleases: false, semver: true, changelog: true },
    maintainers, tags: ["test"],
  };
}

function writeNodes(anchorMaintainers, extraNodes = []) {
  fs.rmSync(NODES, { recursive: true, force: true });
  fs.cpSync(path.join(REPO_ROOT, "ledger", "nodes"), NODES, { recursive: true });
  const write = (n) => {
    const [o, r] = n.id.split("/");
    fs.mkdirSync(path.join(NODES, o, r), { recursive: true });
    fs.writeFileSync(path.join(NODES, o, r, "node.json"), JSON.stringify(n, null, 2), "utf8");
  };
  write(nodeManifest(ANCHOR_REPO, "attestor", anchorMaintainers));
  write(nodeManifest(REL_REPO, "compute", [{
    name: "Dev", keyId: "compromised-key", publicKey: pemOf(relKp), contact: "d@example.com",
    revokedAt: "2026-09-02T00:00:00.000Z", revocationReason: "compromise", invalidAfter: "2026-09-01T00:00:00.000Z",
  }]));
  for (const n of extraNodes) write(n);
}

const jsonl = (evs) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";

const hasAnchorEvent = (evs) =>
  evs.some((e) => e?.type === "AttestationPublished" && (e.attestations || []).some((a) => a.type === "ledger.anchor"));

async function runCliLocal({ anchorMaintainers, head, rel }) {
  writeNodes(anchorMaintainers);
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "rm-cli-local-"));
  const prevOffline = process.env.REPOMESH_FORCE_OFFLINE;
  process.env.REPOMESH_FORCE_OFFLINE = "1";
  try {
    fs.mkdirSync(path.join(checkout, "ledger", "events"), { recursive: true });
    fs.cpSync(NODES, path.join(checkout, "ledger", "nodes"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "verifier.policy.json"), path.join(checkout, "verifier.policy.json"));
    fs.writeFileSync(path.join(checkout, "ledger", "events", "events.jsonl"), jsonl(head), "utf8");
    if (hasAnchorEvent(head)) {
      const mPath = path.join(checkout, MANIFEST_REL_PATH);
      fs.mkdirSync(path.dirname(mPath), { recursive: true });
      fs.writeFileSync(mPath, JSON.stringify(buildAnchorManifest(rel.signature.canonicalHash), null, 2), "utf8");
    }
    const { result, status } = await computeVerifyResult({
      repo: REL_REPO,
      version: "1.0.0",
      anchored: true,
      anchoredOrLocal: true,
      local: true,
      localDir: checkout,
      human: false,
    });
    return { ok: result.ok === true && result.release?.signatureValid === true, result, status };
  } finally {
    if (prevOffline === undefined) delete process.env.REPOMESH_FORCE_OFFLINE;
    else process.env.REPOMESH_FORCE_OFFLINE = prevOffline;
    fs.rmSync(checkout, { recursive: true, force: true });
  }
}

async function runCliRemote({ anchorMaintainers, head, rel, blockedNodes = new Set(), failEventsFetch = false }) {
  writeNodes(anchorMaintainers);
  const origFetch = globalThis.fetch;
  const origCwd = process.cwd;
  const prevOffline = process.env.REPOMESH_FORCE_OFFLINE;
  process.env.REPOMESH_FORCE_OFFLINE = "1";
  process.cwd = () => EMPTY_CWD;

  const manifestJson = JSON.stringify(buildAnchorManifest(rel.signature.canonicalHash));
  const eventsText = jsonl(head);

  globalThis.fetch = async (url) => {
    const u = String(url);
    const headers = new Headers({ "content-type": "application/json" });
    const notFound = () => {
      throw Object.assign(new Error(`HTTP 404: Not Found (${u})`), { nonRetryable: true });
    };
    if (u === LEDGER_URL) {
      if (failEventsFetch) notFound();
      return { ok: true, status: 200, statusText: "OK", headers, text: async () => eventsText };
    }
    if (u === `${MANIFESTS_URL}/p-order.json`) {
      if (!hasAnchorEvent(head)) notFound();
      return { ok: true, status: 200, statusText: "OK", headers, text: async () => manifestJson };
    }
    if (u.startsWith(`${NODES_URL}/`) && u.endsWith("/node.json")) {
      const repoId = u.slice(`${NODES_URL}/`.length, -"/node.json".length);
      if (blockedNodes.has(repoId)) notFound();
      const [o, r] = repoId.split("/");
      const p = path.join(NODES, o, r, "node.json");
      if (!fs.existsSync(p)) notFound();
      const body = fs.readFileSync(p, "utf8");
      return { ok: true, status: 200, statusText: "OK", headers, text: async () => body };
    }
    notFound();
  };

  try {
    const { result, status } = await computeVerifyResult({
      repo: REL_REPO,
      version: "1.0.0",
      anchored: true,
      anchoredOrLocal: true,
      local: false,
      ledgerUrl: LEDGER_URL,
      nodesUrl: NODES_URL,
      manifestsUrl: MANIFESTS_URL,
      human: false,
    });
    return { ok: result.ok === true && result.release?.signatureValid === true, result, status };
  } finally {
    globalThis.fetch = origFetch;
    process.cwd = origCwd;
    if (prevOffline === undefined) delete process.env.REPOMESH_FORCE_OFFLINE;
    else process.env.REPOMESH_FORCE_OFFLINE = prevOffline;
  }
}

async function onAllFourPaths({ anchorMaintainers, base = [], head, rel }) {
  writeNodes(anchorMaintainers);
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), "rm-anchor-4path-"));
  try {
    const manifests = path.join(sb, "manifests");
    fs.mkdirSync(manifests);
    if (hasAnchorEvent(head)) {
      fs.writeFileSync(
        path.join(manifests, "p-order.json"),
        JSON.stringify(buildAnchorManifest(rel.signature.canonicalHash), null, 2),
        "utf8"
      );
    }
    fs.writeFileSync(path.join(sb, "base.jsonl"), base.length ? jsonl(base) : "", "utf8");
    fs.writeFileSync(path.join(sb, "head.jsonl"), jsonl(head), "utf8");
    const vlEnv = {
      ...process.env,
      BASE_LEDGER: path.join(sb, "base.jsonl"),
      HEAD_LEDGER: path.join(sb, "head.jsonl"),
      REPOMESH_NODES_PATH: NODES,
      REPOMESH_MANIFESTS_PATH: manifests,
    };
    delete vlEnv.NODE_V8_COVERAGE;
    const vl = spawnSync(process.execPath, [VALIDATOR], {
      encoding: "utf8",
      env: vlEnv,
    }).status === 0;

    const vr = path.join(sb, "vr");
    for (const d of ["ledger/scripts", "ledger/events", "verifiers/lib"]) {
      fs.mkdirSync(path.join(vr, d), { recursive: true });
    }
    fs.cpSync(NODES, path.join(vr, "ledger", "nodes"), { recursive: true });
    for (const f of ["ledger/scripts/verify-release.mjs", "ledger/scripts/canonicalize.mjs", "verifiers/lib/key-window.mjs", "verifier.policy.json"]) {
      fs.copyFileSync(path.join(REPO_ROOT, f), path.join(vr, f));
    }
    fs.writeFileSync(path.join(vr, "ledger/events/events.jsonl"), jsonl(head), "utf8");
    const lvrEnv = { ...process.env, REPOMESH_VERIFIER_POLICY_PATH: path.join(vr, "verifier.policy.json") };
    delete lvrEnv.NODE_V8_COVERAGE;
    const lvr = spawnSync(process.execPath, [path.join(vr, "ledger/scripts/verify-release.mjs"), "--repo", REL_REPO, "--version", "1.0.0"], {
      encoding: "utf8",
      env: lvrEnv,
    }).status === 0;

    const ar = checkSignatureChain(rel, buildAttestorTimeCtx(head)).result === "pass";
    const cliLocal = (await runCliLocal({ anchorMaintainers, head, rel })).ok;
    const cliRemote = (await runCliRemote({ anchorMaintainers, head, rel })).ok;
    return { vl, lvr, ar, cliLocal, cliRemote };
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
}

describe("CLI anchor signers and ledger order", () => {
  before(async () => {
    ({ buildAttestorTimeCtx, checkSignatureChain } = await import(
      pathToFileURL(path.join(REPO_ROOT, "attestor", "scripts", "attest-release.mjs")).href
    ));
    ({ isKeyValidForSignature } = await import(
      pathToFileURL(path.join(PKG_ROOT, "src", "verify", "key-window.mjs")).href
    ));
    ({ computeVerifyResult } = await import(
      pathToFileURL(path.join(PKG_ROOT, "src", "verify", "verify-release.mjs")).href
    ));
  });

  after(() => fs.rmSync(baseDir, { recursive: true, force: true }));

  describe("CLI --local mode: anchor signers honour ledger order", () => {
  it("case 1 (control): with no anchor, the compromised release key fails", async () => {
    const rel = release();
    const r = await runCliLocal({ anchorMaintainers: ROTATED, head: [keyRotation(), rel], rel });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("case 2: a rotated-out anchor key's new anchor, appended after its KeyRotation event and dated before it, is refused", async () => {
    const rel = release();
    const r = await runCliLocal({
      anchorMaintainers: ROTATED,
      head: [keyRotation(), rel, anchor(rel.signature.canonicalHash)],
      rel,
    });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("case 3: an anchor by the same key that sits before its KeyRotation event in the ledger still counts", async () => {
    const rel = release();
    const r = await runCliLocal({
      anchorMaintainers: ROTATED,
      head: [rel, anchor(rel.signature.canonicalHash), keyRotation()],
      rel,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.release?.signatureValid, true);
  });

  it("case 4: a rotation recorded only in node.json gives no ordering evidence, so the anchor is refused", async () => {
    const rel = release();
    const r = await runCliLocal({
      anchorMaintainers: ROTATED,
      head: [rel, anchor(rel.signature.canonicalHash)],
      rel,
    });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("case 5: a compromise KeyRevocation in the ledger refuses the anchor key even when node.json omits it", async () => {
    const rel = release();
    const rev = keyRevocation();
    const r = await runCliLocal({
      anchorMaintainers: [OLD, NEW],
      head: [rev, rel, anchor(rel.signature.canonicalHash)],
      rel,
    });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("case 6: a revocation boundary with no reason is a compromise for every signer, including the anchor signer", async () => {
    const rel = release();
    const r = await runCliLocal({
      anchorMaintainers: NO_REASON_REVOKED,
      head: [rel, anchor(rel.signature.canonicalHash)],
      rel,
    });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);

    const self = { time: new Date("2026-06-10T00:00:00.000Z"), provable: false, source: "self" };
    const late = { time: new Date("2026-07-15T00:00:00.000Z"), provable: false, source: "self" };
    assert.equal(isKeyValidForSignature({ ...OLD, revokedAt: "2026-06-16T00:00:00.000Z" }, self).valid, false);
    assert.equal(isKeyValidForSignature({ ...OLD, invalidAfter: "2026-06-16T00:00:00.000Z" }, late).valid, false);
    assert.equal(isKeyValidForSignature({ ...OLD, revocationReason: "compromise", invalidAfter: "2026-06-16T00:00:00.000Z" }, late).valid, false);
  });
});

describe("CLI remote mode (default, stubbed fetch, no network): anchor signers honour ledger order", () => {
  it("case 1 (control): with no anchor, the compromised release key fails", async () => {
    const rel = release();
    const r = await runCliRemote({ anchorMaintainers: ROTATED, head: [keyRotation(), rel], rel });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("case 2: a rotated-out anchor key's new anchor, appended after its KeyRotation event and dated before it, is refused", async () => {
    const rel = release();
    const r = await runCliRemote({
      anchorMaintainers: ROTATED,
      head: [keyRotation(), rel, anchor(rel.signature.canonicalHash)],
      rel,
    });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("case 3: an anchor by the same key that sits before its KeyRotation event in the ledger still counts", async () => {
    const rel = release();
    const r = await runCliRemote({
      anchorMaintainers: ROTATED,
      head: [rel, anchor(rel.signature.canonicalHash), keyRotation()],
      rel,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.release?.signatureValid, true);
  });

  it("case 4: a rotation recorded only in node.json gives no ordering evidence, so the anchor is refused", async () => {
    const rel = release();
    const r = await runCliRemote({
      anchorMaintainers: ROTATED,
      head: [rel, anchor(rel.signature.canonicalHash)],
      rel,
    });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("case 5: a compromise KeyRevocation in the ledger refuses the anchor key even when node.json omits it", async () => {
    const rel = release();
    const rev = keyRevocation();
    const r = await runCliRemote({
      anchorMaintainers: [OLD, NEW],
      head: [rev, rel, anchor(rel.signature.canonicalHash)],
      rel,
    });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("case 6: a revocation boundary with no reason is a compromise for every signer, including the anchor signer", async () => {
    const rel = release();
    const r = await runCliRemote({
      anchorMaintainers: NO_REASON_REVOKED,
      head: [rel, anchor(rel.signature.canonicalHash)],
      rel,
    });
    assert.equal(r.ok, false);
    assert.equal(r.result.release?.signatureValid, false);
  });

  it("remote fail-closed: when nodes or events needed to place and judge the anchor cannot be fetched, the anchor is not trusted and time source is self with provable: false", async () => {
    const rel = release();
    const headWithUnfetchableAnchorRepo = [
      rel,
      anchor(rel.signature.canonicalHash, "test-org/unfetchable-node"),
      keyRotation(),
    ];
    const rRepoNodeMissing = await runCliRemote({
      anchorMaintainers: ROTATED,
      head: headWithUnfetchableAnchorRepo,
      rel,
      blockedNodes: new Set(["test-org/unfetchable-node"]),
    });
    assert.equal(rRepoNodeMissing.ok, false);
    assert.equal(rRepoNodeMissing.result.release?.signatureValid, false);
    assert.deepEqual(rRepoNodeMissing.result.release?.signatureTime, {
      source: "self",
      provable: false,
    });

    const head = [rel, anchor(rel.signature.canonicalHash), keyRotation()];
    const rNodeMissing = await runCliRemote({
      anchorMaintainers: ROTATED,
      head,
      rel,
      blockedNodes: new Set([ANCHOR_REPO]),
    });
    assert.equal(rNodeMissing.ok, false);
    assert.equal(rNodeMissing.result.release?.signatureValid, false);
    assert.deepEqual(rNodeMissing.result.release?.signatureTime, {
      source: "self",
      provable: false,
    });

    const rEventsMissing = await runCliRemote({
      anchorMaintainers: ROTATED,
      head,
      rel,
      failEventsFetch: true,
    });
    assert.equal(rEventsMissing.ok, false);
    assert.equal(rEventsMissing.status, "ERROR");
  });
});

describe("Four paths, one answer: VL, LVR, AR and CLI (--local and remote) agree on every anchor case", () => {
  it("returns identical verdicts across VL, LVR, AR, CLI --local and CLI remote for all six cases", async () => {
    const rel1 = release();
    assert.deepEqual(
      await onAllFourPaths({ anchorMaintainers: ROTATED, head: [keyRotation(), rel1], rel: rel1 }),
      { vl: false, lvr: false, ar: false, cliLocal: false, cliRemote: false }
    );

    const rel2 = release();
    assert.deepEqual(
      await onAllFourPaths({
        anchorMaintainers: ROTATED,
        head: [keyRotation(), rel2, anchor(rel2.signature.canonicalHash)],
        rel: rel2,
      }),
      { vl: false, lvr: false, ar: false, cliLocal: false, cliRemote: false }
    );

    const rel3 = release();
    assert.deepEqual(
      await onAllFourPaths({
        anchorMaintainers: ROTATED,
        head: [rel3, anchor(rel3.signature.canonicalHash), keyRotation()],
        rel: rel3,
      }),
      { vl: true, lvr: true, ar: true, cliLocal: true, cliRemote: true }
    );

    const rel4 = release();
    assert.deepEqual(
      await onAllFourPaths({
        anchorMaintainers: ROTATED,
        head: [rel4, anchor(rel4.signature.canonicalHash)],
        rel: rel4,
      }),
      { vl: false, lvr: false, ar: false, cliLocal: false, cliRemote: false }
    );

    const rel5 = release();
    const rev5 = keyRevocation();
    assert.deepEqual(
      await onAllFourPaths({
        anchorMaintainers: [OLD, NEW],
        base: [rev5],
        head: [rev5, rel5, anchor(rel5.signature.canonicalHash)],
        rel: rel5,
      }),
      { vl: false, lvr: false, ar: false, cliLocal: false, cliRemote: false }
    );

    const rel6 = release();
    assert.deepEqual(
      await onAllFourPaths({
        anchorMaintainers: NO_REASON_REVOKED,
        head: [rel6, anchor(rel6.signature.canonicalHash)],
        rel: rel6,
      }),
      { vl: false, lvr: false, ar: false, cliLocal: false, cliRemote: false }
    );
  });
});
});
