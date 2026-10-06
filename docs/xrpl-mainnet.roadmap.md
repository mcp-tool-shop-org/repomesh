# Roadmap — mainnet anchor, current xrpl.js, Docker image

**Date:** 2026-09-23
**Locked by:** `docs/xrpl-web3-6mo.study-swarm.dispatch.md`
**Product:** RepoMesh posts one AccountSet memo (`repomesh-anchor-v1`) and verifies it. This roadmap makes that post durable on mainnet, on a current client, from a published image.

**Status:** Phases 1–4 and 6 are in the working tree. `config.json` is still testnet. Phase 5 waits on a funded mainnet account and a CLI release that contains that address.

The study lock still holds. Batch, Sponsor, confidential MPT transfer, dynamic MPT, lending, and vaults stay out. They are introduced in the xrpld 3.3.0 and 3.4.0 notes and were not enabled on the 2026-09-23 XRPSCAN fetch.

## Where the repo is

| Surface | Today |
|---|---|
| Network | `anchor/xrpl/config.json` is `testnet` at `wss://s.altnet.rippletest.net:51233` |
| Trusted account | `rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W`, copied in three places |
| Client | `xrpl@^4.1.0`, lockfile resolves **4.6.0** (2026-02-12) in `anchor/xrpl/package.json` and `packages/repomesh-cli/package.json` |
| Current library | **xrpl 5.3.0**, published 2026-09-16. The break that matters shipped in **5.0.0** (2026-06-05) |
| Current server notes | xrpld **3.4.0**, published 2026-09-16. xrpld **3.3.0** was 2026-08-06 |
| Runtime | Workflows use Node 22. The CLI `engines` field still says `>=20` |
| Image | No Dockerfile. No GHCR publish |
| Secret | `.github/workflows/anchor-xrpl.yml` already injects `secrets.XRPL_SEED` and does not print it |
| Explorer | `emit-anchor-event.mjs` picks the host from the memo network. `pages/build-pages.mjs` still hardcodes `https://testnet.xrpl.org/transactions` |

`post-anchor.mjs` calls `Wallet.fromSeed(SEED)` with no algorithm. On 4.6.0 that defaulted to ed25519 for every family seed. On 5.x a classic `s…` seed derives secp256k1, and an `sEd…` seed derives ed25519. A silent upgrade would sign as a different account than the one on the allowlist.

## Order

Each phase ends before the next one starts. The network flip is last, and it waits on a funded account that is never written into the repo.

### 1. Client currency

Bump both `xrpl` ranges to `^5.3.0` and refresh both lockfiles. Raise the CLI engines field to `>=22`, matching the workflows and the xrpl.js 5 recommendation (Node 20 remains supported upstream; this repo already runs 22).

In `post-anchor.mjs`:

- Pass the signing algorithm explicitly. Generate the mainnet wallet with xrpl 5.3.0 and record which prefix it has (`sEd…` or `s…`). The call site names that algorithm. It does not rely on the 4.x default.
- After `Wallet.fromSeed`, require `wallet.address` to equal the configured mainnet account. A mismatch exits 1 before `submitAndWait`.
- Keep the seed-shape check. It still rejects an `r…` address pasted in place of a seed.
- On connect, read `server_info` (`build_version`, `network_id`). xrpl.js 5 already throws when `network_id` is missing, which is rippled older than 1.11. Log the build version on every post and every verify. Warn when it is below **3.4.0**. Do not refuse a public cluster solely for trailing 3.4.0; the library floor is the hard stop.

`submitAndWait` keeps using autofill. With 5.x, a successful connect means `NetworkID` is filled from the server, so a testnet transaction cannot be replayed onto mainnet by omission.

Tests that construct a wallet stay on the explicit algorithm. No test hits a live network.

### 2. One allowlist, and it is a ceiling

`remote-defaults.mjs` says a fetched `config.json` cannot widen the trusted set. `resolveTrustedAccounts` in `packages/repomesh-cli/src/verify/verify-anchor.mjs` unions the bundled list with config, so a merge to `config.json` can add an account that every `npx @mcptoolshop/repomesh` will trust. The in-repo script `anchor/xrpl/scripts/verify-anchor.mjs` does the same union.

