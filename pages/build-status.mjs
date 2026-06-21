#!/usr/bin/env node
// FT-O-002 — Machine-readable network STATUS endpoint.
//
// Writes a STABLE, machine-readable `status.json` to pages/out/ so an EXTERNAL system can
// poll repomesh's health without scraping HTML or reading Actions logs. The motivating gap:
// a FROZEN LEDGER or a STALE ANCHOR (roots committed but never landing on-chain) is currently
// invisible outside CI logs. status.json surfaces it as a top-level ok/degraded rollup with a
// human-legible `reasons[]` array.
//
// ── Schema (v1) ──────────────────────────────────────────────────────────────
// {
//   "schemaVersion": 1,
//   "generatedAt": "<ISO8601>",        // passed IN — never Date.now() (determinism; mirrors
//                                       //  how build-metrics threads time through)
//   "ok":       <bool>,                 // true iff nothing is degraded
//   "degraded": <bool>,                 // true if ANY health signal is bad
//   "reasons":  [ "<plain-English why>" ],  // legibility: empty when ok
//   "ledger": {
//     "totalEvents":   <int>,           // count of ledger events
//     "lastEventAt":   "<ISO8601>|null",
//     "lastAnchorAt":  "<ISO8601>|null",// most recent ON-CHAIN anchor time (real txHash)
//     "lastAnchorPartition": "<id>|null",
//     "stale":         <bool>,          // last on-chain anchor older than staleAnchorDays
//                                       //  (or: no on-chain anchor at all) — frozen-ledger signal
//     "staleAnchorDays": <int>          // the threshold used
//   },
//   "trust": {
//     "verified": <int>, "partial": <int>, "disputed": <int>, "other": <int>,
//     "releases": <int>,                // total tracked releases
//     "repos":    <int>                 // distinct tracked repos
//   },
//   "anchors": {
//     "partitions": <int>,              // total partition records
//     "anchored":   <int>,              // partitions with a real on-chain txHash (finality)
//     "pending":    <int>               // partitions whose root is committed but txHash is null
//   }
// }
//
// ── Anchor finality semantics (Stage C, STGB-SP-001) ─────────────────────────
// A partition is "anchored" ONLY when it carries a real, non-null on-chain txHash. A record
// with txHash:null is "pending" (Merkle root committed; not yet on XRPL) — it is NEVER counted
// as anchored. This matches the dashboard's three-state honesty doctrine.
//
// ── Fail-safe ────────────────────────────────────────────────────────────────
// Missing / partial / wrong-shape inputs are coerced to safe defaults and reported as a
// DEGRADED status with a reason — they never crash the build. The status endpoint must always
// produce a well-formed document so a poller's parse never fails.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

// Staleness threshold: if the most recent ON-CHAIN anchor is older than this many days (or
// there is no on-chain anchor at all), the ledger is "frozen" — roots may still be committed,
// but finality has stopped landing. 14 days chosen as a conservative default: the anchor cadence
// is intended to be at least weekly (see compute-root cadence docs), so two missed cycles is a
// clear, non-flaky frozen-ledger signal that won't false-positive on normal weekly anchoring.
export const STALE_ANCHOR_DAYS = 14;

