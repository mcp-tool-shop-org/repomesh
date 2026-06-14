// STGB-VER-011 / FC11 — OSV result cache + bounded-concurrency pool + 429 backoff.
//
// Contract (featureB-build-contract.md FC11):
//   - cache OSV results keyed on (ecosystem,name,version) — idempotent, parallel-safe
//   - replace the sequential for...of in osvQueryAll with a bounded-concurrency pool (~5)
//   - handle 429 with backoff (honor Retry-After when present)
//   - PRESERVE Stage A per-package failure isolation (one failure -> that package unscored;
//     criticals from siblings survive) and the unscored-on-outage doctrine
//   - structure the cache so a future verifier-plugin (#7) can reuse it
//
// ADDITIVE: this must NOT change any trust verdict. Failures are NOT cached (a transient error
// must not poison a retry, and isolation requires each failure to surface independently).
//
// RED before fix: osvQueryAll had a sequential for...of (no concurrency), no cache (a coordinate
// queried twice hit the network twice), and osvQueryOne treated 429 like any other non-2xx (a
// generic throw with a fixed 300ms*attempt sleep, ignoring Retry-After). OsvCache did not exist.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { osvQueryAll, OSV_QUERY_ENDPOINT } from "../lib/osv.mjs";
import { OsvCache, osvCacheKey, OSV_CACHE_KEY_DELIM } from "../lib/osv-cache.mjs";

const CRITICAL_VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H";

const QUERIES = [
  { package: { ecosystem: "npm", name: "alpha" }, version: "1.0.0" },
  { package: { ecosystem: "npm", name: "beta" }, version: "2.0.0" },
  { package: { ecosystem: "npm", name: "gamma" }, version: "3.0.0" },
];

