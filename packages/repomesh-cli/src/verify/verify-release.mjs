// verify-release — Verify a release's trust chain from anywhere.
// In standalone mode: fetches ledger + node data from GitHub.
// In dev mode: reads local files.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isRepoMeshCheckout } from "../mode.mjs";
import { fetchText, fetchJson } from "../http.mjs";
import {
  DEFAULT_LEDGER_URL, DEFAULT_NODES_URL,
  DEFAULT_MANIFESTS_URL, DEFAULT_ANCHORS_URL,
} from "../remote-defaults.mjs";
import { canonicalize } from "./canonicalize.mjs";
import { merkleRootHex } from "./merkle.mjs";

// --- Data loading (local or remote) ---

async function loadEvents(opts) {
  if (opts.local) {
    const p = path.join(opts.root, "ledger", "events", "events.jsonl");
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
  }
  const url = opts.ledgerUrl || DEFAULT_LEDGER_URL;
  const text = await fetchText(url);
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
}

async function findPublicKey(keyId, opts) {
  if (opts.local) {
    const nodesDir = path.join(opts.root, "ledger", "nodes");
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
  // Remote: we need to find which node has this keyId.
  // Strategy: load events, find unique signers, then fetch their node.json.
  // For now, extract org/repo from events that use this keyId.
  const events = opts._events || [];
  const signerRepos = new Set();
  for (const ev of events) {
    if (ev.signature?.keyId === keyId && ev.repo) {
      // The signer node is typically the network node, not the release repo.
      // Check all known node IDs from events.
      signerRepos.add(ev.repo);
    }
  }
  // Try fetching node.json for each unique org/repo combo found in events
  const nodesUrl = opts.nodesUrl || DEFAULT_NODES_URL;
  const tried = new Set();
  for (const ev of events) {
    if (ev.signature?.keyId !== keyId) continue;
    // Try the repo itself
    const candidates = [ev.repo];
    // Also try common attestor node paths
    if (!tried.has(ev.repo)) {
      tried.add(ev.repo);
      for (const c of candidates) {
        try {
          const node = await fetchJson(`${nodesUrl}/${c}/node.json`);
          const m = (node.maintainers || []).find(m => m.keyId === keyId);
          if (m?.publicKey) return { publicKey: m.publicKey, nodeId: node.id };
        } catch {}
      }
    }
  }
  // Last resort: try well-known network nodes
  for (const nodeId of ["mcp-tool-shop-org/repomesh", "mcp-tool-shop-org/repomesh-license-verifier", "mcp-tool-shop-org/repomesh-security-verifier"]) {
    try {
      const node = await fetchJson(`${nodesUrl}/${nodeId}/node.json`);
      const m = (node.maintainers || []).find(m => m.keyId === keyId);
      if (m?.publicKey) return { publicKey: m.publicKey, nodeId: node.id };
    } catch {}
  }
  return null;
}

async function verifySignature(event, opts) {
  const ev = JSON.parse(JSON.stringify(event));
  const sig = ev.signature;
  delete ev.signature;
  const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  if (canonHash !== sig.canonicalHash) return { ok: false, reason: "canonical hash mismatch" };

  const key = await findPublicKey(sig.keyId, opts);
  if (!key) return { ok: false, reason: `no public key for keyId=${sig.keyId}` };

  try {
    const ok = crypto.verify(null, Buffer.from(canonHash, "hex"), key.publicKey, Buffer.from(sig.value, "base64"));
    return ok ? { ok: true, nodeId: key.nodeId } : { ok: false, reason: "signature invalid" };
  } catch (e) {
    return { ok: false, reason: `verify error: ${e.message}` };
  }
}

function getPartitionEvents(events, partitionId) {
  if (partitionId === "all" || partitionId === "genesis") return events;
  if (partitionId.startsWith("since:")) {
    const sinceTs = partitionId.slice(6);
    const idx = events.findIndex(ev =>
      ev.type === "AttestationPublished" && ev.timestamp === sinceTs &&
      (ev.attestations || []).some(a => a.type === "ledger.anchor")
    );
    return idx >= 0 ? events.slice(idx + 1) : events;
  }
  return events.filter(ev => ev.timestamp?.startsWith(partitionId));
}

async function findAnchorForHash(events, canonicalHash, opts) {
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

      let manifest;
      if (opts.local) {
        const p = path.join(opts.root, meta.manifestPath);
        if (!fs.existsSync(p)) continue;
        manifest = JSON.parse(fs.readFileSync(p, "utf8"));
      } else {
        const manifestsUrl = opts.manifestsUrl || DEFAULT_MANIFESTS_URL;
        const manifestFile = meta.manifestPath.split("/").pop();
        try {
          manifest = await fetchJson(`${manifestsUrl}/${manifestFile}`);
        } catch { continue; }
      }

      const partition = getPartitionEvents(events, manifest.partitionId);
      const leaves = partition.map(ev => ev.signature?.canonicalHash)
        .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));
      if (leaves.includes(canonicalHash)) {
        return { anchor, manifest, meta };
      }
    } catch {}
  }
  return null;
}

