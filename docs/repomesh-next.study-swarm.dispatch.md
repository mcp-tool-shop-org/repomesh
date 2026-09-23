# Study-swarm dispatch — what to develop next in RepoMesh

**Date:** 2026-09-23
**Trigger:** Director said `study-swarm` on how to further develop this repo.
**Product:** RepoMesh (`@mcptoolshop/repomesh` 2.3.0). Append-only signed ledger, six nodes all in `mcp-tool-shop-org`, last event 2026-06-22. Reserved and not emitted: `BreakingChangeDetected`, `HealthCheckFailed`, `DependencyVulnFound`, `InterfaceUpdated`. `PolicyViolation` is schema-valid and the emitter exists; the live ledger has one warning (artifact-hash collision) and zero ledgered violations. The daily XRPL anchor cron exits 1 when `eventCount` is 0.

## Questions

1. Which reserved supply-chain signals do consumers actually use?
2. When should a transparency log stay operator-run versus open to external submitters, and what fails when the log, its attestors, and its monitors are one party?
3. What does a successful checkpoint epoch look like when the log did not grow, and what should page?
4. What measured friction decides whether maintainers publish verifiable provenance?

## Step 4 verification

`PRISM_DEV=1 node E:\AI\role-os\bin\roleos.mjs verify-citations` on 2026-09-23. Prism had no production signing key; dev mode is the local runner, not a skipped gate. Verdict **escalate** (advisory, 0 fabricated). Receipt `docs/repomesh-next.study-swarm.dispatch.citation-receipt.json` (`prism-01m37104ef9cqhs7t3gf22nhk9`).

| Item | Result |
|------|--------|
| 2 Shan 2026, 5 Schorlemmer 2024, 7 Tamanna 2024, 8 Kalu 2025, 9 Kalu 2026 | accept, supported |
| 1 Kalu 2024 | exists; groundedness lens timed out. Withdrawn from the lock. |
| 3 Stalnaker 2024, 11 Samuel 2010 | exist; no abstract returned. Withdrawn. |
| 4 Zahan 2024, 6 Zahan 2022, 10 Chuat 2015 | exist; the sentence used here is not in the title or abstract. Withdrawn. |
| 12–13 RFC 9162, 14 Chrome CT policy, 15 Tessera v1.0.4, 16 SRE book | no arXiv/DOI, so the runner left them unparsed. Fetched and checked against the page text below. |

Finding 7's supporting span is the abstract sentence on complex implementation and unclear communication. The issue counts (176 provenance, 200 verification) are not in that span, so the lock does not use them.

## Research grounding (the dispatch's empirical floor)

1. **Practitioners rarely verify third-party signatures, and a signature is usually not a selection factor.** Kalu, Singla, Okafor, Torres-Arias, and Davis 2024 (arXiv:2406.08198). Of 18 practitioners in 13 organizations, three reported verifying dependency signatures. Implication: a new badge or event type that nobody is required to check does not change an install decision.

2. **Coding assistants almost never open an SBOM, signed release, or build attestation before installing, and the presence of those signals had no measured effect.** Shan 2026 (arXiv:2609.07754). In 1,920 registered install trials, assistants opened such a signal in 9 trials and ran a verification command in none (registered fallback test, p = 0.50). Implication: publishing more optional evidence does not move an installer that never invokes verify.

3. **SBOM stakeholders use the document for dependency and vulnerability management, and a vulnerable dependency is not the same as an impacted product.** Stalnaker, Wintersgill, Chaparro, Di Penta, German, and Poshyvanyk 2024 (doi:10.1145/3597503.3623347). Of 61 practitioners, 55 named dependency management and 22 named vulnerability management as a main use. Implication: a `DependencyVulnFound` event that restates "a CVE exists" is a weaker signal than a status that says whether the release is affected.

4. **Industry attendees were skeptical of VEX because it is a developer claim that vulnerable code is non-exploitable, and some enforced in-toto so the build checkout matches the release.** Zahan, Acar, Cukier, Enck, Kästner, Kapravelos, Wermke, and Williams 2024 (arXiv:2408.16529). Implication: a self-asserted policy or non-exploitability event is the claim class this group did not trust; a layout that requires the signed source to match the release is the claim class some of them enforced.

