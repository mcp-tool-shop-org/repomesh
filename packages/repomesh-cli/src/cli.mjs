#!/usr/bin/env node
// @mcptoolshop/repomesh — Trust infrastructure for repo networks.
// CLI entrypoint.
import { Command, Option } from "commander";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { requireRepoMeshCheckout } from "./mode.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));

// STGB-CLI-002/003: the exit-code contract for CI gating.
//   0 = PASS/verified · 1 = trust FAIL (tamper/invalid) · 2 = operator/usage/environment ERROR · 3 = UNVERIFIED
// A usage/parse error (missing/unknown flag, typo'd enum value) is an OPERATOR error, never a
// trust FAIL — it must exit 2. Commander's default is exit 1 and it ignores --json, so we take
// over its error path: exitOverride() makes parse failures THROW (caught below) instead of
// exiting 1, and configureOutput() suppresses commander's own stderr when --json is requested so
// the structured JSON error is the only thing a machine consumer sees.
const wantsJsonOutput = () => process.argv.includes("--json");

const program = new Command();

program
  .name("repomesh")
  .description("Trust infrastructure for repo networks — verify releases, check anchors, onboard repos.")
  .version(pkg.version, "-V, --cli-version")
  .option("-q, --quiet", "Suppress informational output")
  .option("--verbose", "Show verbose output")
  .option("--debug", "Show debug output with stack traces")
  .option("--no-color", "Disable ANSI colors and emoji (also respects NO_COLOR env)")
  // STGB-CLI-002: take over commander's exit/error path so a parse error becomes a catchable
  // throw (classified to exit 2 below) instead of commander's default exit 1.
  .exitOverride()
  .configureOutput({
    // Suppress commander's plaintext error line when --json is requested; the structured JSON
    // error (emitted in the catch handler) is then the ONLY thing a machine consumer reads.
    outputError: (str, write) => { if (!wantsJsonOutput()) write(str); },
  });

// STGB-CLI-003: enum flags must be validated against their allowed set, not silently coerced.
// commander's .choices() rejects an unknown value with a clear "Allowed choices are ..." message
// (a CommanderError -> exit 2 via the catch below) instead of passing a typo through to a
// downstream switch that falls back to a default (producing empty stdout for a JSON consumer).
const FORMAT_CHOICES = ["text", "json", "sarif", "markdown"];
const FAIL_ON_CHOICES = ["unverified", "fail"];
const NETWORK_CHOICES = ["testnet", "mainnet", "devnet"];
const formatOption = (def = "text") =>
  new Option("--format <fmt>", "Output format: text (default), json, sarif, markdown").choices(FORMAT_CHOICES).default(def);
const failOnOption = () =>
  new Option("--fail-on <level>", "Which verdict is non-zero: 'unverified' (strict, default) or 'fail' (UNVERIFIED -> exit 0)").choices(FAIL_ON_CHOICES).default("unverified");
const networkOption = () =>
  new Option("--network <net>", "Network: testnet, mainnet, devnet").choices(NETWORK_CHOICES).default("testnet");

// STGB-CLI-001 (observability): emit the remote-revocation legibility warning when a verification
// is revocation-sensitive AND remote AND lacks the on-chain --anchored witness. Routed to stderr
// (NOT stdout) so a --json consumer's single-blob stdout stays clean; suppressed under --quiet.
// `-q`/--quiet is a GLOBAL flag, so read it from process.argv (works before/independent of the
// per-command parse).
async function emitRemoteRevocationWarning({ local, anchored, ledgerUrl, nodesUrl, manifestsUrl }) {
  if (process.argv.includes("--quiet") || process.argv.includes("-q")) return;
  const { deriveRemoteRevocationWarning } = await import("./remote-defaults.mjs");
  const { warn, lines } = deriveRemoteRevocationWarning({ local, anchored, ledgerUrl, nodesUrl, manifestsUrl });
  if (!warn) return;
  for (const line of lines) console.error(line);
}

// --- User commands (work anywhere) ---

