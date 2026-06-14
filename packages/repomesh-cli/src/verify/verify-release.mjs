// verify-release — Verify a release's trust chain from anywhere.
// In standalone mode: fetches ledger + node data from GitHub.
// In dev mode: reads local files.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDebug, log, debug as debugLog } from "../log.mjs";

function progress(step, msg) { console.error(`[verify] step ${step}: ${msg}`); }

// B-FP-02: ONE indentation style for every --json exit path. Pretty (2-space) everywhere so
// CI logs and human eyeballs see a consistent shape regardless of which exit the run took.
function emitJson(obj) { console.log(JSON.stringify(obj, null, 2)); }

// B-OBS-01: actionable, machine-readable remediation per failure cause. Keyed by the
// `reason` slug a gate failure carries, with a per-attestation-type fallback so a missing
// required attestation always tells the operator exactly which check to publish and how.
const ATTESTATION_HINTS = {
  "sbom.present": "Publish an SBOM attestation (e.g. via the security verifier) for this release.",
  "provenance.present": "Publish a build-provenance attestation (SLSA/in-toto) for this release.",
  "license.audit": "Run the license verifier and publish a license.audit attestation.",
  "security.scan": "Run a vulnerability scan and publish a passing security.scan attestation.",
  "repro.build": "Reproduce the build and publish a repro.build attestation.",
  "signature.chain": "Ensure the release is signed by a key registered under the release repo's node.json.",
};
function hintForFailure({ type, reason }) {
  if (reason === "missing") {
    return ATTESTATION_HINTS[type]
      || `Publish a passing, independently-signed '${type}' attestation for this release.`;
  }
  if (reason === "no passing attestation (warn/unknown only)") {
    return `The '${type}' attestation exists but did not pass. Resolve the finding and re-publish a passing attestation.`;
  }
  if (/invalid signature/.test(reason)) {
    return `The '${type}' attestation's signature did not verify. Re-publish it signed by a trusted attestor key.`;
  }
  if (/result=fail/.test(reason)) {
    return `The '${type}' attestation reported fail. Fix the underlying issue and re-publish a passing attestation.`;
  }
  return ATTESTATION_HINTS[type]
    || `Publish a passing, independently-signed '${type}' attestation for this release.`;
}

import { isRepoMeshCheckout } from "../mode.mjs";
import { fetchText, fetchJson } from "../http.mjs";
import {
  DEFAULT_LEDGER_URL, DEFAULT_NODES_URL,
  DEFAULT_MANIFESTS_URL, DEFAULT_ANCHORS_URL,
  BUNDLED_TRUSTED_ATTESTORS, BUNDLED_ATTESTOR_KINDS,
} from "../remote-defaults.mjs";
import { canonicalize } from "./canonicalize.mjs";
import { merkleRootForAlgo, isSupportedMerkleAlgo } from "./merkle.mjs";
import { parseStrictJson, displayCanonical, isPathInside } from "./safe-json.mjs";
import { verifyAnchorTx } from "./verify-anchor.mjs";
import {
  EXIT, exitCodeForStatus, normalizeFailOn, normalizeFormat,
  buildSarif, buildMarkdown,
} from "./format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..");

// Trust-critical fetches must not be silently redirected, and must be size-capped (CLI-005/006).
const TRUST_FETCH_OPTS = { manualRedirect: true };

// --- Data loading (local or remote) ---

function parseJsonlLines(lines) {
  const results = [];
  let lineNo = 0;
  for (const line of lines) {
    lineNo++;
    if (!line.trim()) continue;
    try {
      // CLI-010: strict parse rejects duplicate keys and non-finite numbers.
      results.push(parseStrictJson(line));
    } catch (e) {
      debugLog(`skipping malformed JSONL line ${lineNo}: ${e.message}`);
    }
  }
  return results;
}

async function loadEvents(opts) {
  if (opts.local) {
    const p = path.join(opts.root, "ledger", "events", "events.jsonl");
    if (!fs.existsSync(p)) return [];
    return parseJsonlLines(fs.readFileSync(p, "utf8").split("\n"));
  }
  const url = opts.ledgerUrl || DEFAULT_LEDGER_URL;
  const text = await fetchText(url, TRUST_FETCH_OPTS);
  return parseJsonlLines(text.split("\n"));
}

// Third-party event types: the signer is allowed to be a different node than ev.repo.
const THIRD_PARTY_TYPES = new Set(["AttestationPublished", "PolicyViolation"]);

function readNodeFromDir(nodePath) {
  if (!fs.existsSync(nodePath)) return null;
  try {
    return parseStrictJson(fs.readFileSync(nodePath, "utf8"));
  } catch (e) {
    debugLog(`failed to parse ${nodePath}: ${e.message}`);
    return null;
  }
}

function extractKeyFromNode(node, keyId) {
  if (!node || typeof node !== "object") return null;
  const m = (node.maintainers || []).find(m => m.keyId === keyId);
  if (m?.publicKey) return { publicKey: m.publicKey, nodeId: node.id, kind: node.kind };
  return null;
}

