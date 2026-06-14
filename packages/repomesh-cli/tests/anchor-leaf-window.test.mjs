// WAVE-3 FIX 1 (convergence blocker): the packages verify-release copy resolved Merkle leaves for
// an anchor ONLY via getPartitionEvents(manifest.partitionId). For a 'genesis'/'all' partition that
// returns ALL current ledger events, so the root was recomputed over the FULL ledger (today: 46
// leaves) instead of the 8 leaves the manifest PINS via range+count -> MISMATCH -> exit 1 for the
// LEGITIMATELY anchored release shipcheck@1.0.4.
//
// tools/verify-release.mjs (resolveLeavesForManifest) and ledger/scripts/validate-ledger.mjs
// (verifyAnchorManifests) instead slice the PINNED window: hashes.slice(indexOf(range[0]),
// +count). This test ports-proofs that fix:
//
//   1) Drive BOTH verify-release copies against the REAL ledger for the genuine anchored release
//      shipcheck@1.0.4 in local mode (offline) and assert they return the SAME anchor verdict =
//      PASS with the anchor root matching (rootMatch:true / rootValid:true).  RED on the old
//      packages code (rootMatch:false, exit 1); GREEN after.
//   2) A forged/tampered anchor (wrong manifest root) MUST still FAIL in the packages copy — the
//      windowed slice must not introduce a false-accept.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const pkgSrc = path.resolve(REPO_ROOT, "packages", "repomesh-cli", "src");
function toURL(p) { return pathToFileURL(p).href; }

const SHIP_REPO = "mcp-tool-shop-org/shipcheck";
const SHIP_VERSION = "1.0.4";

// --- Drive the tools/ copy (reference) against an arbitrary repo root, offline, --anchored-or-local.
function runToolsCopy(root, { repo, version }) {
  const { execSync } = require("node:child_process");
  const out = execSync(
    `node tools/verify-release.mjs --repo ${repo} --version ${version} --anchored-or-local --json`,
    {
      cwd: REPO_ROOT, encoding: "utf8",
      env: {
        ...process.env,
        REPOMESH_ROOT: root,
        REPOMESH_LEDGER_PATH: path.join(root, "ledger", "events", "events.jsonl"),
        REPOMESH_NODES_PATH: path.join(root, "ledger", "nodes"),
        REPOMESH_PROFILES_PATH: path.join(root, "profiles"),
        REPOMESH_FORCE_OFFLINE: "1",
        REPOMESH_OFFLINE: "1",
      },
    }
  );
  const blobs = out.match(/\{[\s\S]*\}/g);
  return JSON.parse(blobs[blobs.length - 1]);
}

