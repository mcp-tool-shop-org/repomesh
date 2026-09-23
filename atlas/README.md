# repomesh: how it works

Mapped at 2026-09-23 from commit f13ad8e.

## What this is

18 parts. Work enters through 8 doors; the busiest is registry-ci, which reaches 3 parts and commits into the repository (pages-ci reaches 5 but commits nothing).

## What changed since the last map

This is the first map.

## What comes in

1. **pages-ci.** On a push to main touching 6 paths; or by hand. Runs pages/build-metrics.mjs, pages/build-pages.mjs, pages/build-stats.mjs and 4 more.
2. **registry-ci.** On a push to main touching 5 paths; or by hand. Runs registry/scripts/build-anchors.mjs, registry/scripts/build-badges.mjs, registry/scripts/build-dependencies.mjs and 4 more.
3. **anchor-xrpl.** On a schedule (`0 0 * * *`); or by hand. Runs anchor/xrpl/scripts/compute-root.mjs, anchor/xrpl/scripts/emit-anchor-event.mjs and registry/scripts/build-anchors.mjs.
4. **attestor-ci.** On a schedule (`0 */6 * * *`); or by hand. Runs attestor/scripts/attest-release.mjs, policy/scripts/check-policy.mjs, verifiers/license/scripts/verify-license.mjs and 2 more.
5. **ledger-ci.** On a pull request touching 9 paths; or by hand. Runs ledger/scripts/validate-ledger.mjs.
6. **xrpl-watch.** On a schedule (`0 12 * * 1`), Monday at 12:00 UTC; or by hand. Runs anchor/xrpl/scripts/watch.mjs.
7. **Release.** When a release is published; or by hand. Runs packages/repomesh-cli/scripts/build.mjs and packages/repomesh-cli/tests/.
8. **repomesh-broadcast.** When a release is published; or by hand. Runs packages/repomesh-cli/scripts/build.mjs.

## What happens through registry-ci

1. The workflow runs 7 files in registry.
   1. Inside registry/scripts/build-trust.mjs, build trust does, in order:
      1. policy (verifiers, 4 steps)
      2. parse anchor partition meta
      3. canonicalize for hash (ledger)
      4. node kinds for event
      5. resolve trusted signature time sync
      6. derive constraints for repo
      7. merge stricter window
      8. is key valid for signature
      9. is registered check
      10. write json atomic
   2. **Resolve trusted signature time sync** (verifiers) runs, in order: find earliest anchor for leaf and is bundled trusted anchor.
2. That reaches ledger (1 file) and verifiers (4 files).
3. It writes to registry/anchors.json, registry/badges/, registry/capabilities.json, registry/dependencies.json, registry/nodes.json, registry/snippets/, registry/trust.json and registry/verifiers.json.
4. It commits registry/anchors.json, registry/badges/, registry/capabilities.json, registry/dependencies.json, registry/nodes.json, registry/snippets/, registry/trust.json and registry/verifiers.json, then pushes.
5. It opens a pull request.

## Who reads the results

