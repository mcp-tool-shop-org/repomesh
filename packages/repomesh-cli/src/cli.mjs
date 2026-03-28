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
  .version(pkg.version, "-V, --cli-version")
  .option("-q, --quiet", "Suppress informational output")
  .option("--verbose", "Show verbose output")
  .option("--debug", "Show debug output with stack traces")
  .option("--no-color", "Disable ANSI colors and emoji (also respects NO_COLOR env)");

// --- User commands (work anywhere) ---

program
  .command("verify-release")
  .description("Verify a release's trust chain and anchor status.\n  Note: Each verification fetches remote data. Use --local with a local clone for repeated/offline use.")
  .requiredOption("--repo <org/repo>", "Target repository")
  .requiredOption("--version <semver>", "Release version")
  .option("--anchored", "Also verify XRPL anchor inclusion")
  .option("--json", "Output structured JSON")
  .option("--ledger-url <url>", "Custom ledger events URL (defaults to public GitHub ledger; use --local for offline)")
  .option("--nodes-url <url>", "Custom nodes base URL (defaults to public GitHub ledger; use --local for offline)")
  .option("--manifests-url <url>", "Custom manifests base URL (defaults to public GitHub ledger; use --local for offline)")
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
  .option("--profile <id>", "Trust profile: baseline (minimal), open-source (recommended), regulated (strict compliance)", "open-source")
  .option("--dir <path>", "Target directory", ".")
  .option("--keyid <id>", "Signing key ID")
  .option("--no-pr", "Skip PR instructions")
  .option("--json", "Output structured JSON summary (suppresses decorative output)")
  .action(async (opts) => {
    const { init } = await import("./init.mjs");
    await init({
      repo: opts.repo,
      profile: opts.profile,
      dir: opts.dir,
      keyId: opts.keyid,
      noPr: opts.pr === false,
      json: opts.json,
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

// --- Shell completion ---

program
  .command("completion")
  .description("Output shell completion script (bash/zsh)")
  .option("--shell <shell>", "Shell type: bash, zsh", "bash")
  .action((opts) => {
    const commands = ["verify-release", "verify-anchor", "init", "doctor", "completion",
      "build-pages", "build-registry", "build-badges", "build-snippets"];
    const globalFlags = "--quiet --verbose --debug --json --help --cli-version";
    if (opts.shell === "zsh") {
      console.log(`#compdef repomesh
_repomesh() {
  local -a commands
  commands=(${commands.map(c => `'${c}:${c} command'`).join(" ")})
  _arguments '1:command:->cmds' '*::arg:->args'
  case $state in
    cmds) _describe 'command' commands ;;
    args) _arguments '*:flags:(${globalFlags})' ;;
  esac
}
compdef _repomesh repomesh`);
    } else {
      console.log(`# bash completion for repomesh
_repomesh() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local commands="${commands.join(" ")}"
  local flags="${globalFlags}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
  else
    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
  fi
}
complete -F _repomesh repomesh`);
    }
  });

// --- Dev commands (require RepoMesh checkout) ---

// Security: static allowlist prevents command injection via dev command names
const DEV_COMMAND_ALLOWLIST = new Set(["build-pages", "build-registry", "build-badges", "build-snippets"]);
const devCommands = [...DEV_COMMAND_ALLOWLIST];
for (const cmd of devCommands) {
  program
    .command(cmd)
    .description(`[dev] Run ${cmd} (requires RepoMesh checkout)`)
    .action(async () => {
      requireRepoMeshCheckout(cmd);
      if (!DEV_COMMAND_ALLOWLIST.has(cmd)) {
        console.error(`Error: Unknown dev command: ${cmd}`);
        process.exit(1);
      }
      const { execFileSync } = await import("node:child_process");
      // Security: use execFileSync with array args to avoid shell interpolation
      execFileSync("node", ["tools/repomesh.mjs", cmd], { stdio: "inherit", cwd: process.cwd() });
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