// --- Drive the packages/ copy (the one under fix). It runs in "local" mode when cwd looks like a
// RepoMesh checkout (ledger/ + registry/ + schemas/) and reads files relative to cwd. We point cwd
// at `root` and force offline so no network is touched.
async function runPackagesCopy(root, { repo, version }) {
  const origExit = process.exit, origCwd = process.cwd, origLog = console.log, origErr = console.error;
  let out = "", exitCode = null;
  process.exit = (c) => { exitCode = c; throw new Error("__EXIT__"); };
  process.cwd = () => root;
  console.log = (m) => { out += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  console.error = () => {};
  process.env.REPOMESH_FORCE_OFFLINE = "1";
  try {
    const { verifyRelease } = await import(
      toURL(path.resolve(pkgSrc, "verify", "verify-release.mjs")) + `?t=${Date.now()}${Math.random()}`
    );
    await verifyRelease({ repo, version, anchored: true, anchoredOrLocal: true, json: true });
  } catch (e) {
    if (e.message !== "__EXIT__") { console.error = origErr; throw e; }
  } finally {
    process.exit = origExit; process.cwd = origCwd; console.log = origLog; console.error = origErr;
    delete process.env.REPOMESH_FORCE_OFFLINE;
  }
  const blobs = out.match(/\{[\s\S]*\}/g);
  return { result: blobs ? JSON.parse(blobs[blobs.length - 1]) : null, exitCode };
}

describe("WAVE-3 FIX 1: anchor leaf resolution uses the manifest's PINNED window (range+count)", () => {
  it("both copies agree shipcheck@1.0.4 is anchored & root MATCHES against the real ledger", async () => {
    // Drive BOTH copies against the actual committed repo (genesis/all manifest pins 8 leaves of a
    // 46-event ledger). The pre-fix packages code recomputed the root over all 46 leaves -> MISMATCH.
    const tools = runToolsCopy(REPO_ROOT, { repo: SHIP_REPO, version: SHIP_VERSION });
    const { result: pkg } = await runPackagesCopy(REPO_ROOT, { repo: SHIP_REPO, version: SHIP_VERSION });

    // The tools copy is the drift-proof reference; it must report a matching root.
    assert.equal(tools.anchor?.rootValid, true, "tools reference: anchor root must validate against the pinned window");
    assert.equal(tools.gate?.verdict, "PASS", "tools reference: shipcheck@1.0.4 verdict must be PASS");

    // The packages copy (under fix) must AGREE: anchor found, root matches, verdict PASS.
    assert.equal(pkg?.anchor?.anchored, true, "packages: shipcheck@1.0.4 must be detected as anchored");
    assert.equal(pkg?.anchor?.rootMatch, true,
      "packages: anchor Merkle root must MATCH the pinned window (was recomputed over all 46 leaves pre-fix)");
    assert.equal(pkg?.gate?.status, "PASS", "packages: shipcheck@1.0.4 verdict must be PASS");
    assert.equal(pkg?.ok, true, "packages: a legitimately anchored release must not exit 1");

    // Same anchor verdict across copies (PASS == PASS) — the convergence guarantee.
    assert.equal(pkg.gate.status, tools.gate.verdict, "the two copies must return the SAME verdict");
    assert.equal(pkg.anchor.rootMatch, tools.anchor.rootValid, "the two copies must agree on the anchor root");
  });

  it("a FORGED anchor (tampered manifest root) still FAILS in the packages copy — no false-accept", async () => {
    // Build an isolated copy of the real repo, then corrupt the anchored partition's manifest root
    // (and re-derive its manifestHash so the manifestHash integrity check still passes — only the
    // leaf-Merkle-recompute can catch this). The windowed-slice path must still recompute over the
    // pinned 8 leaves and reject the wrong root.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repomesh-w3-forge-"));
    try {
      // Minimal real-repo mirror: ledger (events+nodes), schemas, registry, profiles, manifests.
      for (const sub of [
        ["ledger", "events"], ["ledger", "nodes"], ["registry"], ["schemas"], ["profiles"],
        ["anchor", "xrpl", "manifests"],
      ]) fs.mkdirSync(path.join(root, ...sub), { recursive: true });

      // Copy the real ledger + nodes + profiles + verifier policy + manifests verbatim.
      copyTree(path.join(REPO_ROOT, "ledger", "events"), path.join(root, "ledger", "events"));
      copyTree(path.join(REPO_ROOT, "ledger", "nodes"), path.join(root, "ledger", "nodes"));
      copyTree(path.join(REPO_ROOT, "profiles"), path.join(root, "profiles"));
      copyTree(path.join(REPO_ROOT, "anchor", "xrpl", "manifests"), path.join(root, "anchor", "xrpl", "manifests"));
      if (fs.existsSync(path.join(REPO_ROOT, "verifier.policy.json"))) {
        fs.copyFileSync(path.join(REPO_ROOT, "verifier.policy.json"), path.join(root, "verifier.policy.json"));
      }
      // registry/ + schemas/ only need to EXIST for isRepoMeshCheckout(); copy schemas for fidelity.
      copyTree(path.join(REPO_ROOT, "schemas"), path.join(root, "schemas"));

      // Tamper the genesis manifest's root, re-deriving manifestHash so only the merkle recompute catches it.
      const mp = path.join(root, "anchor", "xrpl", "manifests", "genesis.json");
      const m = JSON.parse(fs.readFileSync(mp, "utf8"));
      m.root = "f".repeat(64); // a root that cannot match the recompute of the pinned 8 leaves
      const { manifestHash: _drop, ...base } = m;
      m.manifestHash = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
      fs.writeFileSync(mp, JSON.stringify(m, null, 2) + "\n");

      const { result, exitCode } = await runPackagesCopy(root, { repo: SHIP_REPO, version: SHIP_VERSION });
      assert.equal(result?.ok, false, "a forged anchor root must FAIL — no false-accept via the windowed slice");
      assert.equal(result?.anchor?.rootMatch, false, "the tampered root must be detected as a mismatch");
      assert.equal(exitCode, 1, "forged anchor must exit 1");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// --- local helpers ---
function copyTree(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {});
  return v;
}
function canonicalize(v) { return JSON.stringify(sortKeys(v)); }
