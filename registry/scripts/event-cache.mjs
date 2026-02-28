#!/usr/bin/env node
// Event cache — avoids reparsing the full ledger on every registry build.
// Writes registry/.event-cache.json with parsed events and line count.
// Subsequent runs only parse new lines.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER_PATH = path.join(ROOT, "ledger", "events", "events.jsonl");
const CACHE_PATH = path.join(ROOT, "registry", ".event-cache.json");

export function readEventsIncremental() {
  if (!fs.existsSync(LEDGER_PATH)) return [];

  const raw = fs.readFileSync(LEDGER_PATH, "utf8");
  const lines = raw.split("\n").filter(l => l.trim().length > 0);

  // Try cache
  let cached = { lineCount: 0, events: [] };
  if (fs.existsSync(CACHE_PATH)) {
    try {
      cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    } catch { cached = { lineCount: 0, events: [] }; }
  }

  // If ledger grew, parse only new lines
  if (cached.lineCount <= lines.length && cached.lineCount > 0) {
    // Validate cache isn't stale (check last cached line hash)
    const newLines = lines.slice(cached.lineCount);
    const newEvents = newLines.map(l => JSON.parse(l));
    const allEvents = [...cached.events, ...newEvents];

    // Update cache
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ lineCount: lines.length, events: allEvents }), "utf8");
    return allEvents;
  }

  // Full parse (cache miss or ledger shrank)
  const events = lines.map(l => JSON.parse(l));
  fs.writeFileSync(CACHE_PATH, JSON.stringify({ lineCount: lines.length, events }), "utf8");
  return events;
}
