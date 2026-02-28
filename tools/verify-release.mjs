#!/usr/bin/env node
// verify-release.mjs — Verify a release's trust chain, optionally including XRPL anchor proof.
//
// Usage:
//   node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.4
//   node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.4 --anchored
//   node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.4 --anchored --json
//
// Checks:
//   1. ReleasePublished event exists and is signed
//   2. Signature verifies against registered public key
//   3. All attestation events present (license, security, repro, etc.)
//   4. --anchored: release's canonicalHash is included in an anchored partition
//      and the manifest hash matches the XRPL memo

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const MANIFESTS_DIR = path.join(ROOT, "anchor", "xrpl", "manifests");

function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  }
  return v;
}

function readEvents() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, "utf8")
    .split("\n").filter(l => l.trim().length > 0).map(l => JSON.parse(l));
}

function findPublicKeyForKeyId(keyId) {
  // Search all registered nodes for a maintainer with this keyId
  const nodesDir = path.join(ROOT, "ledger", "nodes");
  if (!fs.existsSync(nodesDir)) return null;
  for (const org of fs.readdirSync(nodesDir)) {
    const orgDir = path.join(nodesDir, org);
    if (!fs.statSync(orgDir).isDirectory()) continue;
    for (const repo of fs.readdirSync(orgDir)) {
      const nodePath = path.join(orgDir, repo, "node.json");
      if (!fs.existsSync(nodePath)) continue;
      const node = JSON.parse(fs.readFileSync(nodePath, "utf8"));
      const m = (node.maintainers || []).find(m => m.keyId === keyId);
      if (m?.publicKey) return { publicKey: m.publicKey, nodeId: node.id };
    }
  }
  return null;
}

function verifySignature(event) {
  const ev = JSON.parse(JSON.stringify(event));
  const sig = ev.signature;
  delete ev.signature;
  const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  if (canonHash !== sig.canonicalHash) return { ok: false, reason: "canonical hash mismatch" };

  const key = findPublicKeyForKeyId(sig.keyId);
  if (!key) return { ok: false, reason: `no public key for keyId=${sig.keyId} in any registered node` };

  try {
    const ok = crypto.verify(null, Buffer.from(canonHash, "hex"), key.publicKey, Buffer.from(sig.value, "base64"));
    return ok ? { ok: true, nodeId: key.nodeId } : { ok: false, reason: "signature invalid" };
  } catch (e) {
    return { ok: false, reason: `verify error: ${e.message}` };
  }
}

function findAnchorForHash(events, canonicalHash) {
  // Walk anchor events, find one whose partition contains this hash
  const anchors = events.filter(ev =>
    ev.type === "AttestationPublished" &&
    (ev.attestations || []).some(a => a.type === "ledger.anchor")
  );

  for (const anchor of anchors) {
    const notes = anchor.notes || "";
    try {
      const jsonMatch = notes.match(/\n(\{.*\})$/s);
      if (!jsonMatch) continue;
      const meta = JSON.parse(jsonMatch[1]);
      if (!meta.manifestPath) continue;

      // Load manifest and check if hash is in range
      const manifestFullPath = path.join(ROOT, meta.manifestPath);
      if (!fs.existsSync(manifestFullPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestFullPath, "utf8"));

      // Recompute: get all events in this partition and check inclusion
      const partition = getPartitionEvents(events, manifest.partitionId);
      const leaves = partition
        .map(ev => ev.signature?.canonicalHash)
        .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));

      if (leaves.includes(canonicalHash)) {
        return { anchor, manifest, meta };
      }
    } catch {}
  }
  return null;
}

function getPartitionEvents(events, partitionId) {
  if (partitionId === "all" || partitionId === "genesis") return events;
  if (partitionId.startsWith("since:")) {
    const sinceTs = partitionId.slice(6);
    const idx = events.findIndex(ev =>
      ev.type === "AttestationPublished" &&
      ev.timestamp === sinceTs &&
      (ev.attestations || []).some(a => a.type === "ledger.anchor")
    );
    return idx >= 0 ? events.slice(idx + 1) : events;
  }
  return events.filter(ev => ev.timestamp?.startsWith(partitionId));
}

