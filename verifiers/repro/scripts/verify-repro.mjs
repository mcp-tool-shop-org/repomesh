#!/usr/bin/env node
// RepoMesh Reproducibility Verifier — Rebuilds release artifacts in a container and compares hashes.
//
// Usage:
//   node verify-repro.mjs --repo org/repo --version 1.2.3
//   node verify-repro.mjs --scan-new
//   node verify-repro.mjs --scan-new --sign --output /tmp/repro.jsonl

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import {
  readEvents,
  findReleaseEvent,
  hasAttestationEvent,
  buildAttestationEvent,
  parseArgs,
  signEvent,
  writeJsonlLine,
  loadSigningKeyFromEnvOrFile
} from "../../lib/common.mjs";

function loadConfig() {
  const p = path.join(process.cwd(), "verifiers/repro/config.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function isDockerAvailable() {
  try {
    execSync("docker --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hashFile(filePath, algorithm) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash(algorithm).update(data).digest("hex");
}

function hashDirectory(dirPath, algorithm, extensions) {
  const hashes = {};
  if (!fs.existsSync(dirPath)) return hashes;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      hashes[entry.name] = hashFile(fullPath, algorithm);
    }
  }
  return hashes;
}

function findPackedArtifacts(workDir) {
  // Look for .tgz files produced by npm pack
  const files = [];
  const entries = fs.readdirSync(workDir);
  for (const name of entries) {
    if (name.endsWith(".tgz") || name.endsWith(".tar.gz")) {
      files.push({ name, path: path.join(workDir, name) });
    }
  }
  return files;
}

async function runOne({ repo, version, sign, keyId, signingKeyPath, out }) {
  const events = readEvents();
  const rel = findReleaseEvent(events, repo, version);
  if (!rel) throw new Error(`No ReleasePublished found for ${repo}@${version}`);

  if (hasAttestationEvent(events, repo, version, "repro.build") && String(sign) !== "force") {
    return { skipped: true, reason: "already attested (repro.build)" };
  }

  const releaseArtifacts = rel.artifacts || [];
  if (releaseArtifacts.length === 0) {
    const ev0 = buildAttestationEvent({
      repo,
      version,
      commit: rel.commit,
      artifacts: releaseArtifacts,
      attestations: [{ type: "repro.build", uri: "repomesh:attestor:repro.build:warn" }],
      notes: "repro.build: warn \u2014 no artifact hashes to compare in ReleasePublished event."
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  \u26A0\uFE0F repro.build: no artifact hashes to compare`);
    return { result: "warn", reason: "no artifacts" };
  }

  if (!isDockerAvailable()) {
    const ev0 = buildAttestationEvent({
      repo,
      version,
      commit: rel.commit,
      artifacts: releaseArtifacts,
      attestations: [{ type: "repro.build", uri: "repomesh:attestor:repro.build:warn" }],
      notes: "repro.build: warn \u2014 Docker not available; cannot rebuild artifacts for comparison."
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  \u26A0\uFE0F repro.build: Docker not available, skipping rebuild`);
    return { result: "warn", reason: "docker unavailable" };
  }

  const cfg = loadConfig();
  const nonDetExts = new Set(cfg.allowNonDeterministicExtensions || []);
  const algo = cfg.hashAlgorithm || "sha256";

  // Create temp dir and clone the repo at the release tag
  const tmpBase = fs.mkdtempSync(path.join((process.env.TMPDIR || process.env.TEMP || "/tmp"), "repro-"));
  const cloneDir = path.join(tmpBase, "source");

  let result = "fail";
  let reason = "";
  let details = {};

  try {
    // Clone at tag
    console.log(`  Cloning ${repo}@v${version}...`);
    execSync(
      `git clone --depth 1 --branch "v${version}" "https://github.com/${repo}.git" "${cloneDir}"`,
      { stdio: "pipe", timeout: 120000 }
    );

    // Run build in container
    console.log(`  Building in ${cfg.dockerImage}...`);
    const dockerCmd = [
      "docker", "run", "--rm",
      "-v", `"${cloneDir}:/w"`,
      "-w", "/w",
      cfg.dockerImage,
      "sh", "-c", `"${cfg.buildCommand}"`
    ].join(" ");

    execSync(dockerCmd, { stdio: "pipe", timeout: 600000 });

    // Find rebuilt artifacts
    const rebuiltArtifacts = findPackedArtifacts(cloneDir);
    const rebuiltHashes = {};
    for (const art of rebuiltArtifacts) {
      rebuiltHashes[art.name] = hashFile(art.path, algo);
    }

    // Compare hashes
    let matched = 0;
    let mismatched = 0;
    let skippedNonDet = 0;
    let notFound = 0;
    const comparisons = [];

    for (const relArt of releaseArtifacts) {
      const ext = path.extname(relArt.name);
      if (nonDetExts.has(ext)) {
        skippedNonDet++;
        comparisons.push({ name: relArt.name, status: "skipped-non-deterministic" });
        continue;
      }

      const rebuiltHash = rebuiltHashes[relArt.name];
      if (!rebuiltHash) {
        // Try matching by extension pattern (e.g. the .tgz from npm pack)
        const tgzRebuilt = Object.entries(rebuiltHashes).find(([k]) => k.endsWith(".tgz"));
        if (relArt.name.endsWith(".tgz") && tgzRebuilt) {
          if (tgzRebuilt[1] === relArt.sha256) {
            matched++;
            comparisons.push({ name: relArt.name, status: "match", rebuiltAs: tgzRebuilt[0] });
          } else {
            mismatched++;
            comparisons.push({
              name: relArt.name, status: "mismatch",
              expected: relArt.sha256, actual: tgzRebuilt[1], rebuiltAs: tgzRebuilt[0]
            });
          }
        } else {
          notFound++;
          comparisons.push({ name: relArt.name, status: "not-found-in-rebuild" });
        }
      } else {
        if (rebuiltHash === relArt.sha256) {
          matched++;
          comparisons.push({ name: relArt.name, status: "match" });
        } else {
          mismatched++;
          comparisons.push({
            name: relArt.name, status: "mismatch",
            expected: relArt.sha256, actual: rebuiltHash
          });
        }
      }
    }

    details = {
      totalReleaseArtifacts: releaseArtifacts.length,
      rebuiltArtifacts: rebuiltArtifacts.length,
      matched,
      mismatched,
      skippedNonDet,
      notFound,
      comparisons: comparisons.slice(0, 10)
    };

    if (mismatched > 0) {
      result = "fail";
      reason = `${mismatched} artifact(s) have mismatched hashes`;
    } else if (notFound > 0 || skippedNonDet > 0) {
      result = "warn";
      reason = `${matched} matched, ${notFound} not found, ${skippedNonDet} non-deterministic (skipped)`;
    } else {
      result = "pass";
      reason = `All ${matched} artifact hash(es) match the rebuild`;
    }
  } catch (err) {
    result = "warn";
    reason = `Build/clone failed: ${String(err.message || err).slice(0, 200)}`;
    details = { error: String(err.message || err).slice(0, 500) };
  } finally {
    // Clean up temp dir
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch { /* best effort cleanup */ }
  }

  const detailsJson = JSON.stringify(details);

  const ev = buildAttestationEvent({
    repo,
    version,
    commit: rel.commit,
    artifacts: releaseArtifacts,
    attestations: [{ type: "repro.build", uri: `repomesh:attestor:repro.build:${result}` }],
    notes: `repro.build: ${result} \u2014 ${reason}\n${detailsJson}`
  });

  const signed = sign ? signEvent(ev, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev;
  if (out) writeJsonlLine(out, signed);
  console.log(`  ${result === "pass" ? "\u2705" : result === "warn" ? "\u26A0\uFE0F" : "\u274C"} repro.build: ${reason}`);
  return { result, details };
}

async function scanNew({ sign, keyId, signingKeyPath, out }) {
  const events = readEvents();
  const releases = events.filter(e => e?.type === "ReleasePublished");
  const targets = [];

  for (const rel of releases) {
    if (!hasAttestationEvent(events, rel.repo, rel.version, "repro.build")) {
      targets.push({ repo: rel.repo, version: rel.version });
    }
  }

  if (targets.length === 0) {
    console.log("No releases missing repro.build attestation.");
    return { scanned: 0, results: [] };
  }

  console.log(`Found ${targets.length} release(s) to verify.\n`);
  const results = [];
  for (const t of targets) {
    console.log(`Verifying: ${t.repo}@${t.version}`);
    results.push(await runOne({ ...t, sign, keyId, signingKeyPath, out }));
  }
  return { scanned: targets.length, results };
}

// --- main ---
const args = parseArgs(process.argv);
const repo = args.repo;
const version = args.version;
const scanNewFlag = args["scan-new"];
const out = args.output || null;
const sign = Boolean(args.sign);
const keyId = args.keyId || process.env.REPOMESH_KEY_ID || "ci-repomesh-2026";
const signingKeyPath = args["signing-key"] || null;

if (scanNewFlag) {
  scanNew({ sign, keyId, signingKeyPath, out })
    .then(r => {
      console.log(`\n${r.scanned} release(s) verified.`);
      if (out) console.log(`Output written to ${out}`);
    })
    .catch(e => { console.error(e); process.exit(1); });
} else {
  if (!repo || !version) {
    console.error("Usage:");
    console.error("  node verify-repro.mjs --repo <org/repo> --version <semver>");
    console.error("  node verify-repro.mjs --scan-new [--sign --output <path>]");
    process.exit(2);
  }
  runOne({ repo, version, sign, keyId, signingKeyPath, out })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