// D12 (CRITICAL #1): the EFFECTIVE trusted-attestor allowlist. The bundled set (the 5 org nodes)
// is the non-removable floor a remote ledger cannot widen. A fetched verifier.policy.json may
// NARROW the set (intersection only) but NEVER add to it. Disallowed-kind nodes are rejected even
// if their id is allowlisted. Mirrors tools/verify-release.mjs effectiveTrustedAttestors().
function effectiveTrustedAttestors(opts) {
  const bundled = new Set(BUNDLED_TRUSTED_ATTESTORS);
  // Best-effort: read a LOCAL verifier.policy.json (a checkout/clone) and INTERSECT. Remote policy
  // is intentionally NOT trusted to widen, so we never fetch it to expand the set; absence => bundled.
  if (opts?.local && opts?.root) {
    try {
      const p = path.join(opts.root, "verifier.policy.json");
      if (fs.existsSync(p)) {
        const policy = parseStrictJson(fs.readFileSync(p, "utf8"));
        const fetched = Array.isArray(policy?.trustedAttestors) ? policy.trustedAttestors : null;
        if (fetched) {
          // narrow-only: keep just the bundled nodes the policy ALSO lists.
          return new Set([...bundled].filter(id => fetched.includes(id)));
        }
      }
    } catch (e) { debugLog(`verifier.policy.json read failed (using bundled allowlist): ${e.message}`); }
  }
  return bundled;
}

// A resolved third-party signer is trusted iff its node id is in the effective allowlist AND its
// node kind is one of {attestor, registry}. Used to gate attestation key resolution (D12).
function isTrustedAttestorNode(key, allowlist) {
  if (!key || !key.nodeId) return false;
  if (!allowlist.has(key.nodeId)) return false;
  if (!BUNDLED_ATTESTOR_KINDS.includes(key.kind)) return false;
  return true;
}

// D1: For ReleasePublished (and any NON-third-party event), resolve the verifying key
// ONLY from ev.repo's own node.json, and require signerNode === ev.repo. Cross-node
// keyId lookup is retained ONLY for third-party event types (AttestationPublished,
// PolicyViolation), where the signer is a distinct attestor/policy node.
async function findPublicKey(keyId, ev, opts) {
  const isThirdParty = THIRD_PARTY_TYPES.has(ev?.type);

  if (!isThirdParty) {
    // Repo-bound: ev.repo's node.json is the ONLY authority.
    if (!ev?.repo) return null;
    const [org, repo] = ev.repo.split("/");
    if (!org || !repo) return null;
    if (opts.local) {
      const nodePath = path.join(opts.root, "ledger", "nodes", org, repo, "node.json");
      return extractKeyFromNode(readNodeFromDir(nodePath), keyId);
    }
    const nodesUrl = opts.nodesUrl || DEFAULT_NODES_URL;
    try {
      const node = await fetchJson(`${nodesUrl}/${ev.repo}/node.json`, TRUST_FETCH_OPTS);
      return extractKeyFromNode(node, keyId);
    } catch (e) { debugLog(e.message); return null; }
  }

  // Third-party (AttestationPublished / PolicyViolation): the signer must be a TRUSTED attestor.
  // D12: ONLY nodes in the bundled allowlist (narrowed by a local verifier.policy.json, never
  // widened) and of an allowed kind {attestor, registry} may sign. A valid signature from a
  // non-allowlisted / wrong-kind node resolves to NO key — its attestation is excluded from the
  // gate AND from independent witnesses.
  const allowlist = effectiveTrustedAttestors(opts);
  if (opts.local) {
    // Resolve ONLY from allowlisted node dirs — never scan arbitrary nodes.
    for (const nodeId of allowlist) {
      const [org, repo] = nodeId.split("/");
      const found = extractKeyFromNode(readNodeFromDir(path.join(opts.root, "ledger", "nodes", org, repo, "node.json")), keyId);
      if (found && isTrustedAttestorNode(found, allowlist)) return found;
    }
    return null;
  }
  // Remote third-party: fetch ONLY allowlisted node.json files; the keyId must resolve to one of
  // them and that node must be of an allowed kind. We do NOT fetch arbitrary event-repo nodes,
  // because a release repo could otherwise self-register a key and forge an "independent" witness.
  const nodesUrl = opts.nodesUrl || DEFAULT_NODES_URL;
  for (const nodeId of allowlist) {
    try {
      const node = await fetchJson(`${nodesUrl}/${nodeId}/node.json`, TRUST_FETCH_OPTS);
      const found = extractKeyFromNode(node, keyId);
      if (found && isTrustedAttestorNode(found, allowlist)) return found;
    } catch (e) { debugLog(e.message); }
  }
  return null;
}

