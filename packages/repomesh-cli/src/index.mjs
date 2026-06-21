// @mcptoolshop/repomesh — STABLE PROGRAMMATIC API (the library surface).
//
// This is the package's public, semver-stable entry point. The published `exports` map in
// package.json points at the built copy of this file (dist/index.mjs — the build copies src/ to
// dist/ verbatim, see scripts/build.mjs). Consumers integrate the verification engine directly:
//
//     import { verifyRelease, computeVerifyResult, exitCodeForStatus } from "@mcptoolshop/repomesh";
//
// while the `repomesh` CLI (bin -> dist/cli.mjs) remains a thin frontend over these same functions.
//
// STABILITY CONTRACT
//   Everything RE-EXPORTED here is part of the public API and follows semver: breaking changes to
//   any of these signatures require a MAJOR bump. The underlying src/verify/* modules are internal
//   implementation detail — import from "@mcptoolshop/repomesh", NOT from deep paths. Symbols not
//   surfaced here (internal helpers, the CLI emit/arg plumbing) are explicitly NOT part of the API.
//
// This module only RE-EXPORTS; it owns no logic of its own. The single source of truth for each
// function stays in its home module so the CLI and the library never diverge.

// --- Core verification engine ---------------------------------------------------------------
//   verifyRelease(args)        -> verify ONE release; emits the structured blob + returns the result.
//   computeVerifyResult(args)  -> the pure-ish core: returns { result, status } and never exits.
export { verifyRelease, computeVerifyResult } from "./verify/verify-release.mjs";

//   verifyAll(args)            -> batch-verify many releases against ONE ledger load (FC5).
export { verifyAll } from "./verify/verify-all.mjs";

// --- Output / exit-code contract ------------------------------------------------------------
//   buildSarif(results)        -> SARIF 2.1.0 envelope (single result or array). [] -> empty run.
//   exitCodeForStatus(status, failOn?) -> the FC1 exit-code map (PASS 0 / FAIL 1 / ERROR 2 / UNVERIFIED 3).
export { buildSarif, exitCodeForStatus } from "./verify/format.mjs";

// --- Key-lifecycle trust predicate (the shared stable secret, contract §5) ------------------
//   isKeyValidForSignature(maintainer, trustedTime) -> { valid, reason }  (PURE).
//   keyWindow(maintainer)      -> the normalized key window  (PURE).
export { isKeyValidForSignature, keyWindow } from "./verify/key-window.mjs";

// --- On-chain anchor verification -----------------------------------------------------------
//   verifyAnchorTx({ tx, network, ... }) -> verify an XRPL anchor transaction; returns a result
//   object (never exits) so a library consumer can compose it.
export { verifyAnchorTx } from "./verify/verify-anchor.mjs";