describe("FC11 osvCacheKey is the canonical (ecosystem,name,version) coordinate", () => {
  it("derives a stable coordinate key (NUL-delimited, collision-free)", () => {
    const k = osvCacheKey(QUERIES[0]);
    assert.equal(k, ["npm", "alpha", "1.0.0"].join(OSV_CACHE_KEY_DELIM));
  });

  it("two queries for the same coordinate produce the same key; a version bump differs", () => {
    const a = osvCacheKey({ package: { ecosystem: "npm", name: "x" }, version: "1.0.0" });
    const b = osvCacheKey({ package: { ecosystem: "npm", name: "x" }, version: "1.0.0" });
    const c = osvCacheKey({ package: { ecosystem: "npm", name: "x" }, version: "1.0.1" });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe("FC11 OsvCache is a reusable, parallel-safe, idempotent store", () => {
  it("getOrCompute runs the loader once per coordinate; a second get hits the cache (no second compute)", async () => {
    const cache = new OsvCache();
    let computes = 0;
    const loader = async () => { computes++; return { vulns: [] }; };

    const k = osvCacheKey(QUERIES[0]);
    const r1 = await cache.getOrCompute(k, loader);
    const r2 = await cache.getOrCompute(k, loader);
    assert.equal(computes, 1, "second get must hit the cache, not recompute");
    assert.equal(r1, r2, "same cached value returned");
  });

  it("concurrent gets for the same coordinate share ONE in-flight compute (dedup)", async () => {
    const cache = new OsvCache();
    let computes = 0;
    let release;
    const gate = new Promise(r => { release = r; });
    const loader = async () => { computes++; await gate; return { vulns: [] }; };

    const k = osvCacheKey(QUERIES[0]);
    const p1 = cache.getOrCompute(k, loader);
    const p2 = cache.getOrCompute(k, loader);
    release();
    await Promise.all([p1, p2]);
    assert.equal(computes, 1, "two concurrent gets dedup to a single network compute");
  });

  it("a failed compute is NOT cached (transient error must not poison a retry)", async () => {
    const cache = new OsvCache();
    let attempts = 0;
    const loader = async () => {
      attempts++;
      if (attempts === 1) throw new Error("ECONNRESET");
      return { vulns: [] };
    };
    const k = osvCacheKey(QUERIES[0]);
    await assert.rejects(() => cache.getOrCompute(k, loader), /ECONNRESET/);
    const r = await cache.getOrCompute(k, loader); // retry succeeds because failure wasn't cached
    assert.equal(attempts, 2, "the failed compute is retried, not served from cache");
    assert.deepEqual(r, { vulns: [] });
  });
});

describe("FC11 osvQueryAll caches by coordinate (a coordinate queried twice hits the network once)", () => {
  it("the same coordinate across two calls sharing a cache fetches once", async () => {
    let fetches = 0;
    const fetchImpl = async () => { fetches++; return { ok: true, json: async () => ({ vulns: [] }) }; };
    const cache = new OsvCache();
    const one = [{ package: { ecosystem: "npm", name: "dup" }, version: "1.0.0" }];

    await osvQueryAll(one, { fetchImpl, cache });
    await osvQueryAll(one, { fetchImpl, cache });
    assert.equal(fetches, 1, "second scan of the same coordinate is a cache hit, not a network call");
  });

  it("duplicate coordinates WITHIN one call also dedup to a single fetch", async () => {
    let fetches = 0;
    const fetchImpl = async () => { fetches++; return { ok: true, json: async () => ({ vulns: [] }) }; };
    const dupQueries = [
      { package: { ecosystem: "npm", name: "dup" }, version: "1.0.0" },
      { package: { ecosystem: "npm", name: "dup" }, version: "1.0.0" },
      { package: { ecosystem: "npm", name: "other" }, version: "2.0.0" },
    ];
    const results = await osvQueryAll(dupQueries, { fetchImpl });
    assert.equal(fetches, 2, "two distinct coordinates -> two fetches; the duplicate is served from cache");
    assert.equal(results.length, 3, "alignment is still 1:1 with queries (SEC-010)");
  });

  it("a different version of the same name is a distinct coordinate (separate fetch)", async () => {
    let fetches = 0;
    const fetchImpl = async () => { fetches++; return { ok: true, json: async () => ({ vulns: [] }) }; };
    const cache = new OsvCache();
    await osvQueryAll([{ package: { ecosystem: "npm", name: "x" }, version: "1.0.0" }], { fetchImpl, cache });
    await osvQueryAll([{ package: { ecosystem: "npm", name: "x" }, version: "1.0.1" }], { fetchImpl, cache });
    assert.equal(fetches, 2, "version bump is a cache miss");
  });
});

describe("FC11 osvQueryAll uses a bounded-concurrency pool (default ~5)", () => {
  function makeManyQueries(n) {
    return Array.from({ length: n }, (_, i) => ({
      package: { ecosystem: "npm", name: `pkg-${i}` }, version: "1.0.0",
    }));
  }

  it("never runs more than `concurrency` fetches in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    const results = await osvQueryAll(makeManyQueries(20), { fetchImpl, concurrency: 5 });
    assert.equal(results.length, 20, "every query is resolved (1:1)");
    assert.ok(peak <= 5, `peak in-flight ${peak} must not exceed the bound of 5`);
    assert.ok(peak > 1, `pool must actually run things in parallel (peak ${peak} should be > 1)`);
  });

  it("defaults to a bound of 5 when concurrency is unset", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    await osvQueryAll(makeManyQueries(20), { fetchImpl });
    assert.ok(peak <= 5, `default bound is 5; peak was ${peak}`);
  });
});

describe("FC11 osvQueryOne handles 429 with backoff (honors Retry-After)", () => {
  it("retries after a 429 and succeeds, sleeping for the Retry-After interval", async () => {
    let calls = 0;
    const sleeps = [];
    const sleepImpl = async (ms) => { sleeps.push(ms); };
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) {
        return { ok: false, status: 429, headers: { get: (h) => (h.toLowerCase() === "retry-after" ? "2" : null) }, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    const results = await osvQueryAll([QUERIES[0]], { fetchImpl, sleepImpl });
    assert.equal(calls, 2, "the 429 is retried");
    assert.equal(results[0].vulns.length, 0, "the retry's clean result is used");
    assert.ok(sleeps.some(ms => ms >= 2000), `Retry-After: 2 should yield a >= 2000ms backoff; saw ${JSON.stringify(sleeps)}`);
  });

  it("backs off exponentially when no Retry-After header is present", async () => {
    let calls = 0;
    const sleeps = [];
    const sleepImpl = async (ms) => { sleeps.push(ms); };
    const fetchImpl = async () => {
      calls++;
      if (calls <= 2) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    await osvQueryAll([QUERIES[0]], { fetchImpl, sleepImpl });
    assert.equal(calls, 3, "two 429s then success");
    assert.ok(sleeps.length >= 2, "backed off between retries");
    assert.ok(sleeps[1] > sleeps[0], `backoff grows (saw ${JSON.stringify(sleeps)})`);
  });

  it("a persistent 429 (beyond retries) fails THAT package only — siblings survive (isolation preserved)", async () => {
    const sleepImpl = async () => {};
    const fetchImpl = async (_url, opts) => {
      const q = JSON.parse(opts.body);
      if (q.package.name === "beta") {
        return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
      }
      if (q.package.name === "alpha") {
        return { ok: true, json: async () => ({ vulns: [{ id: "CVE-2021-44228", severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }] }] }) };
      }
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    const results = await osvQueryAll(QUERIES, { fetchImpl, sleepImpl, concurrency: 5 });
    assert.equal(results.length, 3, "1:1 alignment preserved despite beta's persistent 429");
    const alpha = results.find(r => r.package === "alpha");
    assert.equal(alpha.vulns[0].id, "CVE-2021-44228", "alpha's critical survives beta's 429 (isolation)");
    const beta = results.find(r => r.package === "beta");
    assert.deepEqual(beta.vulns, [], "the persistently-429'd package has empty vulns");
    assert.match(String(beta.error), /429/, "beta carries its error");
    assert.equal(results.failures.length, 1, "exactly one package could not be scanned");
    assert.equal(results.failures[0].package, "beta");
  });
});

describe("FC11 per-package isolation + alignment still hold with the pool", () => {
  it("one rejecting package among several still returns the others' vulns + records the failure", async () => {
    const fetchImpl = async (_url, opts) => {
      const q = JSON.parse(opts.body);
      if (q.package.name === "beta") throw new Error("ECONNRESET");
      if (q.package.name === "alpha") {
        return { ok: true, json: async () => ({ vulns: [{ id: "CVE-2021-44228", severity: [{ type: "CVSS_V3", score: CRITICAL_VECTOR }] }] }) };
      }
      return { ok: true, json: async () => ({ vulns: [] }) };
    };
    const results = await osvQueryAll(QUERIES, { fetchImpl, concurrency: 5 });
    assert.equal(results.length, 3, "results align 1:1 with queries despite a failure");
    const alpha = results.find(r => r.package === "alpha");
    assert.equal(alpha.vulns[0].id, "CVE-2021-44228");
    const beta = results.find(r => r.package === "beta");
    assert.deepEqual(beta.vulns, []);
    assert.match(String(beta.error), /ECONNRESET/);
    assert.equal(results.failures.length, 1);
    assert.equal(results.failures[0].package, "beta");
  });

  it("uses the pinned OSV endpoint constant", async () => {
    let sentUrl = null;
    const fetchImpl = async (url) => { sentUrl = url; return { ok: true, json: async () => ({ vulns: [] }) }; };
    await osvQueryAll([QUERIES[0]], { fetchImpl });
    assert.equal(sentUrl, OSV_QUERY_ENDPOINT);
  });
});