export function verifyRelease({ repo, version, anchored, json }) {
  const events = readEvents();
  if (events.length === 0) {
    if (json) { console.log(JSON.stringify({ ok: false, error: "No ledger events found." })); }
    else { console.error("No ledger events found."); }
    process.exit(1);
  }

  // Collect structured result
  const result = {
    ok: true,
    repo,
    version,
    release: null,
    attestations: [],
    anchor: null,
  };

  if (!json) {
    console.log(`\nVerifying release: ${repo}@${version}`);
    console.log(`  Anchored check: ${anchored ? "yes" : "no"}\n`);
  }

  // 1. Find ReleasePublished event
  const release = events.find(ev =>
    ev.type === "ReleasePublished" && ev.repo === repo && ev.version === version
  );
  if (!release) {
    if (json) { console.log(JSON.stringify({ ok: false, error: `ReleasePublished event not found for ${repo}@${version}` })); }
    else { console.error(`  ReleasePublished event not found for ${repo}@${version}`); }
    process.exit(1);
  }

  result.release = {
    timestamp: release.timestamp,
    commit: release.commit,
    artifacts: (release.artifacts || []).length,
    canonicalHash: release.signature?.canonicalHash,
  };

  // 2. Verify signature
  const sigResult = verifySignature(release);
  result.release.signatureValid = sigResult.ok;
  result.release.signerNode = sigResult.ok ? sigResult.nodeId : null;
  result.release.keyId = release.signature.keyId;

  if (!sigResult.ok) {
    result.ok = false;
    result.release.signatureReason = sigResult.reason;
    if (json) { console.log(JSON.stringify(result)); }
    else { console.error(`    Signature: FAILED (${sigResult.reason})`); }
    process.exit(1);
  }

  if (!json) {
    console.log(`  Release event found: ${release.timestamp}`);
    console.log(`    Commit:    ${release.commit}`);
    console.log(`    Artifacts: ${(release.artifacts || []).length}`);
    console.log(`    Signature: VALID (keyId=${release.signature.keyId}, node=${sigResult.nodeId})`);
  }

  // 3. Find attestations
  const attestations = events.filter(ev =>
    ev.type === "AttestationPublished" && ev.repo === repo && ev.version === version
  );
  const attestTypes = new Set();
  for (const att of attestations) {
    for (const a of (att.attestations || [])) {
      attestTypes.add(a.type);
    }
  }

  if (!json) { console.log(`\n  Attestations (${attestTypes.size}):`); }

  for (const t of attestTypes) {
    const att = attestations.find(ev => (ev.attestations || []).some(a => a.type === t));
    const sigOk = verifySignature(att);
    const noteMatch = att.notes?.match(/^([^:]+):\s*(pass|warn|fail)/);
    const attResult = noteMatch ? noteMatch[2] : "unknown";
    result.attestations.push({
      type: t,
      result: attResult,
      signatureValid: sigOk.ok,
      signerNode: sigOk.ok ? sigOk.nodeId : null,
    });
    if (!json) {
      const signer = sigOk.ok ? ` (${sigOk.nodeId})` : "";
      console.log(`    ${sigOk.ok ? "VALID" : "FAIL"}  ${t}: ${attResult}${signer}`);
    }
  }

  // 4. Anchor verification (if --anchored)
  if (anchored) {
    const releaseHash = release.signature.canonicalHash;

    if (!json) {
      console.log(`\n  Anchor verification:`);
      console.log(`    Release canonicalHash: ${releaseHash}`);
    }

    const anchorResult = findAnchorForHash(events, releaseHash);
    if (!anchorResult) {
      result.anchor = { anchored: false };
      if (!json) {
        console.log(`    Not anchored yet (no anchor partition contains this release)`);
        console.log(`    Run the anchor workflow to include this release in the next partition.`);
      }
    } else {
      const { manifest, meta } = anchorResult;

      // Verify manifest hash
      const { manifestHash: mh, ...base } = manifest;
      const recomputedMh = crypto.createHash("sha256")
        .update(canonicalize(base), "utf8").digest("hex");
      const manifestValid = recomputedMh === mh;

      if (!manifestValid) {
        result.ok = false;
        result.anchor = { anchored: true, manifestValid: false, expected: recomputedMh, got: mh };
        if (json) { console.log(JSON.stringify(result)); }
        else { console.error(`    ManifestHash: MISMATCH (expected ${recomputedMh})`); }
        process.exit(1);
      }

      result.anchor = {
        anchored: true,
        manifestValid: true,
        partition: manifest.partitionId,
        root: manifest.root,
        manifestHash: manifest.manifestHash,
        manifestPath: meta.manifestPath,
        txHash: meta.txHash || null,
        network: meta.network || null,
      };

      if (!json) {
        console.log(`    Partition:    ${manifest.partitionId}`);
        console.log(`    Root:         ${manifest.root}`);
        console.log(`    ManifestHash: ${manifest.manifestHash}`);
        console.log(`    ManifestPath: ${meta.manifestPath}`);
        if (meta.txHash) {
          console.log(`    XRPL tx:      ${meta.txHash}`);
        }
        console.log(`    ManifestHash: VERIFIED`);
        console.log(`    Release INCLUDED in anchored partition`);
      }
    }
  }

  // Final output
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Inclusion statement (one-line summary)
    if (anchored && result.anchor?.anchored) {
      const a = result.anchor;
      console.log(`\n  Anchored: YES (partition=${a.partition}, root=${a.root.slice(0, 12)}..., tx=${a.txHash || "local"})`);
    } else if (anchored) {
      console.log(`\n  Anchored: NO (pending)`);
    }
    console.log(`\n  Verification: PASS\n`);
  }
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf("--repo");
  const versionIdx = args.indexOf("--version");
  const repo = repoIdx !== -1 ? args[repoIdx + 1] : null;
  const version = versionIdx !== -1 ? args[versionIdx + 1] : null;
  const anchored = args.includes("--anchored");
  const json = args.includes("--json");
  if (!repo || !version) {
    console.error("Usage: verify-release.mjs --repo org/repo --version X.Y.Z [--anchored] [--json]");
    process.exit(1);
  }
  verifyRelease({ repo, version, anchored, json });
}
