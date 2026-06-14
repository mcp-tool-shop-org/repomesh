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
import { fileURLToPath } from "node:url";
import { execSync, execFileSync } from "node:child_process";
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

// SEC-004: token-parse the buildCommand against an allowed verb set rather than relying on an
// exhaustive literal allowlist (which silently rejected the SHIPPED config
// `npm ci && npm run build && npm pack`, leaving the repro verifier permanently at warn=15pts).
// A command is allowed iff it is a sequence of "&&"-joined steps where each step's program +
// (for npm/yarn/pnpm) subcommand is on the allowed set. Shell metacharacters other than the
// step separators are rejected outright — no injection surface widens here (the command still runs
// via execFileSync ["sh","-c", cmd] in a throwaway container).
const ALLOWED_BUILD_STEPS = new Set([
  "npm run build", "npm ci", "npm install", "npm pack",
  "make", "make build", "make all",
  "yarn build", "yarn install", "yarn pack",
  "pnpm build", "pnpm install", "pnpm pack", "pnpm run build",
]);

export function isBuildCommandAllowed(buildCommand) {
  if (typeof buildCommand !== "string" || buildCommand.trim() === "") return false;
  // Reject any shell metacharacter beyond the "&&" step separator.
  if (/[;|`$<>(){}\n\r&]/.test(buildCommand.replace(/&&/g, ""))) return false;
  const steps = buildCommand.split("&&").map(s => s.trim()).filter(Boolean);
  if (steps.length === 0) return false;
  return steps.every(step => ALLOWED_BUILD_STEPS.has(step.replace(/\s+/g, " ")));
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

  // STGB-VER-006: the three pre-fix "warn" outcomes are structurally different and must not collapse
  // into one token. The two CAN'T-RUN cases below (no artifact hashes to compare; Docker unavailable)
  // are NON-SCORING per the unscored doctrine \u2014 we never ran a real comparison, so they earn 0
  // assurance ('unscored'), not partial 'warn' credit. Only the actual comparison branch downstream
  // emits 'warn' (real partial: some matched, some not-found/non-deterministic) or 'fail' (mismatch).
  // Each path carries a DISTINCT machine-readable reason + a human hint.
  const releaseArtifacts = rel.artifacts || [];
  if (releaseArtifacts.length === 0) {
    const reason = "no-artifact-hashes";
    const hint = "Publish the release with artifact hashes (artifacts[].sha256) so a rebuild can be compared; with nothing to compare, repro is non-scoring.";
    const ev0 = buildAttestationEvent({
      repo,
      version,
      commit: rel.commit,
      artifacts: releaseArtifacts,
      attestations: [{ type: "repro.build", uri: "repomesh:attestor:repro.build:unscored" }],
      notes: `repro.build: unscored \u2014 no artifact hashes to compare in ReleasePublished event.\n${JSON.stringify({ reason, hint })}`
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  \u26A0\uFE0F repro.build: no artifact hashes to compare (non-scoring)`);
    return { result: "unscored", reason, hint };
  }

  if (!isDockerAvailable()) {
    const reason = "docker-unavailable";
    const hint = "Install/start Docker on the verifier host (or run the verifier where Docker is available); without a container we cannot rebuild, so repro is non-scoring.";
    const ev0 = buildAttestationEvent({
      repo,
      version,
      commit: rel.commit,
      artifacts: releaseArtifacts,
      attestations: [{ type: "repro.build", uri: "repomesh:attestor:repro.build:unscored" }],
      notes: `repro.build: unscored \u2014 Docker not available; cannot rebuild artifacts for comparison.\n${JSON.stringify({ reason, hint })}`
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  \u26A0\uFE0F repro.build: Docker not available, skipping rebuild (non-scoring)`);
    return { result: "unscored", reason, hint };
  }

  const cfg = loadConfig();
  const nonDetExts = new Set(cfg.allowNonDeterministicExtensions || []);
  const algo = cfg.hashAlgorithm || "sha256";

  // SEC-004: validate the buildCommand against the allowed verb set BEFORE doing any work. A
  // rejected command is NON-SCORING (we cannot attest reproducibility), not warn=15pts.
  if (!isBuildCommandAllowed(cfg.buildCommand)) {
    const ev0 = buildAttestationEvent({
      repo, version, commit: rel.commit,
      artifacts: releaseArtifacts,
      attestations: [{ type: "repro.build", uri: "repomesh:attestor:repro.build:unscored" }],
      notes: `repro.build: unscored — buildCommand not in allowlist: ${cfg.buildCommand}`
    });
    const signed = sign ? signEvent(ev0, loadSigningKeyFromEnvOrFile({ filePath: signingKeyPath }), keyId) : ev0;
    if (out) writeJsonlLine(out, signed);
    console.log(`  ⚠️ repro.build: buildCommand not in allowlist (non-scoring): ${cfg.buildCommand}`);
    return { result: "unscored", reason: "build command not in allowlist" };
  }

  // Create temp dir and clone the repo at the release tag
  const tmpBase = fs.mkdtempSync(path.join((process.env.TMPDIR || process.env.TEMP || "/tmp"), "repro-"));
  const cloneDir = path.join(tmpBase, "source");

  let result = "fail";
  let reason = "";
  let details = {};
  let nonScoring = false;

  try {
    // Validate repo format to prevent command injection (R-F-001)
    const REPO_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
    if (!REPO_RE.test(repo)) {
      throw new Error(`Invalid repo format: ${repo}`);
    }

    // Clone at tag
    console.error(`[repro] Cloning repository ${repo}@v${version}...`);
    try {
      execFileSync("git", [
        "clone", "--depth", "1", "--branch", `v${version}`,
        `https://github.com/${repo}.git`, cloneDir
      ], { stdio: "pipe", timeout: 120000 });
    } catch (cloneErr) {
      const e = new Error(`git clone failed for ${repo}@v${version}: ${String(cloneErr.message || cloneErr).slice(0, 300)}`);
      e.nonScoring = true;
      throw e;
    }

    // Run build in container using execFileSync to avoid shell injection (R-F-003).
    // SEC-004: a build/clone failure is a NON-SCORING outcome (cannot confirm reproducibility),
    // not a warn that still earns points. We tag the error so the outer handler emits "unscored".
    console.error(`[repro] Building in Docker image ${cfg.dockerImage}...`);
    try {
      execFileSync("docker", [
        "run", "--rm",
        "-v", `${cloneDir}:/w`,
        "-w", "/w",
        cfg.dockerImage,
        "sh", "-c", cfg.buildCommand
      ], { stdio: "pipe", timeout: 600000 });
    } catch (dockerErr) {
      const e = new Error(`Docker build failed for ${repo}@v${version} in ${cfg.dockerImage}: ${String(dockerErr.message || dockerErr).slice(0, 300)}`);
      e.nonScoring = true;
      throw e;
    }

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

    // STGB-VER-006: these are the REAL comparison outcomes (a rebuild actually ran). Distinct reason
    // codes per outcome so they never read like the can't-run 'unscored' cases above:
    //   fail  -> "hash-mismatch"       (a deterministic artifact rebuilt to a different hash)
    //   warn  -> "partial-comparison"  (everything compared matched, but some artifacts were
    //                                    not-found-in-rebuild or skipped as non-deterministic)
    //   pass  -> all deterministic artifacts matched
    if (mismatched > 0) {
      result = "fail";
      details.reasonCode = "hash-mismatch";
      details.hint = "A deterministic artifact rebuilt to a different hash — the published artifact is NOT reproducible from source; investigate the build before trusting it.";
      reason = `${mismatched} artifact(s) have mismatched hashes`;
    } else if (notFound > 0 || skippedNonDet > 0) {
      result = "warn";
      details.reasonCode = "partial-comparison";
      details.hint = `${notFound} artifact(s) were not produced by the rebuild and ${skippedNonDet} were skipped as non-deterministic; everything that COULD be compared matched. Reduce non-deterministic outputs or align the build to compare them all.`;
      reason = `${matched} matched, ${notFound} not found, ${skippedNonDet} non-deterministic (skipped)`;
    } else {
      result = "pass";
      details.reasonCode = "all-match";
      reason = `All ${matched} artifact hash(es) match the rebuild`;
    }
  } catch (err) {
    // SEC-004 + STGB-VER-006: a build/clone failure (or any error before a real comparison could
    // complete) means reproducibility could NOT be confirmed — that is a CAN'T-RUN case, which is
    // non-scoring, never 'warn'. We tag clone/build failures explicitly (err.nonScoring); any other
    // unexpected error before the comparison loop finished is likewise non-scoring (we have no real
    // comparison result to report). Distinct reason code so it doesn't read like a partial match.
    nonScoring = Boolean(err.nonScoring);
    result = "unscored";
    const reasonCode = err.nonScoring ? "build-or-clone-failed" : "rebuild-error";
    reason = `Build/clone failed: ${String(err.message || err).slice(0, 200)}`;
    details = {
      reasonCode,
      hint: "The rebuild could not complete (clone, container build, or comparison errored), so reproducibility is unconfirmed and non-scoring; fix the build/host and re-run.",
      error: String(err.message || err).slice(0, 500),
    };
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
  const icon = result === "pass" ? "\u2705" : (result === "warn" || result === "unscored") ? "\u26A0\uFE0F" : "\u274C";
  console.log(`  ${icon} repro.build: ${reason}`);
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

// Exported for tests: runOne is exported so the can't-run -> 'unscored' paths (STGB-VER-006) are
// testable end-to-end with a temp ledger. isBuildCommandAllowed is already exported above.
export { runOne };

// --- main (only when invoked directly, not when imported by tests) ---
function main() {
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
