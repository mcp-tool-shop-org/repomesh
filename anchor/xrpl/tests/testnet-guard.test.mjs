import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as postAnchor from "../scripts/post-anchor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "..", "config.json");
const POST_ANCHOR_SCRIPT = path.join(HERE, "..", "scripts", "post-anchor.mjs");
const SHIPPED_CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

function runPostAnchorSubprocess({ config, env = {} }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-xrpl-guard-"));
  const cfgFile = path.join(tmpDir, "config.json");
  fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2), "utf8");
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.XRPL_WS_URL;
    delete cleanEnv.XRPL_SEED;
    const stdout = execFileSync(process.execPath, [POST_ANCHOR_SCRIPT], {
      env: { ...cleanEnv, REPOMESH_XRPL_CONFIG: cfgFile, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("XRPL fail-closed testnet guard (post-anchor.mjs)", () => {
  it("the testnet config passes", () => {
    assert.equal(typeof postAnchor.assertPostingEndpoint, "function", "post-anchor.mjs must export assertPostingEndpoint");
    assert.ok(Array.isArray(postAnchor.KNOWN_TESTNET_WS_URLS), "post-anchor.mjs must export KNOWN_TESTNET_WS_URLS");
    assert.ok(
      postAnchor.KNOWN_TESTNET_WS_URLS.includes(SHIPPED_CONFIG.rippledUrl),
      "shipped config.json rippledUrl must be in KNOWN_TESTNET_WS_URLS"
    );
    const res = postAnchor.assertPostingEndpoint(SHIPPED_CONFIG, {});
    assert.equal(res.ok, true);
    assert.equal(res.network, "testnet");
    assert.equal(res.wsUrl, "wss://s.altnet.rippletest.net:51233");
    assert.equal(res.mode, "testnet");
  });

  it("a mainnet URL is refused", () => {
    const mainnetCfg = {
      ...SHIPPED_CONFIG,
      rippledUrl: "wss://xrplcluster.com",
    };
    const sub = runPostAnchorSubprocess({ config: mainnetCfg });
    assert.notEqual(sub.status, 0);
    assert.match(sub.stderr, /Refusing to post anchor/);
    assert.match(sub.stderr, /wss:\/\/xrplcluster\.com/);

    assert.equal(typeof postAnchor.assertPostingEndpoint, "function", "post-anchor.mjs must export assertPostingEndpoint");
    const res = postAnchor.assertPostingEndpoint(mainnetCfg, {});
    assert.equal(res.ok, false);
    assert.equal(res.network, "testnet");
    assert.equal(res.wsUrl, "wss://xrplcluster.com");
    assert.match(res.reason, /Refusing to post anchor/);
    assert.match(res.reason, /testnet/);
    assert.match(res.reason, /wss:\/\/xrplcluster\.com/);
  });

  it("an unknown URL is refused", () => {
    const unknownCfg = {
      ...SHIPPED_CONFIG,
      rippledUrl: "wss://unknown.example.invalid:51233",
    };
    const sub = runPostAnchorSubprocess({ config: unknownCfg });
    assert.notEqual(sub.status, 0);
    assert.match(sub.stderr, /Refusing to post anchor/);
    assert.match(sub.stderr, /wss:\/\/unknown\.example\.invalid:51233/);

    assert.equal(typeof postAnchor.assertPostingEndpoint, "function", "post-anchor.mjs must export assertPostingEndpoint");
    const res = postAnchor.assertPostingEndpoint(unknownCfg, {});
    assert.equal(res.ok, false);
    assert.equal(res.network, "testnet");
    assert.equal(res.wsUrl, "wss://unknown.example.invalid:51233");
    assert.match(res.reason, /Refusing to post anchor/);
    assert.match(res.reason, /wss:\/\/unknown\.example\.invalid:51233/);
  });

  it("XRPL_WS_URL set to a mainnet endpoint is refused", () => {
    const sub = runPostAnchorSubprocess({
      config: SHIPPED_CONFIG,
      env: { XRPL_WS_URL: "wss://s1.ripple.com" },
    });
    assert.notEqual(sub.status, 0);
    assert.match(sub.stderr, /Refusing to post anchor/);
    assert.match(sub.stderr, /wss:\/\/s1\.ripple\.com/);

    assert.equal(typeof postAnchor.assertPostingEndpoint, "function", "post-anchor.mjs must export assertPostingEndpoint");
    const res = postAnchor.assertPostingEndpoint(SHIPPED_CONFIG, {
      XRPL_WS_URL: "wss://s1.ripple.com",
    });
    assert.equal(res.ok, false);
    assert.equal(res.network, "testnet");
    assert.equal(res.wsUrl, "wss://s1.ripple.com");
    assert.match(res.reason, /Refusing to post anchor/);
    assert.match(res.reason, /wss:\/\/s1\.ripple\.com/);
  });

  it("the mainnet opt-in path works only when both its setting and its allowlist are present", () => {
    assert.equal(typeof postAnchor.assertPostingEndpoint, "function", "post-anchor.mjs must export assertPostingEndpoint");
    // 1. network="mainnet" alone -> refused
    const onlyNetwork = {
      ...SHIPPED_CONFIG,
      network: "mainnet",
      rippledUrl: "wss://xrplcluster.com",
    };
    const r1 = postAnchor.assertPostingEndpoint(onlyNetwork, {});
    assert.equal(r1.ok, false);
    assert.match(r1.reason, /allowMainnetPosting/);

    // 2. allowMainnetPosting=true without mainnetAllowedEndpoints -> refused
    const onlySetting = {
      ...onlyNetwork,
      allowMainnetPosting: true,
    };
    const r2 = postAnchor.assertPostingEndpoint(onlySetting, {});
    assert.equal(r2.ok, false);
    assert.match(r2.reason, /mainnetAllowedEndpoints/);

    // 3. mainnetAllowedEndpoints present without allowMainnetPosting=true -> refused
    const onlyAllowlist = {
      ...onlyNetwork,
      mainnetAllowedEndpoints: ["wss://xrplcluster.com"],
    };
    const r3 = postAnchor.assertPostingEndpoint(onlyAllowlist, {});
    assert.equal(r3.ok, false);
    assert.match(r3.reason, /allowMainnetPosting/);

    // 4. Both setting and allowlist present, but resolved URL is not in mainnetAllowedEndpoints -> refused
    const wrongUrl = {
      ...onlyNetwork,
      allowMainnetPosting: true,
      mainnetAllowedEndpoints: ["wss://xrplcluster.com"],
    };
    const r4 = postAnchor.assertPostingEndpoint(wrongUrl, {
      XRPL_WS_URL: "wss://s1.ripple.com",
    });
    assert.equal(r4.ok, false);
    assert.match(r4.reason, /mainnetAllowedEndpoints/);

    // 5. Env var alone cannot opt into mainnet when config is testnet
    const envOnly = postAnchor.assertPostingEndpoint(SHIPPED_CONFIG, {
      XRPL_WS_URL: "wss://xrplcluster.com",
      ALLOW_MAINNET_POSTING: "true",
    });
    assert.equal(envOnly.ok, false);

    // 6. Both allowMainnetPosting=true AND mainnetAllowedEndpoints containing the URL -> passes
    const fullOptIn = {
      ...onlyNetwork,
      allowMainnetPosting: true,
      mainnetAllowedEndpoints: ["wss://xrplcluster.com"],
    };
    const r6 = postAnchor.assertPostingEndpoint(fullOptIn, {});
    assert.equal(r6.ok, true);
    assert.equal(r6.network, "mainnet");
    assert.equal(r6.wsUrl, "wss://xrplcluster.com");
    assert.equal(r6.mode, "mainnet");
  });

  it("no network call happens in any refusal case", async () => {
    assert.equal(typeof postAnchor.connectValidatedClient, "function", "post-anchor.mjs must export connectValidatedClient");
    let clientInstantiations = 0;
    let connectCalls = 0;
    const createClient = (url) => {
      clientInstantiations++;
      return {
        url,
        async connect() {
          connectCalls++;
        },
      };
    };

    const refusalCases = [
      { config: { ...SHIPPED_CONFIG, rippledUrl: "wss://xrplcluster.com" }, env: {} },
      { config: { ...SHIPPED_CONFIG, rippledUrl: "wss://unknown.example.invalid:51233" }, env: {} },
      { config: SHIPPED_CONFIG, env: { XRPL_WS_URL: "wss://s1.ripple.com" } },
      { config: { ...SHIPPED_CONFIG, network: "mainnet", rippledUrl: "wss://xrplcluster.com" }, env: {} },
      { config: { ...SHIPPED_CONFIG, network: "mainnet", allowMainnetPosting: true, rippledUrl: "wss://xrplcluster.com" }, env: {} },
      { config: { ...SHIPPED_CONFIG, network: "mainnet", mainnetAllowedEndpoints: ["wss://xrplcluster.com"], rippledUrl: "wss://xrplcluster.com" }, env: {} },
      { config: { ...SHIPPED_CONFIG, network: "devnet", rippledUrl: "wss://s.devnet.rippletest.net:51233" }, env: {} },
    ];

    for (const { config, env } of refusalCases) {
      const out = await postAnchor.connectValidatedClient(config, env, { createClient });
      assert.equal(out.ok, false, `expected refusal for network=${config.network} url=${env.XRPL_WS_URL || config.rippledUrl}`);
      assert.equal(out.client, null);
    }

    assert.equal(clientInstantiations, 0, "xrpl.Client must never be constructed on a refused endpoint");
    assert.equal(connectCalls, 0, "client.connect() must never be called on a refused endpoint");

    // Sanity check: when the guard passes on testnet, the injected mock client IS constructed and connected offline
    const allowed = await postAnchor.connectValidatedClient(SHIPPED_CONFIG, {}, { createClient });
    assert.equal(allowed.ok, true);
    assert.equal(clientInstantiations, 1);
    assert.equal(connectCalls, 1);
  });

  it("main() connects through connectValidatedClient and refuses when the environment URL changes after assertion", async () => {
    const src = fs.readFileSync(POST_ANCHOR_SCRIPT, "utf8");
    const mainBody = src.slice(src.indexOf("async function main()"));
    assert.match(mainBody, /connectValidatedClient\s*\(/, "main() must connect through connectValidatedClient");
    assert.doesNotMatch(mainBody, /new\s+xrpl\.Client\s*\(/, "main() must not construct new xrpl.Client directly");

    let clientInstantiations = 0;
    const createClient = (url) => {
      clientInstantiations++;
      return { url, async connect() {} };
    };

    const initialEnv = { XRPL_WS_URL: "wss://s.altnet.rippletest.net:51233" };
    const asserted = postAnchor.assertPostingEndpoint(SHIPPED_CONFIG, initialEnv);
    assert.equal(asserted.ok, true);

    // Environment mutates after initial assertion to a different endpoint (even another testnet endpoint)
    const mutatedEnv = { XRPL_WS_URL: "wss://testnet.xrpl-labs.com" };
    const drifted = await postAnchor.connectValidatedClient(SHIPPED_CONFIG, mutatedEnv, {
      createClient,
      assertedEndpoint: asserted,
    });
    assert.equal(drifted.ok, false, "must refuse when current env URL differs from assertedEndpoint");
    assert.equal(drifted.client, null);
    assert.equal(clientInstantiations, 0, "must not instantiate client when assertedEndpoint and current env differ");
    assert.match(drifted.reason || "", /endpoint changed after initial assertion/i);
  });
});