async function verifySignature(event, opts) {
  // CLI-010: round-trip via strict parse so duplicate keys can't split signed/displayed views.
  let ev;
  try {
    ev = parseStrictJson(JSON.stringify(event));
  } catch (e) {
    return { ok: false, reason: `event rejected: ${e.message}` };
  }
  const sig = ev.signature;
  if (!sig || typeof sig !== "object") return { ok: false, reason: "missing signature" };
  delete ev.signature;
  const canonHash = crypto.createHash("sha256").update(canonicalize(ev), "utf8").digest("hex");
  if (canonHash !== sig.canonicalHash) return { ok: false, reason: "canonical hash mismatch" };

  const key = await findPublicKey(sig.keyId, event, opts);
  if (!key) return { ok: false, reason: `no public key for keyId=${sig.keyId}`, hint: "Ensure the signing repo has registered node.json in the ledger. Run: npx repomesh doctor --repo <org/repo> to check node registration" };

  // D1: for non-third-party events, the resolving node MUST be the event's own repo.
  if (!THIRD_PARTY_TYPES.has(event?.type) && key.nodeId !== event.repo) {
    return { ok: false, reason: `signer node ${key.nodeId} does not match event repo ${event.repo}` };
  }

  try {
    const ok = crypto.verify(null, Buffer.from(canonHash, "hex"), key.publicKey, Buffer.from(sig.value, "base64"));
    return ok ? { ok: true, nodeId: key.nodeId } : { ok: false, reason: "signature invalid", hint: "The release may have been tampered with, or the signing key has changed" };
  } catch (e) {
    return { ok: false, reason: `verify error: ${e.message}`, hint: "The release may have been tampered with, or the signing key has changed" };
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

// Parse an anchor event's notes meta blob (the trailing JSON line). Returns null on failure.
function parseAnchorMeta(anchor) {
  const notes = anchor.notes || "";
  const jsonMatch = notes.match(/\n(\{.*?\})$/s);
  if (!jsonMatch) return null;
  let meta;
  try { meta = parseStrictJson(jsonMatch[1]); } catch (e) {
    debugLog(`malformed anchor meta JSON: ${e.message}`);
    return null;
  }
  if (
    typeof meta.manifestPath !== "string" ||
    (meta.txHash !== undefined && typeof meta.txHash !== "string") ||
    (meta.network !== undefined && typeof meta.network !== "string")
  ) return null;
  return meta;
}

async function loadManifest(meta, opts) {
  if (opts.local) {
    // CLI-011: path.sep-safe containment guard against traversal.
    const resolved = path.resolve(opts.root, meta.manifestPath);
    if (!isPathInside(opts.root, resolved)) return null;
    if (!fs.existsSync(resolved)) return null;
    try { return parseStrictJson(fs.readFileSync(resolved, "utf8")); }
    catch (e) { debugLog(`failed to parse manifest at ${resolved}: ${e.message}`); return null; }
  }
  const manifestsUrl = opts.manifestsUrl || DEFAULT_MANIFESTS_URL;
  const manifestFile = meta.manifestPath.split("/").pop();
  // CLI-011: reject any traversal characters in the basename before composing the URL.
  if (!manifestFile || /[\\/]|\.\./.test(manifestFile)) return null;
  try { return await fetchJson(`${manifestsUrl}/${manifestFile}`, TRUST_FETCH_OPTS); }
  catch (e) { debugLog(e.message); return null; }
}

// Resolve the exact ordered leaf list a manifest pins. PREFER the manifest's own
// `range` (2-element [firstHash, lastHash]) + `count` to slice a contiguous window of the
// ordered ledger canonicalHash list (hashes.slice(start, start + count)). This is drift-proof:
// it mirrors tools/verify-release.mjs resolveLeavesForManifest AND
// ledger/scripts/validate-ledger.mjs verifyAnchorManifests, which slice the PINNED window
// rather than re-deriving leaves by partition id. The partition-id resolver is wrong for
// 'genesis'/'all' partitions: getPartitionEvents returns ALL current ledger events, so the
// root is recomputed over (today) the full ledger instead of the 8 anchored leaves → MISMATCH
// → false exit-1 for a legitimately anchored release. Falls back to the partition-id resolver
// ONLY for legacy manifests that carry no range/count.
function resolveLeavesForManifest(events, manifest) {
  const hashes = events
    .map(ev => ev.signature?.canonicalHash)
    .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));

  if (Array.isArray(manifest.range) && manifest.range.length === 2 && Number.isInteger(manifest.count)) {
    const start = hashes.indexOf(manifest.range[0]);
    if (start === -1) return null; // pinned start no longer present → not anchored here
    const slice = hashes.slice(start, start + manifest.count);
    if (slice.length !== manifest.count) return null; // partition truncated
    if (slice[slice.length - 1] !== manifest.range[1]) return null; // reordered/replaced
    return slice;
  }

  // Legacy fallback: resolve by partition id (only for manifests with no pinned range/count).
  return getPartitionEvents(events, manifest.partitionId)
    .map(ev => ev.signature?.canonicalHash)
    .filter(h => typeof h === "string" && /^[0-9a-fA-F]{64}$/.test(h));
}

async function findAnchorForHash(events, canonicalHash, opts) {
  const anchors = events.filter(ev =>
    ev.type === "AttestationPublished" &&
    (ev.attestations || []).some(a => a.type === "ledger.anchor")
  );
  for (const anchor of anchors) {
    const meta = parseAnchorMeta(anchor);
    if (!meta) continue;
    const manifest = await loadManifest(meta, opts);
    if (!manifest || typeof manifest !== "object" || !manifest.partitionId) continue;
    const leaves = resolveLeavesForManifest(events, manifest);
    if (leaves && leaves.includes(canonicalHash)) {
      return { anchor, manifest, meta, leaves };
    }
  }
  return null;
}

// --- Profile resolution (D5) ---

// Structural integrity checks that are NOT attestation types.
const NON_ATTESTATION_CHECKS = new Set(["signed", "hasArtifacts", "noPolicyViolations"]);

function loadProfileId(repo, opts) {
  // Repo declares its profile via ledger/nodes/<org>/<repo>/repomesh.profile.json.
  const [org, repoName] = (repo || "").split("/");
  if (org && repoName && opts.local) {
    const p = path.join(opts.root, "ledger", "nodes", org, repoName, "repomesh.profile.json");
    const parsed = readNodeFromDir(p); // reuses strict parse + tolerant failure
    if (parsed?.profileId) return parsed.profileId;
  }
  // Default to baseline (requires no attestation types) when undeclared.
  return "baseline";
}

function loadProfileDef(profileId) {
  const valid = new Set(["baseline", "open-source", "regulated"]);
  const id = valid.has(profileId) ? profileId : "baseline";
  try {
    return parseStrictJson(fs.readFileSync(path.join(PKG_ROOT, "profiles", `${id}.json`), "utf8"));
  } catch (e) {
    debugLog(`failed to load profile ${id}: ${e.message}`);
    return { id, requiredChecks: { integrity: [], assurance: [] } };
  }
}