program
  .command("verify-release")
  .description(
    "Verify a release's trust chain and anchor status.\n" +
    "  Note: Each verification fetches remote data. Use --local with a local clone for repeated/offline use.\n" +
    "  Exit codes: 0=PASS, 1=FAIL (forged/invalid/tampered), 3=UNVERIFIED (not-yet-anchored / no independent witness),\n" +
    "              2=usage error or crash. --fail-on=fail relaxes UNVERIFIED to exit 0."
  )
  .requiredOption("--repo <org/repo>", "Target repository")
  .requiredOption("--version <semver>", "Release version")
  .option("--anchored", "Also verify XRPL anchor inclusion (strict: requires on-chain XRPL verification)")
  .option("--anchored-or-local", "Like --anchored but accept a locally-recomputed manifest when XRPL is unreachable (XRPL NOT verified)")
  .option("--local [dir]", "Verify against a LOCAL ledger checkout (default: current dir). Offline/dev path; wins over auto-detect.")
  .addOption(failOnOption())
  .addOption(formatOption())
  .option("--json", "Output structured JSON (alias for --format json)")
  .option("--ledger-url <url>", "Custom ledger events URL (defaults to public GitHub ledger; use --local for offline)")
  .option("--nodes-url <url>", "Custom nodes base URL (defaults to public GitHub ledger; use --local for offline)")
  .option("--manifests-url <url>", "Custom manifests base URL (defaults to public GitHub ledger; use --local for offline)")
  .action(async (opts) => {
    const { verifyRelease } = await import("./verify/verify-release.mjs");
    // commander: --local with no value yields `true`; --local <dir> yields the string.
    const localProvided = opts.local !== undefined;
    const localDir = typeof opts.local === "string" ? opts.local : undefined;
    const anchored = opts.anchored || opts.anchoredOrLocal;
    // STGB-CLI-001: warn (to stderr) when this revocation-sensitive verification is remote and has
    // no on-chain witness, so the operator knows the local revocation defenses are inert here.
    await emitRemoteRevocationWarning({
      local: localProvided, anchored,
      ledgerUrl: opts.ledgerUrl, nodesUrl: opts.nodesUrl, manifestsUrl: opts.manifestsUrl,
    });
    await verifyRelease({
      repo: opts.repo,
      version: opts.version,
      // --anchored-or-local implies anchored (anchor inclusion is checked, on-chain step relaxed).
      anchored,
      anchoredOrLocal: opts.anchoredOrLocal,
      local: localProvided ? true : undefined,
      localDir,
      failOn: opts.failOn,
      format: opts.format,
      json: opts.json,
      ledgerUrl: opts.ledgerUrl,
      nodesUrl: opts.nodesUrl,
      manifestsUrl: opts.manifestsUrl,
    });
  });

program
  .command("verify-all")
  .description(
    "Batch-verify many releases against ONE ledger load.\n" +
    "  Source: --manifest <file> (JSON array of {repo,version} or 'org/repo@version' lines) OR --from-registry (trust.json).\n" +
    "  Exit code = the WORST row's verdict under --fail-on (0=all PASS, 1=any FAIL, 3=any UNVERIFIED, 2=usage error)."
  )
  .option("--manifest <file>", "A JSON array of {repo,version}, or a newline list of org/repo@version")
  .option("--from-registry", "Verify every release listed in registry/trust.json")
  .option("--anchored", "Also verify XRPL anchor inclusion for every release")
  .option("--anchored-or-local", "Accept a locally-recomputed manifest when XRPL is unreachable")
  .option("--local [dir]", "Verify against a LOCAL ledger checkout (default: current dir)")
  .addOption(failOnOption())
  .addOption(formatOption())
  .option("--json", "Output structured JSON (alias for --format json)")
  .option("--ledger-url <url>", "Custom ledger events URL")
  .option("--trust-url <url>", "Custom trust.json URL (for --from-registry remote mode)")
  .action(async (opts) => {
    const { verifyAll } = await import("./verify/verify-all.mjs");
    const localProvided = opts.local !== undefined;
    const localDir = typeof opts.local === "string" ? opts.local : undefined;
    await verifyAll({
      manifest: opts.manifest,
      fromRegistry: opts.fromRegistry,
      anchored: opts.anchored || opts.anchoredOrLocal,
      anchoredOrLocal: opts.anchoredOrLocal,
      local: localProvided ? true : undefined,
      localDir,
      failOn: opts.failOn,
      format: opts.format,
      json: opts.json,
      ledgerUrl: opts.ledgerUrl,
      trustUrl: opts.trustUrl,
    });
  });