// --- Main verification logic ---

export async function verifyRelease({ repo, version, anchored, json, ledgerUrl, nodesUrl, manifestsUrl }) {
  const local = isRepoMeshCheckout();
  const opts = {
    local,
    root: process.cwd(),
    ledgerUrl,
    nodesUrl,
    manifestsUrl,
  };

  const events = await loadEvents(opts);
  opts._events = events;

  if (events.length === 0) {
    if (json) { console.log(JSON.stringify({ ok: false, error: "No ledger events found." })); }
    else { console.error("Error: No ledger events found."); }
    process.exit(1);
  }

  const result = { ok: true, repo, version, release: null, attestations: [], anchor: null };

  if (!json) {
    console.log(`\nVerifying release: ${repo}@${version}`);
    console.log(`  Mode: ${local ? "local (dev)" : "remote"}`);
    console.log(`  Anchored check: ${anchored ? "yes" : "no"}\n`);
  }

  // 1. Find ReleasePublished event
  const release = events.find(ev =>
    ev.type === "ReleasePublished" && ev.repo === repo && ev.version === version
  );
  if (!release) {
    if (json) { console.log(JSON.stringify({ ok: false, error: `ReleasePublished not found for ${repo}@${version}` })); }
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
  const sigResult = await verifySignature(release, opts);
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
    for (const a of (att.attestations || [])) attestTypes.add(a.type);
  }

  if (!json) console.log(`\n  Attestations (${attestTypes.size}):`);

  for (const t of attestTypes) {
    const att = attestations.find(ev => (ev.attestations || []).some(a => a.type === t));
    const sigOk = await verifySignature(att, opts);
    const noteMatch = att.notes?.match(/^([^:]+):\s*(pass|warn|fail)/);
    const attResult = noteMatch ? noteMatch[2] : "unknown";
    result.attestations.push({ type: t, result: attResult, signatureValid: sigOk.ok, signerNode: sigOk.ok ? sigOk.nodeId : null });
    if (!json) {
      const signer = sigOk.ok ? ` (${sigOk.nodeId})` : "";
      console.log(`    ${sigOk.ok ? "VALID" : "FAIL"}  ${t}: ${attResult}${signer}`);
    }
  }

  // 4. Anchor verification
  if (anchored) {
    const releaseHash = release.signature.canonicalHash;
    if (!json) {
      console.log(`\n  Anchor verification:`);
      console.log(`    Release canonicalHash: ${releaseHash}`);
    }

    const anchorResult = await findAnchorForHash(events, releaseHash, opts);
    if (!anchorResult) {
      result.anchor = { anchored: false };
      if (!json) {
        console.log(`    Not anchored yet (no anchor partition contains this release)`);
      }
    } else {
      const { manifest, meta } = anchorResult;
      const { manifestHash: mh, ...base } = manifest;
      const recomputedMh = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
      const manifestValid = recomputedMh === mh;

      if (!manifestValid) {
        result.ok = false;
        result.anchor = { anchored: true, manifestValid: false };
        if (json) { console.log(JSON.stringify(result)); }
        else { console.error(`    ManifestHash: MISMATCH`); }
        process.exit(1);
      }

      result.anchor = {
        anchored: true, manifestValid: true,
        partition: manifest.partitionId, root: manifest.root,
        manifestHash: manifest.manifestHash,
        txHash: meta.txHash || null, network: meta.network || null,
      };

      if (!json) {
        console.log(`    Partition:    ${manifest.partitionId}`);
        console.log(`    Root:         ${manifest.root}`);
        console.log(`    ManifestHash: VERIFIED`);
        if (meta.txHash) console.log(`    XRPL tx:      ${meta.txHash}`);
        console.log(`    Release INCLUDED in anchored partition`);
      }
    }
  }

  // Final output
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (anchored && result.anchor?.anchored) {
      const a = result.anchor;
      console.log(`\n  Anchored: YES (partition=${a.partition}, tx=${a.txHash || "local"})`);
    } else if (anchored) {
      console.log(`\n  Anchored: NO (pending)`);
    }
    console.log(`\n  Verification: PASS\n`);
  }
}