// The set of attestation types this profile requires to be PRESENT + pass + valid.
// D19: dedup so the reported gate.satisfied array stays aligned with tools/verify-release.mjs
// (which builds requiredAttestationTypes via [...new Set(...)]) — a profile that lists the same
// check in both integrity and assurance must not produce a duplicated satisfied entry.
function requiredAttestationTypes(profileDef) {
  const all = [
    ...(profileDef.requiredChecks?.integrity || []),
    ...(profileDef.requiredChecks?.assurance || []),
  ];
  return [...new Set(all.filter(c => !NON_ATTESTATION_CHECKS.has(c)))];
}

// --- Main verification logic ---

// computeVerifyResult — the pure-ish core. Performs the full verification and RETURNS
// { result, status } where status is one of "PASS" | "FAIL" | "UNVERIFIED" | "ERROR".
// It NEVER calls process.exit and NEVER emits a structured blob — that is the caller's job
// (verifyRelease for the single command, verifyAll for the batch). When `human` is true it
// prints the progressive human/text output inline (preserving the legacy text UX); otherwise
// it stays quiet so a json/sarif/markdown caller can emit a single blob.
//
// FC3: `local` / `localDir` thread a REAL offline path. Resolution order:
//   - explicit local===true OR a defined localDir  -> local mode, root = localDir || cwd  (WINS)
//   - otherwise                                     -> isRepoMeshCheckout() auto-detect, root = cwd
// This fixes the doc/impl drift where `local` was unconditionally overwritten by the auto-detect.
export async function computeVerifyResult({
  repo, version, anchored, anchoredOrLocal, ledgerUrl, nodesUrl, manifestsUrl,
  local, localDir, human = false,
  preloadedEvents = null,
}) {
  const explicitLocal = local === true || localDir !== undefined && localDir !== null;
  const useLocal = explicitLocal ? true : isRepoMeshCheckout();
  const root = explicitLocal ? (localDir || process.cwd()) : process.cwd();
  const opts = { local: useLocal, root, ledgerUrl, nodesUrl, manifestsUrl };

  if (human) progress("1/4", "Loading events...");
  let events;
  if (preloadedEvents) {
    events = preloadedEvents;
  } else {
    try {
      events = await loadEvents(opts);
    } catch (e) {
      const isTimeout = e.message?.includes('Timeout') || e.message?.includes('timeout') || e.message?.includes('AbortError');
      const isNetwork = e.message?.includes('fetch') || e.message?.includes('ENOTFOUND');
      const msg = isNetwork || isTimeout
        ? `Network unavailable. Use --local with a local ledger clone for offline verification. (${e.message})`
        : e.message;
      const hint = isTimeout
        ? "Try --local with a local ledger clone, or set REPOMESH_FETCH_TIMEOUT"
        : isNetwork ? "Check your network connection, or use --local with a local ledger clone" : undefined;
      if (human) {
        console.error(`Error: ${msg}`);
        if (hint) console.error(`Hint: ${hint}`);
      }
      // FC1: a load/network failure is an environment error -> exit 2, not a trust FAIL.
      return { result: { ok: false, repo, version, error: msg, ...(hint ? { hint } : {}) }, status: "ERROR" };
    }
  }

  if (events.length === 0) {
    if (human) console.error("Error: No ledger events found.");
    // FC1: empty/unreachable ledger is a usage/environment error -> exit 2.
    return { result: { ok: false, repo, version, error: "No ledger events found.", hint: "Verify the ledger URL, or use --local inside a RepoMesh checkout." }, status: "ERROR" };
  }

  const result = { ok: true, repo, version, release: null, attestations: [], anchor: null, gate: null };

  if (human) {
    console.log(`\nVerifying release: ${repo}@${version}`);
    console.log(`  Mode: ${useLocal ? "local (dev)" : "remote"}`);
    console.log(`  Anchored check: ${anchored ? "yes" : "no"}\n`);
  }

  // 1. Find ReleasePublished event
  const release = events.find(ev =>
    ev.type === "ReleasePublished" && ev.repo === repo && ev.version === version
  );
  if (!release) {
    if (human) console.error(`  ReleasePublished event not found for ${repo}@${version}`);
    // FC1: a missing release is a usage error (wrong --repo/--version) -> exit 2.
    return { result: { ok: false, repo, version, error: `ReleasePublished not found for ${repo}@${version}`, hint: "Check the --repo and --version values, and confirm the release has been broadcast to the ledger." }, status: "ERROR" };
  }

  result.release = {
    timestamp: release.timestamp,
    commit: release.commit,
    artifacts: (release.artifacts || []).length,
    canonicalHash: release.signature?.canonicalHash,
  };

  // 2. Verify signature (D1: repo-bound)
  if (human) progress("2/4", "Discovering keys...");
  if (!release?.signature?.keyId) {
    // FC1: a release broadcast without any signature is a hard trust defect -> FAIL (exit 1).
    const reason = "release event missing signature or keyId";
    const hint = "The release was broadcast without a signature. Re-broadcast it signed by the repo's registered key.";
    if (human) console.error(`  Release event missing signature or keyId`);
    return {
      result: {
        ok: false, repo, version, error: `Release event missing signature or keyId`, hint,
        gate: { status: "FAIL", failures: [{ check: "signature.chain", reason, hint }] },
      },
      status: "FAIL",
    };
  }
  if (human) progress("3/4", "Verifying signature...");
  const sigResult = await verifySignature(release, opts);
  result.release.signatureValid = sigResult.ok;
  result.release.signerNode = sigResult.ok ? sigResult.nodeId : null;
  result.release.keyId = release.signature.keyId;

  if (!sigResult.ok) {
    result.ok = false;
    result.release.signatureReason = sigResult.reason;
    if (sigResult.hint) result.release.hint = sigResult.hint;
    // B-OBS-01: a signature failure is the headline UNVERIFIED cause — record it in the gate
    // failures[] too so a CI consumer reading result.gate.failures sees it (not only release.*).
    result.gate = {
      status: "FAIL",
      failures: [{
        check: "signature.chain",
        reason: sigResult.reason,
        hint: sigResult.hint || "The release signature did not verify. Confirm the signing key is registered under the release repo's node.json.",
      }],
    };
    if (human) {
      console.error(`    Signature: FAILED (${sigResult.reason})`);
      if (sigResult.hint) console.error(`    Hint: ${sigResult.hint}`);
      console.log(`\n  Verification: FAIL — ${sigResult.reason}\n`);
    }
    // FC1: an invalid/forged release signature is a hard trust FAIL -> exit 1.
    return { result, status: "FAIL" };
  }

  const releaseSignerNode = sigResult.nodeId;

  if (human) {
    console.log(`  Release event found: ${release.timestamp}`);
    console.log(`    Commit:    ${release.commit}`);
    console.log(`    Artifacts: ${(release.artifacts || []).length}`);
    console.log(`    Signature: VALID (keyId=${release.signature.keyId}, node=${releaseSignerNode})`);
  }

  // 3. Index + verify attestations, select LATEST per (type, signerNode) — CLI-003.
  const rawAttestations = events.filter(ev =>
    ev.type === "AttestationPublished" && ev.repo === repo && ev.version === version
  );

  // Map: type -> Map(signerNode -> { result, signatureValid, timestamp, signerNode })
  const byType = new Map();
  const independentSigners = new Set();

  for (const att of rawAttestations) {
    const sigOk = await verifySignature(att, opts);
    const signerNode = sigOk.ok ? sigOk.nodeId : null;
    const ts = att.timestamp || "";
    const types = new Set((att.attestations || []).map(a => a.type));
    for (const t of types) {
      // result is encoded in notes like "type: pass|warn|fail — ..."
      const noteMatch = att.notes?.match(/^([^:]+):\s*(pass|warn|fail)/);
      const attResult = noteMatch ? noteMatch[2] : "unknown";
      const signerKey = signerNode || `__invalid__${att.signature?.keyId || "?"}`;
      if (!byType.has(t)) byType.set(t, new Map());
      const perSigner = byType.get(t);
      const prev = perSigner.get(signerKey);
      // LATEST timestamp wins per (type, signer).
      if (!prev || ts > prev.timestamp) {
        perSigner.set(signerKey, { result: attResult, signatureValid: sigOk.ok, timestamp: ts, signerNode });
      }
      if (sigOk.ok && signerNode && signerNode !== releaseSignerNode) {
        independentSigners.add(signerNode);
      }
    }
  }

  // Flatten the selected (latest-per-signer) attestations for reporting.
  const selected = [];
  for (const [type, perSigner] of byType) {
    for (const [, sel] of perSigner) {
      selected.push({ type, ...sel });
    }
  }
  result.attestations = selected.map(s => ({
    type: s.type, result: s.result, signatureValid: s.signatureValid, signerNode: s.signerNode,
  }));

  if (human) {
    console.log(`\n  Attestations (${result.attestations.length} selected, latest-per-signer):`);
    for (const a of result.attestations) {
      console.log(`    ${a.signatureValid ? "VALID" : "FAIL"}  ${a.type}: ${a.result}${a.signerNode ? ` (${a.signerNode})` : ""}`);
    }
  }

  // 4. Attestation GATE driven by the repo trust profile (D5 — headline CLI-001 + CLI-003).
  const profileId = loadProfileId(repo, opts);
  const profileDef = loadProfileDef(profileId);
  const required = requiredAttestationTypes(profileDef);

  const gate = {
    profile: profileId,
    requiredTypes: required,
    satisfied: [],
    failures: [],
    independentAttestors: [...independentSigners],
    status: "PASS",
  };

  // For each required attestation type: must be PRESENT, with a selected result `pass`
  // AND signatureValid:true from at least one signer. Any selected fail/invalid -> fail.
  for (const type of required) {
    // `signature.chain` is satisfied STRUCTURALLY by a valid release signature that
    // chains to a key registered under the release's own repo (D1) — the release's own
    // signature IS the signature chain. It does not require a separate attestation event.
    // (An explicit signature.chain attestation, if present, is still honored below.)
    if (type === "signature.chain" && result.release.signatureValid && !byType.has(type)) {
      gate.satisfied.push(type);
      continue;
    }
    const perSigner = byType.get(type);
    if (!perSigner || perSigner.size === 0) {
      // B-OBS-01: every failure carries `check` (machine-readable) + `reason` + `hint` (how to
      // fix). `type` is retained for backward compatibility with existing consumers/tests.
      const reason = "missing";
      gate.failures.push({ check: type, type, reason, hint: hintForFailure({ type, reason }) });
      continue;
    }
    let anyPass = false;
    let anyHardFail = false;
    for (const [, sel] of perSigner) {
      if (!sel.signatureValid) { anyHardFail = true; continue; }
      if (sel.result === "fail") { anyHardFail = true; continue; }
      if (sel.result === "pass") anyPass = true;
    }
    if (anyHardFail) {
      const reason = "selected attestation failed or has invalid signature";
      gate.failures.push({ check: type, type, reason, hint: hintForFailure({ type, reason }) });
    } else if (anyPass) {
      gate.satisfied.push(type);
    } else {
      const reason = "no passing attestation (warn/unknown only)";
      gate.failures.push({ check: type, type, reason, hint: hintForFailure({ type, reason }) });
    }
  }

  // Also surface any selected attestation (even non-required) that is a hard fail.
  for (const a of result.attestations) {
    if (a.signatureValid && a.result === "fail") {
      const reason = "attestation result=fail";
      gate.failures.push({ check: a.type, type: a.type, reason, hint: hintForFailure({ type: a.type, reason }) });
    }
  }

  // Independence (D5): a release needs >=1 INDEPENDENT witness — either an attestation
  // signed by a node other than the release signer, OR a verified on-chain anchor (the
  // XRPL anchor account is itself an independent third party). A release with only a
  // self-signature and no independent witness is UNVERIFIED, never PASS.
  //
  // Hard failures (missing/failing required attestations, failing attestations) are FAIL
  // regardless of independence. The independence decision is finalized AFTER the anchor
  // step so a baseline self-signed release + verified anchor can legitimately PASS.
  const hasIndependentAttestor = independentSigners.size > 0;

  if (gate.failures.length > 0) {
    gate.status = "FAIL";
    result.ok = false;
  }

  result.gate = gate;

  if (human) {
    console.log(`\n  Trust gate (profile=${profileId}): ${gate.status === "FAIL" ? "FAIL" : "(pending independence/anchor)"}`);
    if (required.length) console.log(`    Required: ${required.join(", ")}`);
    if (gate.satisfied.length) console.log(`    Satisfied: ${gate.satisfied.join(", ")}`);
    for (const f of gate.failures) {
      console.log(`    MISSING/FAILED: ${f.type} (${f.reason})`);
      if (f.hint) console.log(`      Hint: ${f.hint}`);
    }
    console.log(`    Independent attestors: ${hasIndependentAttestor ? [...independentSigners].join(", ") : "NONE"}`);
  }

  // 5. Anchor verification (D4)
  if (human) progress("4/4", "Checking anchor...");
  let anchorXrplVerified = false;
  // D18: tracks whether the anchor EVENT carried a valid signature from a bundled trusted
  // attestor/anchor node. The --anchored-or-local witness path requires this so a forged
  // (non-trusted-signer) anchor cannot flip UNVERIFIED->PASS.
  let anchorSignerTrusted = false;
  if (anchored) {
    const releaseHash = release.signature.canonicalHash;
    if (human) {
      console.log(`\n  Anchor verification:`);
      console.log(`    Release canonicalHash: ${releaseHash}`);
    }

    const anchorResult = await findAnchorForHash(events, releaseHash, opts);
    if (!anchorResult) {
      // CLI-002: --anchored claimed but no anchor -> fail closed.
      const reason = "no anchor partition contains this release";
      const hint = "This release has not been anchored to the XRPL ledger yet. Drop --anchored, or wait for the next anchor cycle.";
      result.ok = false;
      result.anchor = { anchored: false, reason, hint };
      result.gate.status = "UNVERIFIED";
      result.gate.failures.push({ check: "anchor", reason: `anchor-not-found: ${reason}`, hint });
      if (human) {
        console.error(`    NOT anchored: ${reason} (--anchored requires a verified anchor)`);
        console.error(`    Hint: ${hint}`);
        console.log(`\n  Verification: UNVERIFIED — ${reason}\n`);
      }
      // FC1: anchor-not-found is the soft UNVERIFIED path -> exit 3 (default).
      return { result, status: "UNVERIFIED" };
    }

    const { anchor: anchorEvent, manifest, meta, leaves } = anchorResult;

    // D18: the anchor EVENT itself (an AttestationPublished signed by the xrpl-anchor node) must
    // carry a valid signature from a node in the bundled trusted attestor/anchor set. verifySignature
    // runs the third-party path, which already enforces the D12 allowlist + kind — so an unsigned or
    // locally-forged anchor (signed by a non-allowlisted key) resolves to no key and is NOT trusted.
    // This anchorSignerTrusted flag gates whether the anchor may be credited as an independent
    // witness below (so --anchored-or-local cannot flip UNVERIFIED->PASS on a forged anchor).
    const anchorSig = await verifySignature(anchorEvent, opts);
    anchorSignerTrusted = anchorSig.ok &&
      BUNDLED_TRUSTED_ATTESTORS.includes(anchorSig.nodeId);
    // B-OBS-03: when the anchor event's signature fails / its signer is not allowlisted, capture
    // WHY so result.anchor can surface it. A trusted signer leaves this null.
    let anchorSignerReason = null;
    if (!anchorSignerTrusted) {
      anchorSignerReason = !anchorSig.ok
        ? `anchor event signature invalid: ${anchorSig.reason}`
        : `anchor signed by non-allowlisted node ${anchorSig.nodeId}`;
    }

    // 5a. Manifest hash integrity.
    const { manifestHash: mh, ...base } = manifest;
    const recomputedMh = crypto.createHash("sha256").update(canonicalize(base), "utf8").digest("hex");
    if (recomputedMh !== mh) {
      result.ok = false;
      const reason = "manifest hash does not match its contents";
      const hint = "The anchor manifest is internally inconsistent (its declared manifestHash does not match its body). Do not trust this anchor.";
      result.anchor = { anchored: true, manifestValid: false, reason, hint };
      // FC1: a self-inconsistent anchor manifest is tampering -> hard FAIL (exit 1).
      result.gate.status = "FAIL";
      result.gate.failures.push({ check: "anchor.manifest", reason, hint });
      if (human) {
        console.error(`    ManifestHash: MISMATCH`);
        console.error(`    Hint: ${hint}`);
      }
      return { result, status: "FAIL" };
    }

    // 5b. D4 step 2: recompute the Merkle root from leaves (algo-dispatched) and assert == manifest.root.
    // B-FP-01: distinguish a future/unknown algo (this CLI can't verify it — "upgrade") from a
    // genuine root MISMATCH (which implies tampering). An unsupported algo is reported as its
    // own failure cause and never masqueraded as a tamper MISMATCH.
    if (!isSupportedMerkleAlgo(manifest.algo)) {
      const reason = `unsupported merkle algo ${manifest.algo} — upgrade CLI`;
      const hint = `This release was anchored with merkle algorithm '${manifest.algo}', which this version of repomesh cannot recompute. Upgrade: npm install -g @mcptoolshop/repomesh@latest`;
      result.ok = false;
      result.anchor = { anchored: true, manifestValid: true, algo: manifest.algo, unsupportedAlgo: true, reason, hint };
      result.gate.status = "UNVERIFIED";
      result.gate.failures.push({ check: "anchor.merkle", reason, hint });
      if (human) {
        console.error(`    Merkle root: ${reason}`);
        console.error(`    Hint: ${hint}`);
        console.log(`\n  Verification: UNVERIFIED — ${reason}\n`);
      }
      // FC1: an unverifiable (future) algo is the soft UNVERIFIED path -> exit 3.
      return { result, status: "UNVERIFIED" };
    }
    let recomputedRoot = null;
    try {
      recomputedRoot = merkleRootForAlgo(leaves, manifest.algo);
    } catch (e) { debugLog(`merkle recompute failed: ${e.message}`); }
    const rootMatch = recomputedRoot === manifest.root;
    if (!rootMatch) {
      result.ok = false;
      const reason = "recomputed merkle root does not match the manifest root";
      const hint = "The anchored leaves do not reproduce the manifest's root. The ledger may have been altered, or this is the wrong partition. Do not trust this release.";
      result.anchor = { anchored: true, manifestValid: true, rootMatch: false, reason, hint };
      // FC1: a root mismatch is tampering -> hard FAIL (exit 1).
      result.gate.status = "FAIL";
      result.gate.failures.push({ check: "anchor.merkle", reason, hint });
      if (human) {
        console.error(`    Merkle root: MISMATCH (recomputed != manifest.root)`);
        console.error(`    Hint: ${hint}`);
      }
      return { result, status: "FAIL" };
    }

    // 5c. D4 step 3/4: XRPL on-chain verification when txHash present + online.
    let xrplVerified = false;
    let xrplReason = null;
    // Offline is forced by either env name — REPOMESH_FORCE_OFFLINE (the standardized name) or the
    // legacy REPOMESH_OFFLINE used by tools/verify-release.mjs — so both CLI copies honor the same
    // operator signal regardless of which one is set (LOW: env-var unification across copies).
    const forceOffline = process.env.REPOMESH_FORCE_OFFLINE === "1" || process.env.REPOMESH_OFFLINE === "1";
    if (meta.txHash && !forceOffline) {
      try {
        const xr = await verifyAnchorTx({
          tx: meta.txHash,
          network: meta.network || manifest.network || "testnet",
          expect: { r: manifest.root, h: manifest.manifestHash, c: leaves.length },
          opts,
        });
        xrplVerified = xr.ok;
        if (!xr.ok) xrplReason = xr.reason;
      } catch (e) {
        xrplReason = `XRPL fetch failed: ${e.message}`;
        debugLog(xrplReason);
      }
    } else if (meta.txHash) {
      xrplReason = "offline (XRPL NOT verified)";
    } else {
      xrplReason = "no txHash in anchor (local-manifest-only)";
    }
    anchorXrplVerified = xrplVerified;

    result.anchor = {
      anchored: true, manifestValid: true, rootMatch: true,
      partition: manifest.partitionId, root: manifest.root,
      manifestHash: manifest.manifestHash,
      txHash: meta.txHash || null, network: meta.network || null,
      xrplVerified,
      signerTrusted: anchorSignerTrusted, // D18: anchor event signed by a bundled trusted node
      // B-OBS-03: when the anchor signer is NOT trusted, surface exactly why (invalid sig vs
      // non-allowlisted node). A trusted signer omits this field.
      ...(anchorSignerReason ? { signerReason: anchorSignerReason } : {}),
      ...(anchorSig.ok ? { signerNode: anchorSig.nodeId } : {}),
      ...(xrplReason ? { xrplReason } : {}),
    };

    // Strict --anchored requires real on-chain verification. Without it (offline or
    // tx invalid), it is a FAIL unless --anchored-or-local relaxes the requirement.
    if (!xrplVerified && !anchoredOrLocal) {
      const hint = "Re-run online for on-chain XRPL verification, or use --anchored-or-local to accept the locally-recomputed manifest.";
      result.ok = false;
      result.gate.status = "UNVERIFIED";
      result.gate.failures.push({ check: "anchor.xrpl", reason: `XRPL not verified: ${xrplReason || "offline"}`, hint });
      if (human) {
        console.error(`    anchored: local-manifest-only (XRPL NOT verified${xrplReason ? `: ${xrplReason}` : ""})`);
        console.error(`    Hint: ${hint}`);
        console.log(`\n  Verification: UNVERIFIED — XRPL not verified${xrplReason ? `: ${xrplReason}` : ""}\n`);
      }
      // FC1: strict --anchored without on-chain verification is the soft UNVERIFIED path -> exit 3.
      return { result, status: "UNVERIFIED" };
    }

    if (human) {
      console.log(`    Partition:    ${manifest.partitionId}`);
      console.log(`    Root:         ${manifest.root} (recomputed MATCH)`);
      console.log(`    ManifestHash: VERIFIED`);
      if (meta.txHash) console.log(`    XRPL tx:      ${meta.txHash} (${xrplVerified ? "VERIFIED on-chain" : "NOT verified"})`);
    }
  }

  // 6. Finalize the gate verdict now that anchor status is known.
  if (gate.status !== "FAIL") {
    // An anchor counts as an independent witness when it is XRPL-verified (the trusted XRPL
    // anchor ACCOUNT is the independent third party — D4), OR when the operator explicitly
    // accepted a locally-recomputed anchor via --anchored-or-local AND the anchor EVENT was
    // signed by a bundled trusted attestor/anchor node (D18). A forged/unsigned anchor whose
    // local manifest happens to recompute is NOT a witness — it cannot flip UNVERIFIED->PASS.
    const anchorWitness = anchorXrplVerified ||
      (anchoredOrLocal && result.anchor?.rootMatch === true && anchorSignerTrusted === true);
    const hasIndependentWitness = hasIndependentAttestor || anchorWitness;
    if (!hasIndependentWitness) {
      // No independent attestor AND no on-chain-verified anchor -> UNVERIFIED, never PASS.
      gate.status = "UNVERIFIED";
      result.ok = false;
      // B-OBS-01: record the precise independence cause so a CI consumer reading gate.failures
      // sees WHY it's UNVERIFIED. If an anchor was checked but its signer wasn't trusted, name
      // that (B-OBS-03 reason flows through here too); otherwise it's simply no witness at all.
      const anchorReason = result.anchor?.signerReason;
      gate.failures.push(anchorReason
        ? {
            check: "independence",
            reason: `no independent witness — ${anchorReason}`,
            hint: "The anchor signer is not a trusted RepoMesh attestor node, so it cannot witness this release. Wait for a trusted on-chain anchor, or obtain an independent attestation.",
          }
        : {
            check: "independence",
            reason: "no independent witness (self-signed only; no trusted attestation or verified anchor)",
            hint: "A release needs at least one independent witness. Obtain an attestation signed by a trusted RepoMesh attestor, or verify it with --anchored once it is anchored on-chain.",
          });
    } else {
      gate.status = "PASS";
    }
  }
  result.gate = gate;

  // Final human output (text format only). The structured emit (json/sarif/markdown) and the
  // process exit are the caller's responsibility (verifyRelease / verifyAll).
  if (human) {
    if (anchored && result.anchor?.anchored) {
      const a = result.anchor;
      if (a.xrplVerified) {
        console.log(`\n  Anchored: YES (partition=${a.partition}, tx=${a.txHash}, XRPL-verified)`);
      } else {
        console.log(`\n  Anchored: local-manifest-only (XRPL NOT verified)`);
      }
    } else if (anchored) {
      console.log(`\n  Anchored: NO`);
    }
    // B-OBS-02: print the cause inline with the final verdict, not only buried earlier. For a
    // non-PASS verdict the first gate failure is the headline reason an operator should see.
    if (gate.status === "PASS") {
      console.log(`\n  Verification: PASS\n`);
    } else {
      const primary = (gate.failures && gate.failures[0]) || null;
      const cause = primary ? (primary.reason || primary.check) : "no independent witness";
      console.log(`\n  Verification: ${gate.status} — ${cause}`);
      if (primary?.hint) console.log(`  Hint: ${primary.hint}`);
      console.log("");
    }
  }

  return { result, status: gate.status };
}

