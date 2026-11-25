#!/usr/bin/env node
/**
 * Base-branch pull_request_target guard for ledger PRs.
 * Decision logic operates strictly on plain JSON inputs so unit tests can exercise
 * every rule deterministically offline with zero network calls.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_EVENT_PATHS = Object.freeze([
  "ledger/events/events.jsonl",
  "anchor/xrpl/manifests/all.json",
  "registry/trust.json",
]);

const ALLOWED_PATH_SET = new Set(ALLOWED_EVENT_PATHS);
export const MAX_PR_FILES = 3000;
const EXEMPT_ROLES = new Set(["admin", "maintain"]);

export function isMaintainerRole(roleName) {
  return typeof roleName === "string" && EXEMPT_ROLES.has(roleName);
}

/**
 * Evaluate whether a pull request is permitted under event-path rules.
 *
 * @param {object} input
 * @param {number} input.changedFilesCount
 * @param {Array<{filename: string, status: string, previous_filename?: string}>} input.files
 * @param {Record<string, {mode: string, type?: string}>} input.headTreeEntries
 * @param {boolean} [input.treeTruncated]
 * @param {string} [input.expectedHeadSha]
 * @param {string} [input.actualHeadSha]
 * @param {string} [input.authorLogin]
 * @param {string|null} [input.authorRole]
 * @param {string} [input.senderLogin]
 * @param {string|null} [input.senderRole]
 * @returns {{ ok: boolean, exempted: boolean, reasons: string[] }}
 */
export function evaluateEventPathGuard(input) {
  const reasons = [];

  if (!input || typeof input !== "object") {
    return { ok: false, exempted: false, reasons: ["Guard input payload must be an object"] };
  }

  const {
    changedFilesCount,
    files,
    headTreeEntries,
    treeTruncated = false,
    expectedHeadSha,
    actualHeadSha,
    authorLogin,
    authorRole,
    senderLogin,
    senderRole,
  } = input;

  if (expectedHeadSha && actualHeadSha && expectedHeadSha !== actualHeadSha) {
    reasons.push(`PR head SHA moved during evaluation (${expectedHeadSha} != ${actualHeadSha})`);
  }

  if (!Number.isInteger(changedFilesCount) || changedFilesCount < 0) {
    reasons.push(`Invalid pull_request.changed_files count: ${String(changedFilesCount)}`);
  }

  if (!Array.isArray(files)) {
    reasons.push("Missing PR changed-files array from API");
  } else {
    if (files.length === 0) {
      reasons.push("PR reported zero changed files (fail-closed)");
    }
    if (files.length >= MAX_PR_FILES || (Number.isInteger(changedFilesCount) && changedFilesCount >= MAX_PR_FILES)) {
      reasons.push(`PR file count hits API list cap (${MAX_PR_FILES}); fail-closed`);
    }
    if (Number.isInteger(changedFilesCount) && files.length !== changedFilesCount) {
      reasons.push(`Listed file count (${files.length}) does not match pull_request.changed_files (${changedFilesCount})`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, exempted: false, reasons };
  }

  // Exempt non-ledger paths only when BOTH the PR author and event sender hold admin or maintain.
  if (
    Boolean(authorLogin) &&
    Boolean(senderLogin) &&
    isMaintainerRole(authorRole) &&
    isMaintainerRole(senderRole)
  ) {
    return {
      ok: true,
      exempted: true,
      reasons: [`Maintainer exemption granted for author '${authorLogin}' (${authorRole}) and sender '${senderLogin}' (${senderRole})`],
    };
  }

  if (treeTruncated) {
    reasons.push("Head commit git tree listing was truncated; fail-closed");
  }
  if (!headTreeEntries || typeof headTreeEntries !== "object") {
    reasons.push("Missing head commit tree entries; fail-closed");
  }

  for (const file of files) {
    const filename = file?.filename;
    const status = file?.status;
    const previousFilename = file?.previous_filename;

    if (!filename || typeof filename !== "string") {
      reasons.push("PR file entry missing filename");
      continue;
    }

    if (status === "renamed" || (typeof previousFilename === "string" && previousFilename.length > 0)) {
      reasons.push(`Disallowed rename in event PR: ${previousFilename || "<unknown>"} -> ${filename}`);
    }

    if (!ALLOWED_PATH_SET.has(filename)) {
      reasons.push(`Disallowed path outside event ledger set: ${filename}`);
    }

    if (typeof previousFilename === "string" && previousFilename.length > 0 && !ALLOWED_PATH_SET.has(previousFilename)) {
      reasons.push(`Disallowed previous path outside event ledger set: ${previousFilename}`);
    }

    if (status === "removed") {
      reasons.push(`Disallowed removal of path in event PR: ${filename}`);
    } else if (status !== "modified" && status !== "added" && status !== "renamed") {
      reasons.push(`Disallowed file status '${String(status)}' for ${filename}`);
    }

    if (status !== "removed" && ALLOWED_PATH_SET.has(filename) && headTreeEntries && typeof headTreeEntries === "object") {
      const entry = Object.hasOwn(headTreeEntries, filename) ? headTreeEntries[filename] : null;
      if (!entry) {
        reasons.push(`Missing head git tree entry for allowed path ${filename}`);
      } else {
        if (entry.type !== undefined && entry.type !== "blob") {
          reasons.push(`Disallowed git object type '${entry.type}' for ${filename} (expected blob)`);
        }
        if (entry.mode !== "100644") {
          reasons.push(`Disallowed git file mode '${String(entry.mode)}' for ${filename} (expected 100644)`);
        }
      }
    }
  }

  return { ok: reasons.length === 0, exempted: false, reasons };
}

function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error("Usage: node scripts/ci/event-path-guard.mjs <payload.json>");
    process.exit(2);
  }
  const raw = fs.readFileSync(path.resolve(payloadPath), "utf8");
  const payload = JSON.parse(raw);
  const result = evaluateEventPathGuard(payload);
  for (const r of result.reasons) {
    console.log(result.ok ? `PASS: ${r}` : `FAIL: ${r}`);
  }
  if (result.ok && result.reasons.length === 0) {
    console.log(`PASS: All ${payload.files.length} changed file(s) are regular 100644 blobs within the allowed ledger paths.`);
  }
  process.exit(result.ok ? 0 : 1);
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  main();
}
