# repomesh: how it works

Mapped at 2026-10-25 from commit 2081a4b by Atlas 1.24.0.

## What this is

18 parts, mostly JavaScript (180 files), CSS (3), TypeScript (2), Astro (1) and shell (1). Work enters through 11 doors; the busiest is ledger-ci, which reaches 9 parts. It publishes @mcptoolshop/repomesh to npm and a container image. It deploys a site to GitHub Pages. People run repomesh. People import @mcptoolshop/repomesh. Other repositories use the RepoMesh verify-release action.

## What changed since 2026-10-24 (5716064)

- ledger-ci now also starts on a push to main touching 18 paths.
- ledger-ci now also runs anchor/xrpl/tests/, attestor/tests/, ledger/tests/ and 7 more.
- registry-ci now also starts when the workflow ledger-ci completes.
- And 1 more change to a door.
- .github/workflows/ is now read by registry/tests/registry-ci-follower.test.mjs.
- .github/workflows/registry-ci.yml is now read by .github/workflows/registry-ci.yml and registry/tests/registry-ci-follower.test.mjs.
- README.md is now also read by registry/tests/registry-ci-follower.test.mjs.
- And 12 more new writers and readers of places.
- 5 files added and 55 changed content, across 11 parts.

## What comes in

1. **ledger-ci.** On a pull request; on a push to main touching 18 paths; or by hand. Runs ledger/scripts/validate-ledger.mjs, packages/repomesh-cli/scripts/build.mjs, anchor/xrpl/tests/ and 102 more.
2. **Release.** When a release is published; or by hand. Runs packages/repomesh-cli/scripts/build.mjs; packs anchor/xrpl/config.json, anchor/xrpl/package-lock.json, anchor/xrpl/package.json and 68 more into an image. On a release event, it also runs packages/repomesh-cli/tests/.
3. **anchor-xrpl.** On a schedule (`0 0 * * *`); or by hand. Runs anchor/xrpl/scripts/compute-root.mjs, anchor/xrpl/scripts/emit-anchor-event.mjs, packages/repomesh-cli/scripts/build.mjs and 1 more; packs anchor/xrpl/config.json, anchor/xrpl/package-lock.json, anchor/xrpl/package.json and 68 more into an image.
4. **pages-ci.** On a push to main touching 6 paths; or by hand. Runs pages/build-metrics.mjs, pages/build-pages.mjs, pages/build-stats.mjs and 7 more.
5. **attestor-ci.** On a schedule (`0 */6 * * *`); or by hand. Runs attestor/scripts/attest-release.mjs, policy/scripts/check-policy.mjs, verifiers/license/scripts/verify-license.mjs and 2 more; checks LICENSE.
6. **registry-ci.** When the workflow ledger-ci completes; or by hand. Runs registry/scripts/build-anchors.mjs, registry/scripts/build-badges.mjs, registry/scripts/build-dependencies.mjs and 4 more.
7. **xrpl-watch.** On a schedule (`0 12 * * 1`), Monday at 12:00 UTC; or by hand. Runs anchor/xrpl/scripts/watch.mjs.
8. **repomesh-broadcast.** When a release is published; or by hand. Runs packages/repomesh-cli/scripts/build.mjs.
9. **@mcptoolshop/repomesh** (the package people import). Loads packages/repomesh-cli/dist/index.mjs, built from a source this map cannot place.
10. **RepoMesh verify-release** (an action other repositories use). Runs no file this map can see.
11. **repomesh** (a command people run). Runs packages/repomesh-cli/dist/cli.mjs, built from a source this map cannot place.

## What happens through ledger-ci

1. The workflow runs ledger/scripts/validate-ledger.mjs and ledger/tests/ in ledger, packages/repomesh-cli/scripts/build.mjs and packages/repomesh-cli/tests/ in repomesh-cli, anchor/xrpl/tests/ in anchor, attestor/tests/ in attestor, pages/tests/ in pages, and 48 files in 4 more parts.
2. It writes to ledger/nodes/, registry/anchors.json and registry/trust.json.
3. It also writes to packages/repomesh-cli/dist/ and pages/out/, which are not tracked.

## Who reads the results