- **registry/** is read by the repository root (8 README files), packages/repomesh-cli/src/verify/verify-all.mjs, pages/build-pages.mjs, pages/build-stats.mjs, pages/build-status.mjs and scripts/verify.sh (found by text).

## The other doors

**pages-ci** runs pages/build-metrics.mjs, pages/build-pages.mjs, pages/build-stats.mjs and 4 more, reaches anchor, ledger and verifiers, writes to pages/, registry/ and site/src/, and deploys the site.

**anchor-xrpl** runs anchor/xrpl/scripts/compute-root.mjs, anchor/xrpl/scripts/emit-anchor-event.mjs and registry/scripts/build-anchors.mjs, reaches verifiers, writes to anchor/xrpl/, ledger/events/events.jsonl and registry/anchors.json, commits anchor/xrpl/manifests/*.json, ledger/events/events.jsonl and registry/anchors.json, then pushes, opens an issue when it fails, and opens a pull request.

**attestor-ci** runs attestor/scripts/attest-release.mjs, policy/scripts/check-policy.mjs, verifiers/license/scripts/verify-license.mjs and 2 more, writes to ledger/events/events.jsonl, commits ledger/events/events.jsonl and pushes, opens an issue when it fails, and opens a pull request.

**ledger-ci** runs ledger/scripts/validate-ledger.mjs and reaches verifiers.

**xrpl-watch** runs anchor/xrpl/scripts/watch.mjs, reaches repomesh-cli, and opens an issue.

**Release** runs packages/repomesh-cli/scripts/build.mjs and packages/repomesh-cli/tests/, and publishes to npm and a container image.

**repomesh-broadcast** runs packages/repomesh-cli/scripts/build.mjs, writes to ledger/events/events.jsonl, commits ledger/events/events.jsonl and pushes, and opens a pull request.

## What breaks what

- **verifiers** is imported by 5 parts (anchor, attestor, ledger, registry, tools) and sits on the path of 5 doors.
- **anchor** is imported by 2 parts (pages, tools) and sits on the path of 3 doors.
- **repomesh-cli** is imported by 2 parts (anchor, tools) and sits on the path of 3 doors.
- **ledger** is imported by 1 part (registry), and by 1 more only from tests; it sits on the path of 3 doors.
- **registry** is imported only from tests, by 1 part (tools), and sits on the path of 3 doors.
- **ledger/events/** is written by .github, attestor and repomesh-cli, and read by .github, anchor, attestor, ledger, pages, policy, registry, repomesh-cli, tools and verifiers; a hand edit reaches every reader.
- **ledger/nodes/** is written by attestor and tools, and read by attestor, ledger, policy, registry, repomesh-cli, tools and verifiers; a hand edit reaches every reader.

## What tends to change together

- **ledger/scripts/validate-ledger.mjs** and **registry/scripts/build-trust.mjs** changed together in 5 of 5 commits, and the registry part imports the ledger part.

Confidence is low: fewer than 20 source files reach 10 revisions in the window.

Window: 180 days; a pair counts from 3 shared commits.

## What no test touches

Every code part is imported by at least one test.

## Written but never read

- **registry/capabilities.json** is written by .github/workflows/registry-ci.yml and registry/scripts/build-registry.mjs, and read by nothing else in this repository.
- **registry/dependencies.json** is written by .github/workflows/registry-ci.yml and registry/scripts/build-dependencies.mjs, and read by nothing else in this repository.
- **registry/snippets/** is written by .github/workflows/registry-ci.yml and registry/scripts/build-snippets.mjs, and read by nothing else in this repository.
- **site/src/** is written by pages/build-stats.mjs and read by nothing else in this repository.

## Helpers that look duplicated

These are candidates from names and call order, not a judgement.

- **__deriveLegacyForTests** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **deriveKeyWindowConstraints** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **isKeyValidForSignature** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **keyWindow** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **mergeStricterWindow** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.

And 9 more pairs.

## Generated, never hand-edited

- **.github/workflows/** is written by packages/repomesh-cli/src/init.mjs and tools/init-node.mjs.
- **.gitignore** is written by packages/repomesh-cli/src/init.mjs and tools/init-node.mjs.
- **anchor/xrpl/** is written by .github/workflows/anchor-xrpl.yml, anchor/xrpl/scripts/compute-root.mjs and anchor/xrpl/scripts/post-anchor.mjs.
- **ledger/events/** is written by .github/workflows/anchor-xrpl.yml, .github/workflows/attestor-ci.yml, .github/workflows/repomesh-broadcast.yml, attestor/scripts/emit-key-event.mjs and packages/repomesh-cli/src/key/rotate-revoke.mjs.
- **ledger/nodes/** is written by attestor/scripts/emit-key-event.mjs, tools/join-node.mjs and tools/register-node.mjs.
- **node.json** is written by packages/repomesh-cli/src/init.mjs and tools/init-node.mjs.
- **pages/** is written by pages/build-pages.mjs and pages/build-status.mjs.
- **registry/** is written by pages/build-metrics.mjs and pages/build-timeline.mjs.
- **registry/anchors.json** is written by .github/workflows/anchor-xrpl.yml and .github/workflows/registry-ci.yml.
- **registry/badges/** is written by .github/workflows/registry-ci.yml and registry/scripts/build-badges.mjs.
- **registry/capabilities.json** is written by .github/workflows/registry-ci.yml and registry/scripts/build-registry.mjs.
- **registry/dependencies.json** is written by .github/workflows/registry-ci.yml and registry/scripts/build-dependencies.mjs.
- **registry/nodes.json** is written by .github/workflows/registry-ci.yml and registry/scripts/build-registry.mjs.
- **registry/snippets/** is written by .github/workflows/registry-ci.yml and registry/scripts/build-snippets.mjs.
- **registry/trust.json** is written by .github/workflows/registry-ci.yml.
- **registry/verifiers.json** is written by .github/workflows/registry-ci.yml and registry/scripts/build-verifiers.mjs.
- **site/src/** is written by pages/build-stats.mjs.

## Hand-authored

People write assets/, docs/, profiles/, schemas/, scripts/ and templates/. Nothing in this repository writes to them.

## Where to start

.github/workflows/registry-ci.yml → registry/scripts/build-anchors.mjs → verifiers/lib/anchor-notes.mjs → registry/ → packages/repomesh-cli/src/verify/verify-all.mjs

Read those in order to follow one push end to end.

## What this map cannot see

- 103 import sites could not be resolved.
- 13 writes and 74 reads use paths built at run time and are not named here.
- Readers marked (found by text) come from scanning unparsed files.
- Statistics confidence is low: fewer than 20 source files reach 10 revisions in the window.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