program
  .command("verify-anchor")
  .description("Verify an XRPL anchor transaction")
  .requiredOption("--tx <hash>", "XRPL transaction hash")
  .addOption(networkOption())
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
  .description(
    "Generate onboarding files for a repo joining RepoMesh.\n" +
    "  Separation of duties (TUF §6.1): pass --second-key to ALSO mint+register a distinct second\n" +
    "  maintainer key so one key can sign the other's revocation. A single-key node still works but\n" +
    "  surfaces the >=2-key recommendation."
  )
  .requiredOption("--repo <org/repo>", "Target repository")
  .option("--profile <id>", "Trust profile: baseline (minimal), open-source (recommended), regulated (strict compliance)", "open-source")
  .option("--dir <path>", "Target directory", ".")
  .option("--keyid <id>", "Signing key ID")
  .option("--second-key", "Also mint + register a DISTINCT second maintainer key (separation of duties, TUF §6.1)")
  .option("--second-keyid <id>", "Explicit keyId for the second key (default: derived, distinct from the first)")
  .option("--no-pr", "Skip PR instructions")
  .option("--json", "Output structured JSON summary (suppresses decorative output)")
  .action(async (opts) => {
    const { init } = await import("./init.mjs");
    await init({
      repo: opts.repo,
      profile: opts.profile,
      dir: opts.dir,
      keyId: opts.keyid,
      secondKey: opts.secondKey === true,
      secondKeyId: opts.secondKeyid,
      noPr: opts.pr === false,
      json: opts.json,
    });
  });