// SB-PAGES-01 style coercion helpers — mirror build-metrics/build-stats so a truncated or
// wrong-typed artifact degrades gracefully instead of crashing a reduction.
const asArray = (v) => (Array.isArray(v) ? v : []);
const asObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Parse an ISO timestamp to epoch-ms, or null if absent/unparseable. Never throws.
function toMs(ts) {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

// Stage-C finality: a partition is on-chain anchored iff it carries a real, non-null txHash.
function isOnChain(p) {
  return !!(p && p.txHash);
}

// Best-effort timestamp for when a partition's anchor LANDED on-chain. The live anchors.json
// partition records don't always carry an explicit time, so we accept the common field names
// (anchoredAt / txTimestamp / timestamp / closeTime) when present. When none is present, the
// caller falls back to the ledger's ledger.anchor events (see lastOnChainAnchorFromLedger).
function partitionAnchorMs(p) {
  return toMs(p?.anchoredAt) ?? toMs(p?.txTimestamp) ?? toMs(p?.timestamp) ?? toMs(p?.closeTime);
}

// Derive the most recent on-chain anchor time from the ledger events themselves. A ledger.anchor
// attestation event records the moment the partition was anchored to XRPL; its `timestamp` is the
// authoritative anchor time when the partition record lacks one. We only count events that name an
// on-chain tx (a ledger.anchor attestation, which exists only for real on-chain anchors).
function lastOnChainAnchorFromLedger(ledgerEvents) {
  let best = null;
  for (const ev of asArray(ledgerEvents)) {
    const atts = asArray(ev?.attestations);
    const isAnchor = atts.some((a) => a && typeof a.type === "string" && a.type.startsWith("ledger.anchor"));
    if (!isAnchor) continue;
    const ms = toMs(ev?.timestamp);
    if (ms !== null && (best === null || ms > best)) best = ms;
  }
  return best;
}

// ── PURE CORE — no disk I/O. Takes already-loaded sources in; returns the status document. ──
// `now` MUST be passed in (ISO string or ms). buildStatus NEVER calls Date.now() so the same
// inputs always yield the same output (determinism / replayability).
export function buildStatus({ now, trust, anchors, ledgerEvents, staleAnchorDays = STALE_ANCHOR_DAYS } = {}) {
  const reasons = [];

  // Normalize inputs defensively (fail-safe contract).
  const nowMs = toMs(typeof now === "number" ? new Date(now).toISOString() : now) ?? Date.parse("1970-01-01T00:00:00.000Z");
  const generatedAt = typeof now === "string" ? now : new Date(nowMs).toISOString();
  const trustList = asArray(trust);
  const anchorsObj = asObject(anchors);
  const partitions = asArray(anchorsObj.partitions);
  const events = asArray(ledgerEvents);

  // ── Ledger health ──────────────────────────────────────────────────────────
  const totalEvents = events.length;
  let lastEventMs = null;
  for (const ev of events) {
    const ms = toMs(ev?.timestamp);
    if (ms !== null && (lastEventMs === null || ms > lastEventMs)) lastEventMs = ms;
  }

  // Last ON-CHAIN anchor: prefer an explicit time on an anchored partition; fall back to the
  // ledger's ledger.anchor events (which exist only for real on-chain anchors).
  let lastAnchorMs = null;
  let lastAnchorPartition = null;
  for (const p of partitions) {
    if (!isOnChain(p)) continue;
    const ms = partitionAnchorMs(p);
    if (ms !== null && (lastAnchorMs === null || ms > lastAnchorMs)) {
      lastAnchorMs = ms;
      lastAnchorPartition = p?.partitionId ?? null;
    }
  }
  if (lastAnchorMs === null) {
    // No partition carried a usable timestamp — derive from the ledger.
    lastAnchorMs = lastOnChainAnchorFromLedger(events);
  }

  const anchorAgeDays = lastAnchorMs === null ? Infinity : (nowMs - lastAnchorMs) / (24 * 60 * 60 * 1000);
  const stale = anchorAgeDays > staleAnchorDays;

  // ── Anchor health (Stage-C finality semantics) ──────────────────────────────
  let anchored = 0;
  let pending = 0;
  for (const p of partitions) {
    if (isOnChain(p)) anchored += 1;
    else pending += 1;
  }

  // ── Trust summary ────────────────────────────────────────────────────────────
  let verified = 0, partial = 0, disputed = 0, other = 0;
  const repoSet = new Set();
  for (const e of trustList) {
    if (e?.repo) repoSet.add(e.repo);
    const v = String(e?.verdict || "").toUpperCase();
    if (v === "VERIFIED" || v === "PASS") verified += 1;
    else if (v === "PARTIAL") partial += 1;
    else if (v === "DISPUTED") disputed += 1;
    else other += 1;
  }

  // ── Degradation rollup + legible reasons ─────────────────────────────────────
  if (totalEvents === 0) {
    reasons.push("Ledger is empty: no events recorded — the trust substrate has no history to anchor.");
  }
  if (stale) {
    if (lastAnchorMs === null) {
      reasons.push(
        "Frozen ledger: no partition has been anchored on-chain (every anchor's txHash is null). " +
        "Merkle roots are committed but finality has never landed on XRPL.",
      );
    } else {
      reasons.push(
        `Stale anchor: the most recent on-chain anchor is ${Math.floor(anchorAgeDays)} days old ` +
        `(threshold ${staleAnchorDays} days) — the ledger may be frozen.`,
      );
    }
  }
  if (disputed > 0) {
    reasons.push(`${disputed} disputed release${disputed === 1 ? "" : "s"} tracked — trust is withheld for ${disputed === 1 ? "it" : "them"}.`);
  }

  const degraded = reasons.length > 0;

  return {
    schemaVersion: 1,
    generatedAt,
    ok: !degraded,
    degraded,
    reasons,
    ledger: {
      totalEvents,
      lastEventAt: lastEventMs === null ? null : new Date(lastEventMs).toISOString(),
      lastAnchorAt: lastAnchorMs === null ? null : new Date(lastAnchorMs).toISOString(),
      lastAnchorPartition,
      stale,
      staleAnchorDays,
    },
    trust: {
      verified,
      partial,
      disputed,
      other,
      releases: trustList.length,
      repos: repoSet.size,
    },
    anchors: {
      partitions: partitions.length,
      anchored,
      pending,
    },
  };
}

// ── IMPURE WRAPPER — loads the on-disk sources, builds status, writes pages/out/status.json. ──
// Exported so build-pages.mjs can call it as part of its build flow (one `node build-pages.mjs`
// produces status.json too). `now` is passed in for determinism; `outDir` defaults to pages/out.
export function writeStatus({ outDir, now } = {}) {
  const out = outDir || path.join(import.meta.dirname, "out");

  // Read sources defensively — a missing/unparseable source becomes a safe default, which
  // buildStatus then reports as degraded rather than crashing.
  const readJSON = (rel) => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
      console.error(`[status] Warning: ${rel} not found, using defaults.`);
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (err) {
      console.error(`[status] Warning: Failed to parse ${rel}: ${err.message}. Using defaults.`);
      return null;
    }
  };

  const readLedger = (rel) => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
      console.error(`[status] Warning: ${rel} not found, ledger treated as empty.`);
      return [];
    }
    const events = [];
    try {
      const text = fs.readFileSync(p, "utf8");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          events.push(JSON.parse(t));
        } catch {
          // Skip a single corrupt line rather than failing the whole status build.
          console.error(`[status] Warning: skipping unparseable ledger line in ${rel}.`);
        }
      }
    } catch (err) {
      console.error(`[status] Warning: Failed to read ${rel}: ${err.message}. Ledger treated as empty.`);
    }
    return events;
  };

  const trust = readJSON("registry/trust.json");
  const anchors = readJSON("registry/anchors.json");
  const ledgerEvents = readLedger("ledger/events/events.jsonl");

  const status = buildStatus({
    now: now || new Date().toISOString(),
    trust,
    anchors,
    ledgerEvents,
  });

  fs.mkdirSync(out, { recursive: true });
  const dest = path.join(out, "status.json");
  fs.writeFileSync(dest, JSON.stringify(status, null, 2) + "\n", "utf8");
  console.error(`[status] Wrote ${dest} (ok=${status.ok}, degraded=${status.degraded}, reasons=${status.reasons.length}).`);
  return status;
}

// ── SIDE-EFFECTING ENTRY — runs only when invoked directly (node build-status.mjs). ──
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  writeStatus({});
}
