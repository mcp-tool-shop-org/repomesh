#!/usr/bin/env node
// Read-only watch. Compares the published rippled release and two amendment flags
// to anchor/xrpl/watch-baseline.json. Prints JSON. Does not submit a transaction.
import fs from "node:fs";
import path from "node:path";
import { rippledBuildWarning } from "../../../packages/repomesh-cli/src/trusted-anchor-accounts.mjs";

const BASELINE_PATH = path.join(import.meta.dirname, "..", "watch-baseline.json");
const CONFIG_PATH = path.join(import.meta.dirname, "..", "config.json");

export function normalizeReleaseTag(tag) {
  return String(tag ?? "").replace(/^v/, "");
}

export function watchDiff(baseline, live) {
  const reasons = [];
  if (live.rippledLatest && live.rippledLatest !== baseline.rippledLatest) {
    reasons.push(`rippled latest is ${live.rippledLatest}; baseline records ${baseline.rippledLatest}`);
  }
  if (typeof live.batchEnabled === "boolean" && live.batchEnabled !== baseline.batchEnabled) {
    reasons.push(`BatchV1_1 enabled is ${live.batchEnabled}; baseline records ${baseline.batchEnabled}`);
  }
  if (typeof live.sponsorEnabled === "boolean" && live.sponsorEnabled !== baseline.sponsorEnabled) {
    reasons.push(`Sponsor enabled is ${live.sponsorEnabled}; baseline records ${baseline.sponsorEnabled}`);
  }
  const buildWarning = rippledBuildWarning(live.buildVersion, baseline.warnFloor);
  return { reasons, buildWarning };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "repomesh-xrpl-watch",
    },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function readBuildVersion(wsUrl) {
  const xrpl = (await import("xrpl")).default;
  const client = new xrpl.Client(wsUrl);
  try {
    await client.connect();
    return { buildVersion: client.buildVersion ?? null, error: null };
  } catch (error) {
    return { buildVersion: null, error: error.message };
  } finally {
    try { await client.disconnect(); } catch { /* already closed */ }
  }
}

async function main() {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const wsUrl = process.env.XRPL_WS_URL || config.rippledUrl;

  const [release, batch, sponsor] = await Promise.all([
    fetchJson("https://api.github.com/repos/XRPLF/rippled/releases/latest"),
    fetchJson("https://api.xrpscan.com/api/v1/amendment/BatchV1_1"),
    fetchJson("https://api.xrpscan.com/api/v1/amendment/Sponsor"),
  ]);
  if (typeof batch.enabled !== "boolean" || typeof sponsor.enabled !== "boolean") {
    throw new Error("amendment payload did not include an enabled boolean");
  }

  const server = await readBuildVersion(wsUrl);
  const live = {
    rippledLatest: normalizeReleaseTag(release.tag_name),
    batchEnabled: batch.enabled,
    sponsorEnabled: sponsor.enabled,
    buildVersion: server.buildVersion,
    buildError: server.error,
    wsUrl,
  };
  const { reasons, buildWarning } = watchDiff(baseline, live);
  const output = {
    changed: reasons.length > 0,
    reasons,
    buildWarning,
    live,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPathSafe(import.meta.url);
function fileURLToPathSafe(url) {
  try { return path.resolve(new URL(url).pathname.replace(/^\/([A-Za-z]:)/, "$1")); } catch { return ""; }
}
if (invoked) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
