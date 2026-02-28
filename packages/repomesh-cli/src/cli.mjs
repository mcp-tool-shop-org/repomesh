#!/usr/bin/env node
// @mcptoolshop/repomesh — Trust infrastructure for repo networks.
// CLI entrypoint.
import { Command } from "commander";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { requireRepoMeshCheckout } from "./mode.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));

const program = new Command();

program
  .name("repomesh")
  .description("Trust infrastructure for repo networks — verify releases, check anchors, onboard repos.")
  .version(pkg.version, "-V, --cli-version");

// --- User commands (work anywhere) ---

program
  .command("verify-release")
  .description("Verify a release's trust chain and anchor status")
  .requiredOption("--repo <org/repo>", "Target repository")
  .requiredOption("--version <semver>", "Release version")
  .option("--anchored", "Also verify XRPL anchor inclusion")
  .option("--json", "Output structured JSON")
  .option("--ledger-url <url>", "Custom ledger events URL")
  .option("--nodes-url <url>", "Custom nodes base URL")
  .option("--manifests-url <url>", "Custom manifests base URL")
  .action(async (opts) => {
    const { verifyRelease } = await import("./verify/verify-release.mjs");
    await verifyRelease({
      repo: opts.repo,
      version: opts.version,
      anchored: opts.anchored,
      json: opts.json,
      ledgerUrl: opts.ledgerUrl,
      nodesUrl: opts.nodesUrl,
      manifestsUrl: opts.manifestsUrl,
    });
  });

program
  .command("verify-anchor")
  .description("Verify an XRPL anchor transaction")
  .requiredOption("--tx <hash>", "XRPL transaction hash")
  .option("--network <net>", "Network: testnet, mainnet, devnet", "testnet")
  .option("--ws-url <url>", "Custom WebSocket URL for XRPL")
  .option("--ledger-url <url>", "Custom ledger events URL")
  .option("--json", "Output structured JSON")
  .action(async (opts) => {
    const { verifyAnchor } = await import("./verify/verify-anchor.mjs");
    await verifyAnchor({
      tx: opts.tx,
      network: opts.network,
      wsUrl: opts.wsUrl,
      ledgerUrl: opts.ledgerUrl,
      json: opts.json,
    });
  });

program
  .command("init")
  .description("Generate onboarding files for a repo joining RepoMesh")
  .requiredOption("--repo <org/repo>", "Target repository")
  .option("--profile <id>", "Trust profile: baseline, open-source, regulated", "open-source")
  .option("--dir <path>", "Target directory", ".")
  .option("--keyid <id>", "Signing key ID")
  .option("--no-pr", "Skip PR instructions")
  .action(async (opts) => {
    const { init } = await import("./init.mjs");
    await init({
      repo: opts.repo,
      profile: opts.profile,
      dir: opts.dir,
      keyId: opts.keyid,
      noPr: opts.pr === false,
    });
  });

program
  .command("doctor")
  .description("Diagnose a local repo's RepoMesh integration")
  .option("--dir <path>", "Target directory", ".")
  .option("--repo <org/repo>", "Expected repo ID (for validation)")
  .option("--json", "Output structured JSON")
  .action(async (opts) => {
    const { doctor } = await import("./doctor.mjs");
    await doctor({ dir: opts.dir, repo: opts.repo, json: opts.json });
  });

// --- Dev commands (require RepoMesh checkout) ---

const devCommands = ["build-pages", "build-registry", "build-badges", "build-snippets"];
for (const cmd of devCommands) {
  program
    .command(cmd)
    .description(`[dev] Run ${cmd} (requires RepoMesh checkout)`)
    .action(async () => {
      requireRepoMeshCheckout(cmd);
      const { execSync } = await import("node:child_process");
      execSync(`node tools/repomesh.mjs ${cmd}`, { stdio: "inherit", cwd: process.cwd() });
    });
}

// Run
program.parseAsync(process.argv).catch(e => {
  if (process.argv.includes("--debug")) {
    console.error(e);
  } else {
    console.error(`Error: ${e.message || e}`);
    if (e.hint) console.error(`Hint: ${e.hint}`);
    console.error("Run with --debug for full stack trace.");
  }
  process.exit(2);
});