- **ledger/nodes/** is read by attestor/scripts/attest-release.mjs, ledger/scripts/validate-ledger.mjs, ledger/scripts/verify-release.mjs, policy/scripts/check-policy.mjs, registry (5 files) and tools/verify-release.mjs, and by 5 tests.
- **registry/** is read by packages/repomesh-cli/src/verify/verify-all.mjs, pages (5 files) and scripts/verify.sh (found by text).

## The other doors

**Release** runs packages/repomesh-cli/scripts/build.mjs, packs anchor/xrpl/config.json, anchor/xrpl/package-lock.json, anchor/xrpl/package.json and 68 more into an image, runs packages/repomesh-cli/tests/ on a release event, reaches ledger, pages, registry, tools and verifiers, writes to packages/repomesh-cli/dist/, which is not tracked, publishes a container image, and publishes @mcptoolshop/repomesh to npm on a release event.

**anchor-xrpl** runs anchor/xrpl/scripts/compute-root.mjs, anchor/xrpl/scripts/emit-anchor-event.mjs, packages/repomesh-cli/scripts/build.mjs and 1 more, packs anchor/xrpl/config.json, anchor/xrpl/package-lock.json, anchor/xrpl/package.json and 68 more into an image, reaches ledger, pages, tools and verifiers, writes to anchor/xrpl/manifests/, ledger/events/events.jsonl, registry/anchors.json and registry/trust.json, and to anchor/xrpl/partition-root.json and packages/repomesh-cli/dist/, which are not tracked, commits anchor/xrpl/manifests/*.json, ledger/events/events.jsonl and registry/anchors.json, then pushes to a branch for review, never to main, opens an issue when it fails, and opens a pull request.

**pages-ci** runs pages/build-metrics.mjs, pages/build-pages.mjs, pages/build-stats.mjs and 7 more, reaches anchor, ledger and verifiers, writes to registry/anchors.json, registry/badges/, registry/snippets/ and registry/trust.json, and to pages/out/, registry/metrics.json, registry/timeline.json and 2 more places, which are not tracked, and deploys the site.

**attestor-ci** runs attestor/scripts/attest-release.mjs, policy/scripts/check-policy.mjs, verifiers/license/scripts/verify-license.mjs and 2 more, checks LICENSE, writes to ledger/events/events.jsonl, registry/anchors.json and registry/trust.json, commits ledger/events/events.jsonl and pushes to a branch for review, never to main, runs git, opens an issue when it fails, and opens a pull request.

**registry-ci** runs registry/scripts/build-anchors.mjs, registry/scripts/build-badges.mjs, registry/scripts/build-dependencies.mjs and 4 more, reaches ledger and verifiers, writes to registry/anchors.json, registry/badges/, registry/capabilities.json, registry/dependencies.json, registry/nodes.json, registry/snippets/, registry/trust.json and registry/verifiers.json, commits registry/anchors.json, registry/badges/, registry/capabilities.json, registry/dependencies.json, registry/nodes.json, registry/snippets/, registry/trust.json and registry/verifiers.json, then pushes to a branch for review, never to main, and opens a pull request.

**xrpl-watch** runs anchor/xrpl/scripts/watch.mjs, reaches repomesh-cli, and opens an issue.

**repomesh-broadcast** runs packages/repomesh-cli/scripts/build.mjs, writes to packages/repomesh-cli/dist/, which is not tracked, commits into a clone of mcp-tool-shop-org/repomesh and pushes there, uploads provenance.json and sbom.json to the release, and opens a pull request.

**@mcptoolshop/repomesh** (the package people import) loads packages/repomesh-cli/dist/index.mjs, built from a source this map cannot place.

**RepoMesh verify-release** (an action other repositories use) runs no file this map can see and scans code with CodeQL.

**repomesh** (a command people run) runs packages/repomesh-cli/dist/cli.mjs, built from a source this map cannot place.

## What breaks what

- **verifiers** is imported by 5 parts (anchor, attestor, ledger, registry, tools), and by 1 more only from tests; it sits on the path of 6 doors.
- **repomesh-cli** is imported by 2 parts (anchor, tools), and by 1 more only from tests; it sits on the path of 5 doors.
- **anchor** is imported by 2 parts (pages, tools) and sits on the path of 5 doors.
- **ledger** is imported by 1 part (registry), and by 1 more only from tests; it sits on the path of 5 doors.
- **registry** is run as a child process by 2 parts (repomesh-cli, tools) and sits on the path of 5 doors.
- **pages** is run as a child process by 2 parts (repomesh-cli, tools) and sits on the path of 4 doors.
- **ledger/events/events.jsonl** is written by .github, attestor and repomesh-cli, and read by .github, anchor, attestor, ledger, pages, policy, registry, repomesh-cli and tools, and by 6 tests; a hand edit reaches every reader.
- **registry/trust.json** is written by verifiers and read by pages, registry, repomesh-cli, scripts and verifiers; a hand edit reaches every reader.

## What tends to change together

- **packages/repomesh-cli/src/verify/key-window.mjs** and **verifiers/lib/key-window.mjs** changed together in 6 of 6 commits, and the repomesh-cli part imports the verifiers part.
- **packages/repomesh-cli/src/verify/verify-release.mjs** and **tools/verify-release.mjs** changed together in 8 of 9 commits, and the tools part imports the repomesh-cli part.
- **ledger/scripts/validate-ledger.mjs** and **registry/scripts/build-trust.mjs** changed together in 6 of 8 commits, and the ledger part and the registry part import each other.
- **registry/scripts/build-trust.mjs** and **tools/verify-release.mjs** changed together in 6 of 9 commits, and the tools part imports the registry part.
- **packages/repomesh-cli/src/remote-defaults.mjs** and **tools/verify-release.mjs** changed together in 5 of 8 commits, and the tools part imports the repomesh-cli part.

Confidence is low: fewer than 25 source files reach 10 revisions in the window.

Window: 180 days; a pair counts from 3 shared commits, since 0 source files reach 10 revisions; the floor rises to 10 when 25 do.

## What no test touches

Every code part is imported by at least one test.

## Written but never read

- **registry/capabilities.json** is written by registry/scripts/build-registry.mjs and read by nothing else in this repository.
- **registry/dependencies.json** is written by registry/scripts/build-dependencies.mjs and read by nothing else in this repository.
- **registry/snippets/** is written by registry/scripts/build-snippets.mjs and read by nothing else in this repository.

## Helpers that look duplicated

These are candidates from names and call order, not a judgement.

- **__deriveLegacyForTests** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **deriveKeyWindowConstraints** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **isBundledTrustedAnchorEvent** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **isKeyValidForSignature** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **isSignerTrustedForCheck** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.

And 12 more pairs.

## Generated, never hand-edited

- **anchor/xrpl/manifests/** is written by anchor/xrpl/scripts/compute-root.mjs.
- **ledger/events/events.jsonl** is written by .github/workflows/anchor-xrpl.yml, .github/workflows/attestor-ci.yml, attestor/scripts/emit-key-event.mjs and packages/repomesh-cli/src/key/rotate-revoke.mjs.
- **ledger/nodes/** is written by attestor/scripts/emit-key-event.mjs, tools/join-node.mjs and tools/register-node.mjs.
- **registry/anchors.json** is written by verifiers/lib/common.mjs.
- **registry/badges/** is written by registry/scripts/build-badges.mjs.
- **registry/capabilities.json** is written by registry/scripts/build-registry.mjs.
- **registry/dependencies.json** is written by registry/scripts/build-dependencies.mjs.
- **registry/nodes.json** is written by registry/scripts/build-registry.mjs.
- **registry/snippets/** is written by registry/scripts/build-snippets.mjs.
- **registry/trust.json** is written by verifiers/lib/common.mjs.
- **registry/verifiers.json** is written by registry/scripts/build-verifiers.mjs.

## Hand-authored

People write .github/, assets/, docs/, profiles/, the repository root, schemas/, scripts/, site/ and templates/. Nothing in this repository writes to them.

## Where to start

.github/workflows/ledger-ci.yml → ledger/scripts/validate-ledger.mjs

Read those in order to follow one pull request end to end.

## What this map cannot see

- 108 imports could not be resolved: `attestor/tests/emit-key-event.test.mjs` imports a path built at run time, twice; `packages/repomesh-cli/tests/anchor-leaf-window.test.mjs` imports a path built at run time; `packages/repomesh-cli/tests/anchor-prev-chain.test.mjs` imports a path built at run time, twice; and 103 more.
- 6 reads use paths built at run time and are not named here.
- 23 writes go to places this repository does not track, so they are not listed as generated.
- 38 writes and 153 reads go to a path their caller passes, not to this repository.
- 7 writes and 13 reads go to the directory the command is run in (.repomesh-tmp/, anchor/ and ledger/) or a path their caller passes, not to this repository.
- 12 reads go to the directory the command is run in (anchor/, ledger/ and verifiers/), not to this repository.
- 1 read goes to a temporary directory, not to this repository.
- 13 commands are built at run time and not followed, all of them in tests.
- Readers marked (found by text) come from scanning unparsed files.
- Statistics confidence is low: fewer than 25 source files reach 10 revisions in the window.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