program
  .command("keygen")
  .description(
    "Mint a DISTINCT ed25519 maintainer keypair (separation of duties: register >=2 keys so one\n" +
    "  can sign the other's revocation — TUF §6.1). Prints the PUBLIC key + keyId in node.json\n" +
    "  maintainer shape, ready to paste. The PRIVATE key is a SECRET: by default it is printed once\n" +
    "  with a loud warning and written NOWHERE; pass --out <file> to persist it (0600). NEVER commit it."
  )
  .requiredOption("--repo <org/repo>", "Repo the key is for (used to derive the keyId)")
  .option("--keyid <id>", "Explicit keyId (must match node.schema.json maintainer.keyId); default derived from --repo")
  .option("--name <name>", "maintainer.name for the paste-ready block (default: org segment of --repo)")
  .option("--out <path>", "Write the PRIVATE key PEM to this file (0600). Omit to print it once instead. NEVER a git-tracked path.")
  .option("--json", "Output structured JSON (keyId, publicKey, maintainer block); private key flagged as a secret")
  .action(async (opts) => {
    const { generateKeyMaterial } = await import("./key/keygen.mjs");
    const res = generateKeyMaterial({ repo: opts.repo, keyId: opts.keyid, name: opts.name, privateKeyOut: opts.out });
    if (opts.json) {
      // The private key IS surfaced for the operator, but explicitly flagged. We never write it to a
      // path unless --out was given, and we tell the consumer that.
      console.log(JSON.stringify({
        ok: true,
        keyId: res.keyId,
        publicKey: res.publicKey,
        maintainer: res.maintainer,
        privateKey: res.privateKey,
        privateKeyWritten: res.privateKeyWritten,
        secretWarning: "privateKey is a SECRET — store it in your shell/secret manager; NEVER commit or log it.",
      }, null, 2));
    } else {
      // Human mode: loud secret warning to stderr, paste-ready public block to stdout.
      console.error("");
      console.error("⚠ SECURITY: the PRIVATE key below is a SECRET. Store it securely (e.g. a GitHub Actions secret");
      console.error("  or your secret manager). NEVER commit it, never log it, never paste it into node.json.");
      console.log(`\nkeyId: ${res.keyId}\n`);
      console.log("--- node.json maintainer block (PUBLIC — safe to paste) ---");
      console.log(JSON.stringify(res.maintainer, null, 2));
      console.log("\n--- PUBLIC KEY (PEM) ---");
      console.log(res.publicKey);
      if (res.privateKeyWritten) {
        console.error(`\n✅ Private key written to ${res.privateKeyWritten} (mode 0600). Move it to a secret store; do not commit.`);
      } else {
        console.error("\n--- PRIVATE KEY (SECRET — shown once, store it now) ---");
        console.error(res.privateKey);
        console.error("--- end private key ---");
      }
      console.error("\nSeparation of duties: register this as a SECOND maintainer key so one key can sign the other's revocation (TUF §6.1).");
    }
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

// --- key lifecycle (rotate / revoke) — writes to a LOCAL ledger checkout ---
//
// These build + sign + append a KeyRotation/KeyRevocation event AND apply the matching
// node.json maintainer-window edit, so validate-ledger's binding check passes. They write
// ONLY to the local ledger/node files you point them at (--local <dir> / --dir <dir>,
// default cwd); they NEVER broadcast to the real network. Use --dry-run to preview.
//
// Signing key: --signing-key-id sets signature.keyId; the private PEM comes from
// --signing-key-file, --signing-key, or the REPOMESH_SIGNING_KEY env var.
//   rotate -> sign with the RETIRING key (proves possession) or a trustedPolicy node's key.
//   revoke -> sign with a SURVIVING same-node key or a trustedPolicy node's key.
const keyCmd = program
  .command("key")
  .description(
    "Key lifecycle: rotate or revoke a maintainer key (writes to a LOCAL ledger checkout).\n" +
    "  Builds + signs + appends a KeyRotation/KeyRevocation event AND applies the matching\n" +
    "  node.json maintainer-window edit. Local-only — never broadcasts. Use --dry-run to preview."
  );

function runKey(action) {
  return async (opts) => {
    const { keyCommand } = await import("./key/rotate-revoke.mjs");
    const explicitLocal = opts.local !== undefined;
    const root = (typeof opts.local === "string" && opts.local) || opts.dir || process.cwd();
    const result = keyCommand({
      action,
      repo: opts.repo,
      root,
      dryRun: !!opts.dryRun,
      signingKeyId: opts.signingKeyId,
      signingKey: opts.signingKey,
      signingKeyFile: opts.signingKeyFile,
      timestamp: opts.timestamp,
      // rotate
      retiringKeyId: opts.retiringKeyId,
      newKeyId: opts.newKeyId,
      newPublicKey: opts.newPublicKey,
      newPublicKeyFile: opts.newPublicKeyFile,
      effectiveAt: opts.effectiveAt,
      // revoke
      revokedKeyId: opts.revokedKeyId,
      reason: opts.reason,
      invalidAfter: opts.invalidAfter,
    });
    void explicitLocal;
    if (opts.json) {
      console.log(JSON.stringify(result));
    } else if (result.dryRun) {
      console.log(`--- DRY RUN: key ${action} ${result.repo} (nothing written) ---`);
      console.log(JSON.stringify(result.event, null, 2));
      console.log(`\nWould append event to: ${result.eventsPath}`);
      console.log(`Would edit node.json:  ${result.nodePath}`);
    } else {
      console.log(`Key ${action} emitted for ${result.repo}`);
      console.log(`  appended event -> ${result.eventsPath}`);
      console.log(`  edited node    -> ${result.nodePath}`);
    }
  };
}

keyCmd
  .command("rotate")
  .description(
    "Rotate a maintainer key: retire the old key (prospective) and mint a new one.\n" +
    "  node.json effect: retiring key gets validUntil/revokedAt = effectiveAt, reason=rotation;\n" +
    "  new key appended with validFrom = effectiveAt. Past signatures of the retiring key stay valid."
  )
  .requiredOption("--repo <org/repo>", "Target repository whose node.json holds the maintainer")
  .requiredOption("--retiring-key-id <id>", "keyId of the key being retired (must exist in node.json)")
  .requiredOption("--new-key-id <id>", "keyId of the new key being minted")
  .option("--new-public-key <pem>", "PEM string of the new public key")
  .option("--new-public-key-file <path>", "File containing the new public key PEM")
  .option("--effective-at <iso>", "Rotation moment (ISO 8601 date-time); defaults to now")
  .requiredOption("--signing-key-id <id>", "keyId recorded in signature.keyId (rotate: the retiring key, or a trustedPolicy key)")
  .option("--signing-key-file <path>", "Private key PEM file to sign with (or set REPOMESH_SIGNING_KEY)")
  .option("--signing-key <pem>", "Private key PEM string to sign with (prefer the file/env form)")
  .option("--local [dir]", "Local ledger checkout root (default: current dir)")
  .option("--dir <path>", "Alias for the local ledger root")
  .option("--timestamp <iso>", "Override the event timestamp (ISO 8601); defaults to now")
  .option("--dry-run", "Compute + sign but write nothing; print the event and target paths")
  .option("--json", "Output structured JSON")
  .action(runKey("rotate"));

keyCmd
  .command("revoke")
  .description(
    "Revoke a maintainer key (reason-dispatched).\n" +
    "  node.json effect: revoked key gets revokedAt = timestamp, revocationReason = reason, and\n" +
    "  (reason=compromise) invalidAfter = the RFC 5280 invalidity date (defaults to revokedAt)."
  )
  .requiredOption("--repo <org/repo>", "Target repository whose node.json holds the maintainer")
  .requiredOption("--revoked-key-id <id>", "keyId of the key being revoked (must exist in node.json)")
  .requiredOption("--reason <reason>", "Revocation reason: rotation | compromise | retirement")
  .option("--invalid-after <iso>", "RFC 5280 invalidity date (ISO 8601); required for compromise (defaults to timestamp)")
  .requiredOption("--signing-key-id <id>", "keyId recorded in signature.keyId (revoke: a surviving same-node key, or a trustedPolicy key)")
  .option("--signing-key-file <path>", "Private key PEM file to sign with (or set REPOMESH_SIGNING_KEY)")
  .option("--signing-key <pem>", "Private key PEM string to sign with (prefer the file/env form)")
  .option("--local [dir]", "Local ledger checkout root (default: current dir)")
  .option("--dir <path>", "Alias for the local ledger root")
  .option("--timestamp <iso>", "Override the event timestamp (ISO 8601); defaults to now")
  .option("--dry-run", "Compute + sign but write nothing; print the event and target paths")
  .option("--json", "Output structured JSON")
  .action(runKey("revoke"));

// --- Shell completion ---

program
  .command("completion")
  .description("Output shell completion script (bash/zsh)")
  .option("--shell <shell>", "Shell type: bash, zsh", "bash")
  .action((opts) => {
    const commands = ["verify-release", "verify-all", "verify-anchor", "init", "keygen", "doctor", "key", "completion",
      "build-pages", "build-registry", "build-badges", "build-snippets"];
    const globalFlags = "--quiet --verbose --debug --json --format --fail-on --local --help --cli-version";
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

// STGB-CLI-002/003: classify a thrown error into the exit-code contract and emit it the right
// way for the requested format. A commander parse/usage/invalid-choice error is an OPERATOR
// error -> exit 2 (NEVER 1, which means a trust FAIL). Help/version are commander "errors" with
// exitCode 0 — those already printed and just exit 0. Anything else is an unexpected internal
// error (also exit 2 — a usage/environment problem, distinct from a trust verdict).
function hintForCommanderError(e) {
  switch (e.code) {
    case "commander.missingMandatoryOptionValue":
    case "commander.missingArgument":
      return "Provide the required option. Run 'repomesh <command> --help' to see required flags.";
    case "commander.unknownOption":
      return "Remove the unknown flag (check for a typo). Run 'repomesh <command> --help' for the valid flags.";
    case "commander.unknownCommand":
      return "Unknown command. Run 'repomesh --help' to list available commands.";
    case "commander.invalidArgument":
      // commander's message already names the allowed choices for an enum.
      return "Use one of the allowed values shown in the message. Run 'repomesh <command> --help'.";
    case "commander.optionMissingArgument":
      return "This flag needs a value. Run 'repomesh <command> --help' for the expected argument.";
    default:
      return "Run 'repomesh <command> --help' for usage.";
  }
}

// Run
program.parseAsync(process.argv).catch(e => {
  const isCommanderError = e?.name === "CommanderError" || (typeof e?.code === "string" && e.code.startsWith("commander."));

  // Help/version: commander already wrote its output and uses exitCode 0. Pass it through.
  if (isCommanderError && e.exitCode === 0) {
    process.exit(0);
  }

  // Strip commander's "error: " prefix so our message/JSON stays clean.
  const rawMessage = (e?.message || String(e)).replace(/^error:\s*/i, "");
  const code = isCommanderError ? (e.code || "commander.usageError") : "internal.error";
  const hint = e?.hint || (isCommanderError ? hintForCommanderError(e) : "Run with --debug for a full stack trace.");

  if (wantsJsonOutput()) {
    // STGB-CLI-002: a JSON consumer must get a structured error shape, never empty stdout or a
    // raw plaintext line. {code,message,hint} on stdout; commander's own stderr was suppressed.
    console.log(JSON.stringify({ ok: false, code, message: rawMessage, hint }, null, 2));
  } else if (process.argv.includes("--debug")) {
    console.error(e);
  } else {
    console.error(`Error: ${rawMessage}`);
    if (hint) console.error(`Hint: ${hint}`);
    console.error("Run with --debug for full stack trace.");
  }
  process.exit(2);
});
