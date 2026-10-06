# Study-swarm dispatch — XRPL, last six months

**Date:** 2026-09-23
**Window:** 2026-03-23 through 2026-09-23. Sources outside that window are not load-bearing.
**Product:** RepoMesh posts a JSON memo (`repomesh-anchor-v1`, about 700 bytes) on an AccountSet transaction to XRPL testnet.

## Questions

1. Which protocol changes in the window affect memos, fees, or finality, and which are enabled?
2. What identity primitives shipped, and what can a third party read from the ledger?
3. Which new transaction types are enabled, and what do they store?
4. What was documented about testnet resets and keeping a proof afterward?

## Step 4

`roleos verify-citations` resolves arXiv ids and DOIs only. These sources are XRPLF release notes and an amendment-status API, so that runner does not adjudicate them. The sentences below were checked by opening the page on 2026-09-23.

Opened and used:

- https://xrpl.org/blog/2026/xrpld-3.3.0 (publication date 2026-08-06)
- https://xrpl.org/blog/2026/xrpld-3.4.0 (publication date 2026-09-16)
- https://xrpl.org/docs/concepts/networks-and-servers/parallel-networks (page says last updated 3 months before this fetch)
- https://api.xrpscan.com/api/v1/amendment/BatchV1_1
- https://api.xrpscan.com/api/v1/amendment/fixCleanup3_3_0
- https://api.xrpscan.com/api/v1/amendment/Sponsor
- https://api.xrpscan.com/api/v1/amendment/Credentials
- https://api.xrpscan.com/api/v1/amendment/PermissionedDomains

The known-amendments HTML was fetched. Its status column renders as "Loading..." without JavaScript, so enabled/disabled comes from the XRPSCAN responses above, not from that HTML.

## Research grounding

1. **xrpld 3.3.0 introduces BatchV1_1, ConfidentialTransfer, DynamicMPT, PermissionDelegationV1_1, Sponsor, and fixCleanup3_3_0.** XRPLF, 2026-08-06 (https://xrpl.org/blog/2026/xrpld-3.3.0). The post says Batch submits up to 8 inner transactions, Sponsor covers fees and reserves while the sponsee keeps the keys, and the release uses a weighted median when aggregating close-time offsets. Introducing an amendment is not the same sentence as enabling it.

2. **xrpld 3.4.0 introduces LendingProtocolV1_1 and fixCleanup3_4_0, and caps TMTransactions while charging a fee for undeserializable transactions.** XRPLF, 2026-09-16 (https://xrpl.org/blog/2026/xrpld-3.4.0). Neither release note describes a change to AccountSet memo layout.

3. **BatchV1_1 is not enabled. Sponsor is not enabled. fixCleanup3_3_0 is enabled.** XRPSCAN amendment API, fetched 2026-09-23. BatchV1_1: `enabled` false, `count` 30, `threshold` 28, `majority` 842796401 (2026-09-15). Sponsor: `enabled` false, `count` 6, `threshold` 28. fixCleanup3_3_0: `enabled` true, `enabled_on` 2026-09-11.

4. **Ripple can reset Testnet or Devnet at any time, and test XRP is lost on reset.** XRPLF parallel-networks doc (https://xrpl.org/docs/concepts/networks-and-servers/parallel-networks). The page says those networks do not use diverse, censorship-resistant validator sets.

## Left out of the lock

Credentials is enabled on mainnet with `enabled_on` 2025-09-04, and PermissionedDomains with `enabled_on` 2026-02-04. Both dates are before 2026-03-23, so this window does not treat them as a new feature. XLS-87 and XLS-90 were reported by the research lane and were not re-opened in this check, so they are not connected below.

## Architectural lock

**A. Do not build batch, sponsor, vault, lending, dynamic-MPT, or confidential-transfer support.** The 3.3.0 and 3.4.0 posts introduce those amendments. XRPSCAN, fetched the same day as this dispatch, still has BatchV1_1 and Sponsor disabled. Batch has a majority dated 2026-09-15 and is the nearest one that could turn on if that majority holds for two weeks. It is not on today. fixCleanup3_3_0 is on, and the 3.3.0 notes describe it as bug fixes, including pseudo-account signatures failing with `tefBAD_AUTH`.

**B. Keep the AccountSet memo.** The opened release notes do not change that memo. Batch would be a different way to submit transactions, and it is not enabled.

**C. The web3 work this window supports is a mainnet anchor.** The parallel-networks page says a testnet reset drops test XRP and that Ripple can reset Testnet or Devnet at any time. No page opened in this check announced a notary that keeps a testnet proof after a reset. `post-anchor.mjs` already documents the mainnet switch (network, funded account, allowlist). That is the feature. It needs a funded mainnet account; it is not a code experiment on testnet.

**D. Keep reading the validated transaction close time.** 3.3.0 changed how servers aggregate close-time votes. RepoMesh already uses the close time on the validated transaction, not its own average of votes.