5. **Artifact signing rates follow a registry mandate, not attack publicity or a new standard.** Schorlemmer, Kalu, Chigges, Ko, Abu Isghair, Baghi, Torres-Arias, and Davis 2024 (arXiv:2401.14635). In 2023 every measured registry except Maven Central had under 2% of artifacts signed; Maven Central, the registry that mandates signing, had 97.1% signed. Implication: adoption work belongs in a required gate, not in another optional profile.

6. **Signed GitHub release files are rare on npm and PyPI.** Zahan, Kanakiya, Hambleton, Shohan, and Williams 2022 (arXiv:2208.03412). Of packages listed in April 2022, 578 npm packages (0.1%) and 936 PyPI packages (0.5%) had a signed GitHub release file. Implication: a release-file signature badge is not the surface those ecosystems actually publish.

7. **SLSA deployment issues concentrate on implementation complexity, including provenance generation and whether attestation verification is feasible.** Tamanna, Hamer, Tran, Fahl, Acar, and Williams 2024 (arXiv:2409.05014). In 1,523 issues from 233 repositories, the largest class was complex implementation (901), including 176 on provenance generation and 200 on limited feasibility of attestation verification. Implication: the next increment should make an existing verify step runnable in CI, not add a check kind whose verification path is still unbuilt.

8. **Sigstore's identity-based pieces differ in maturity, and integration flexibility is a reported pain point.** Kalu, Okorafor, Singla, Chen, Torres-Arias, and Davis 2025 (arXiv:2503.00271). Interviews with 17 industry experts. Implication: a second signing system is not the adoption lever; the pain is wiring the check into the maintainer's existing release path.

9. **Verification workflows and policy configuration stayed friction points across identity-based signing projects even as raw issue counts fell.** Kalu, Tran, Torres-Arias, Jeong, and Davis 2026 (arXiv:2603.17133). Across about 3,900 GitHub issues from November 2021 to November 2025. Implication: `verify-release` exit codes and the GitHub Action are the surface to harden, because verification policy is where the friction remained.

10. **A malicious log can prove an entry to some clients and hide it from the monitors.** Chuat, Szalachowski, Perrig, Laurie, and Messeri 2015 (arXiv:1511.01514). Implication: more nodes registered by the log operator are not witnesses. A witness has to be a party the operator cannot partition.

11. **Splitting duties across roles does not limit compromise when the same keys are used for every role.** Samuel, Mathewson, Cappos, and Dingledine 2010 (doi:10.1145/1866307.1866315). Implication: the attestor key, the anchor key, and the registry maintainer key have to be distinct before a same-org network can claim separation of duties.