Make both resolvers match the comment: the shipped list is the ceiling. Config may drop an account. Config may not add one. One module owns the array. A test fails if `BUNDLED_TRUSTED_ACCOUNTS` and `BUNDLED_TRUSTED_ANCHOR_ACCOUNTS` differ.

The testnet account stays in that list so existing anchors still verify while those transactions exist.

The mainnet address is added to that same list in the release that publishes the CLI. Until that release is on npm, verifiers on 2.3.0 will reject the new account, which is the correct failure.

### 3. Docker image

Publish `ghcr.io/mcp-tool-shop-org/repomesh`, tagged with the CLI version and the git sha.

- Base: Node 22, current Debian slim.
- Process user is not root.
- Default command is the CLI (`verify-release` / `verify-anchor`). A post requires an explicit command.
- `XRPL_SEED` and `REPOMESH_SIGNING_KEY` are runtime environment variables or mounted files. They are not build args and they are not layers.
- The image contains the anchor scripts, the ledger reader, and the built CLI. It does not contain `partition-root.json` or `anchor-result.json` from a workstation.
- A workflow builds and pushes on the same tag that `release.yml` publishes to npm. `anchor-xrpl.yml` then runs that image, so the daily post and the published bytes are the same.

The image does not run xrpld. A full-history rippled is a separate machine, a pinned XRPLF image, and an UNL. That compose profile can follow once the anchor image exists. It is not the package this phase ships.

### 4. Public links follow the memo

`pages/build-pages.mjs` uses the same host map as `explorerTxUri` in `emit-anchor-event.mjs`: mainnet → `livenet.xrpl.org`, testnet → `testnet.xrpl.org`. A page that renders both generations shows each transaction on the network named in its manifest.

English README and handbook gain one operator section: the image name, the required secrets, and the fact that one organization still operates the log, the attestors, the policy check, and the anchor. Translated READMEs stay as they are until a translation pass.

### 5. Mainnet cutover

This phase is an operator action plus a config change. It does not start until phases 1–4 are merged and the CLI release that contains the new address is the npm `latest`.

Operator, off the repo:

1. Create the wallet with xrpl 5.3.0. Write down the classic address and the seed prefix family.
2. Fund it above the base reserve reported by `server_info` on mainnet, plus a fee buffer. AccountSet does not create a ledger object. Do not hardcode a reserve number in the client.
3. Replace the GitHub Actions secret `XRPL_SEED`. The testnet seed is retired from the secret store. The testnet address remains on the allowlist.

Repo, one PR after the secret is in place:

1. `config.json`: `"network": "mainnet"`, `"rippledUrl": "wss://xrplcluster.com"`. `XRPL_WS_URL` still overrides.
2. Add the new address to `trustedAnchorAccounts` and to the bundled ceiling.
3. Run `compute-root` for the full ledger partition and post that one root. That is the durable checkpoint. Historical testnet manifests keep `n: "testnet"` and keep verifying against testnet until a reset drops them. There is no replay of old partitions.

The daily workflow then posts only when `eventCount > 0`. The idle-epoch skip already does that.

### 6. Standing watch

A scheduled job, read-only, records three facts and opens an issue when one changes:

- xrpld stable version from the XRPLF release notes, compared with the floor this repo warns on (3.4.0 today).
- `server_info.build_version` on the configured WebSocket URL.
- XRPSCAN `enabled` for BatchV1_1 and Sponsor.

A change of `enabled` to true is an issue, not a code change. Building those transaction types waits for a new study lock.

Other upgrades that ride along when a workflow file is already open: SHA-pin `actions/checkout` and `actions/setup-node` in `anchor-xrpl.yml` the way `release.yml` already pins them. No drive-by bumps of commander or ajv in the cutover PR.

## What done means

- `npm ls xrpl` in both packages prints 5.3.x, and a wrong seed algorithm cannot submit.
- The published CLI rejects an anchor account that is only listed in a fetched config.
- `docker run ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <mainnet hash>` checks the live transaction.
- `config.json` says mainnet, the first full-ledger checkpoint has a mainnet tx hash, and the testnet account is still on the allowlist.
- Batch and the other 3.3.0/3.4.0 transaction families are still unimplemented.
