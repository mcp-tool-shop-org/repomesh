#!/usr/bin/env node
/**
 * Offline lint helper for validating whether a change set modifies only the
 * three broadcast-appended ledger files as regular 100644 git blobs.
 *
 * NOTE: This script is NOT a merge control. Same-repo PRs execute their own
 * workflow definitions and skipped jobs report success on required checks;
 * merge protection relies on base-branch .github/CODEOWNERS and repository
 * ruleset settings. Unit tests run this helper inside the existing `test` job.
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

/**
 * Evaluate whether a change set contains only valid 100644 ledger event updates.
 *
 * @param {object} input
 * @param {number} input.changedFilesCount
 * @param {Array<{filename: string, status: string, previous_filename?: string}>} input.files
 * @param {Record<string, {mode: string, type?: string}>} input.headTreeEntries
 * @param {boolean} [input.treeTruncated]
 * @param {string} [input.expectedHeadSha]
 * @param {string} [input.actualHeadSha]
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function evaluateEventPathGuard(input) {
  const reasons = [];

  if (!input || typeof input !== "object") {
    return { ok: false, reasons: ["Guard input payload must be an object"] };
  }

  const {
    changedFilesCount,
    files,
    headTreeEntries,
    treeTruncated = false,
    expectedHeadSha,
    actualHeadSha,
  } = input;

  if (expectedHeadSha && actualHeadSha && expectedHeadSha !== actualHeadSha) {
    reasons.push(`Head SHA moved during evaluation (${expectedHeadSha} != ${actualHeadSha})`);
  }

  if (!Number.isInteger(changedFilesCount) || changedFilesCount < 0) {
    reasons.push(`Invalid changed_files count: ${String(changedFilesCount)}`);
  }

  if (!Array.isArray(files)) {
    reasons.push("Missing changed-files array");
  } else {
    if (files.length === 0) {
      reasons.push("Reported zero changed files (fail-closed)");
    }
    if (files.length >= MAX_PR_FILES || (Number.isInteger(changedFilesCount) && changedFilesCount >= MAX_PR_FILES)) {
      reasons.push(`File count hits list cap (${MAX_PR_FILES}); fail-closed`);
    }
    if (Number.isInteger(changedFilesCount) && files.length !== changedFilesCount) {
      reasons.push(`Listed file count (${files.length}) does not match changed_files (${changedFilesCount})`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
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
      reasons.push("File entry missing filename");
      continue;
    }

    if (status === "renamed" || (typeof previousFilename === "string" && previousFilename.length > 0)) {
      reasons.push(`Disallowed rename in event lint: ${previousFilename || "<unknown>"} -> ${filename}`);
    }

    if (!ALLOWED_PATH_SET.has(filename)) {
      reasons.push(`Disallowed path outside event ledger set: ${filename}`);
    }

    if (typeof previousFilename === "string" && previousFilename.length > 0 && !ALLOWED_PATH_SET.has(previousFilename)) {
      reasons.push(`Disallowed previous path outside event ledger set: ${previousFilename}`);
    }

    if (status === "removed") {
      reasons.push(`Disallowed removal of path in event lint: ${filename}`);
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

  return { ok: reasons.length === 0, reasons };
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