12. **If a log accepts no submissions during one maximum merge delay, it must sign the same Merkle tree hash with a newer timestamp, and clients must be able to fetch a signed tree head no older than that delay.** Laurie, Messeri, and Stradling 2021 (RFC 9162, https://www.rfc-editor.org/rfc/rfc9162). Section 4.10. Implication: an idle epoch is a successful signed checkpoint, not a failed job. The pageable condition is a missing or stale checkpoint, not a tree that did not grow.

13. **A log may accept submissions from any entity, and until a gossip protocol exists each log is a trusted third party because a log that shows inconsistent views can circumvent its auditors.** Laurie, Messeri, and Stradling 2021 (RFC 9162, https://www.rfc-editor.org/rfc/rfc9162). Sections 4.1 and 4.10–5. Implication: opening registration without an independent monitor does not remove the single-operator trust assumption; it adds a spam surface.

14. **Chrome expects a new recognized log operator to be organizationally independent of every existing recognized operator.** Chrome Certificate Transparency Log Policy, last-modified 3 September 2026 (https://googlechrome.github.io/CertificateTransparency/log_policy.html). Implication: six nodes in one GitHub org do not meet an independence bar. The honest description is one operator.

15. **Tessera republishes an unchanged checkpoint on an interval so the log is visibly live when no entries were added, and a republish interval of zero disables that republication.** Tessera authors 2024 (`append_lifecycle.go` v1.0.4, https://github.com/transparency-dev/tessera/blob/v1.0.4/append_lifecycle.go). Default republish interval stated in that file: 10 minutes. Implication: liveness is a republish of the last root, separate from "there were new leaves."

16. **A page that only merits a robotic response should not be a page; pages are for conditions that are urgent, actionable, and user-visible.** Ewaschuk, in Beyer (ed.) 2017 (https://sre.google/sre-book/monitoring-distributed-systems/). Implication: the anchor cron commenting "still failing" on an empty partition is the robotic page. The actionable page is a checkpoint older than the stated bound while new events exist, or a crash.

## Architectural lock

Only findings the gate marked supported, plus 12–16 where the fetched page contains the sentence.

**A. An idle anchor is a successful epoch.** Laurie, Messeri, and Stradling 2021, RFC 9162 §4.10: if the log accepts no submissions during one maximum merge delay, it must sign the same Merkle tree hash with a fresh timestamp, and a client must be able to fetch a signed tree head no older than that delay. Ewaschuk, in Beyer (ed.) 2017: every page should be actionable, and a page that only merits a robotic response should not be a page. Chrome's CT log policy names merge delay as an alert candidate, which is staleness of inclusion, not "zero new leaves." Tessera v1.0.4 separates the two: `WithCheckpointRepublishInterval` republishes a checkpoint whose tree did not grow (default 10 minutes; a value ≤ 0 disables it), and the "log is live even if no entries are being added" note sits on the checkpoint interval.

RepoMesh change: `anchor-xrpl` exits 0 when `compute-root --since-last` reports `eventCount: 0`. The page stays for a crashed run, and for a checkpoint that is stale while events are waiting. Republishing the last root on a timer is a later liveness signature, not the fix for the false alarm.

**B. The next product increment is a required verify step, not the reserved event types.** Shan 2026 (arXiv:2609.07754): in 1,920 registered trials an assistant opened a provenance signal in 9 and ran a verification command in none, and signal presence had no measured effect. Schorlemmer et al. 2024 (arXiv:2401.14635): signing quantity tracks registry policy, not publicity about attacks or a new standard. Tamanna et al. 2024 (arXiv:2409.05014): the reported SLSA difficulties are complex implementation and unclear communication. Kalu et al. 2025 (arXiv:2503.00271): identity-based signing components differ in maturity, and integration flexibility is a common pain. Kalu et al. 2026 (arXiv:2603.17133): verification workflows and configuration surfaces stay friction points.

RepoMesh change: do not spend the next release emitting `BreakingChangeDetected`, `HealthCheckFailed`, `DependencyVulnFound`, or `InterfaceUpdated`. Put the effort on `verify-release` and `.github/actions/verify` as a required release gate in the adopter's repo — the mandate shape — and on making that gate's failure legible. `PolicyViolation` stays the error-only ledger event the emitter already builds.

**C. This network is one operator until a witness is someone else.** RFC 9162: any entity can submit a certificate, and a log that can show inconsistent views is a trusted third party until a gossip mechanism exists. Chrome's CT policy: an applicant asserts organizational independence from every existing recognized operator. Tessera's default witness group contacts zero witnesses.

RepoMesh change: do not treat more nodes under `mcp-tool-shop-org` as a federation, and do not open registration as the growth plan. The docs should say one operator. An independent witness is the step that would change that description.

## Left out of the lock

You may have expected these to carry the plan. They are real papers. The gate could not confirm the sentence used here, so they do not.

- Kalu et al. 2024 (arXiv:2406.08198) — the "3 of 18 practitioners verify signatures" count. The groundedness lens timed out.
- Stalnaker et al. 2024 (doi:10.1145/3597503.3623347) — the SBOM use-case counts. No abstract came back.
- Zahan et al. 2024 (arXiv:2408.16529) — VEX skepticism and in-toto enforcement. Not in the title or abstract.
- Zahan et al. 2022 (arXiv:2208.03412) — the 0.1% npm signed-release figure. Not in the title or abstract.
- Chuat et al. 2015 (arXiv:1511.01514) — the split-world sentence. The abstract is about gossip protocols, not that attack description.
- Samuel et al. 2010 (doi:10.1145/1866307.1866315) — same keys across roles. No abstract came back.
