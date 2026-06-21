// Stage C — retry chatter respects --quiet / --json (STGB-CLI-005).
//
// The "Retrying..." line is informational. It must:
//   - stay SILENT under --json (it would pollute the stderr a scripted JSON consumer reads, and
//     muddy the single-blob contract), and
//   - stay SILENT under --quiet,
//   - still appear in a normal (non-quiet, non-json) run so an interactive operator sees progress.
//
// We point fetchText at a loopback URL on a closed port so the connection fails transiently and
// the retry loop engages (a connection-refused is NOT deterministic, so it retries). We toggle the
// flags via process.argv and capture stderr.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");
function toURL(p) { return pathToFileURL(p).href; }

// A loopback http URL on a port nothing is listening on => connection refused (transient, retried).
// http://127.0.0.1 is allowed by assertScheme (loopback exception), so we reach the retry loop.
const DEAD_URL = "http://127.0.0.1:9/repomesh-test";

async function runFetchWithFlags(flags) {
  const savedArgv = process.argv;
  process.argv = ["node", "cli", ...flags];
  // Short timeout so the (failing) fetch returns fast; positive so env validation passes.
  const saved = process.env.REPOMESH_FETCH_TIMEOUT;
  process.env.REPOMESH_FETCH_TIMEOUT = "300";
  const origErr = console.error;
  let stderr = "";
  console.error = (m) => { stderr += (typeof m === "string" ? m : JSON.stringify(m)) + "\n"; };
  try {
    const mod = await import(toURL(resolve(srcDir, "http.mjs")) + `?t=${Date.now()}${Math.random()}`);
    try { await mod.fetchText(DEAD_URL); } catch { /* expected to fail */ }
  } finally {
    console.error = origErr;
    process.argv = savedArgv;
    if (saved === undefined) delete process.env.REPOMESH_FETCH_TIMEOUT; else process.env.REPOMESH_FETCH_TIMEOUT = saved;
  }
  return stderr;
}

describe("STGB-CLI-005: retry chatter respects --quiet / --json", () => {
  it("normal mode prints 'Retrying...'", async () => {
    const stderr = await runFetchWithFlags([]);
    assert.match(stderr, /Retrying\.\.\./, "interactive run should show retry progress");
  });

  it("--json suppresses 'Retrying...' chatter", async () => {
    const stderr = await runFetchWithFlags(["--json"]);
    assert.doesNotMatch(stderr, /Retrying\.\.\./, "JSON consumers must not see retry chatter");
  });

  it("--quiet suppresses 'Retrying...' chatter", async () => {
    const stderr = await runFetchWithFlags(["--quiet"]);
    assert.doesNotMatch(stderr, /Retrying\.\.\./, "--quiet means quiet");
  });

  it("-q (short quiet) suppresses 'Retrying...' chatter", async () => {
    const stderr = await runFetchWithFlags(["-q"]);
    assert.doesNotMatch(stderr, /Retrying\.\.\./);
  });
});