// --- Single emit path (FC4) ----------------------------------------------
// All non-text structured formats flow through here. text is emitted progressively inside
// computeVerifyResult (human=true), so emit() handles only json/sarif/markdown.
export function emitResult(result, format) {
  if (format === "json") { emitJson(result); return; }
  if (format === "sarif") { emitJson(buildSarif(result)); return; }
  if (format === "markdown") { console.log(buildMarkdown(result)); return; }
  // text: nothing to do here — already printed progressively.
}

// --- The verify-release command wrapper (FC1 + FC4 + FC3) ----------------
// Backwards-compatible signature: still accepts `json`. New: `format`, `failOn`, `local`,
// `localDir`. Computes the result, emits in the chosen format, then exits with the FC1 code.
export async function verifyRelease(args = {}) {
  const failOn = normalizeFailOn(args.failOn);
  const format = normalizeFormat({ format: args.format, json: args.json });
  const human = format === "text";

  const { result, status } = await computeVerifyResult({
    repo: args.repo,
    version: args.version,
    anchored: args.anchored,
    anchoredOrLocal: args.anchoredOrLocal,
    ledgerUrl: args.ledgerUrl,
    nodesUrl: args.nodesUrl,
    manifestsUrl: args.manifestsUrl,
    local: args.local,
    localDir: args.localDir,
    human,
  });

  // Single structured emit path (text already printed progressively above).
  emitResult(result, format);

  // FC1: with --fail-on=fail, an UNVERIFIED status is success — print a warning so the operator
  // sees the status didn't change, only the gate severity.
  if (status === "UNVERIFIED" && failOn === "fail" && human) {
    console.error("Warning: status is UNVERIFIED but --fail-on=fail treats it as success (exit 0).");
  }

  process.exit(exitCodeForStatus(status, failOn));
}
