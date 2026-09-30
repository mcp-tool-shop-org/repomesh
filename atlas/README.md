# repomesh: how it works

Mapped at 2026-09-30 from commit b6e00d6 by Atlas 1.24.0.

## What this is

18 parts, mostly JavaScript (175 files), CSS (3), TypeScript (2), Astro (1) and shell (1). Work enters through 11 doors; Release and anchor-xrpl each reach 8 parts, and Release is followed because it comes first by name. It publishes @mcptoolshop/repomesh to npm and a container image. It deploys a site to GitHub Pages. People run repomesh. People import @mcptoolshop/repomesh. Other repositories use the RepoMesh verify-release action.

## What changed since 2026-09-23 (f13ad8e)

- repomesh-cli now imports verifiers.
- RepoMesh verify-release (.github/actions/verify/action.yml) is a new action other repositories use. It runs no file this map can see.
- anchor-xrpl now also runs packages/repomesh-cli/scripts/build.mjs.
- anchor-xrpl now also checks anchor/xrpl/config.json, anchor/xrpl/package-lock.json, anchor/xrpl/package.json and 5 more.
- And 5 more changes to doors.
- anchor/xrpl/anchor-result.json is now written by anchor/xrpl/scripts/post-anchor.mjs.
- anchor/xrpl/partition-root.json is now written by anchor/xrpl/scripts/compute-root.mjs.
- packages/repomesh-cli/dist is now written by packages/repomesh-cli/scripts/build.mjs.
- And 102 more new writers and readers of places.
- .github was mixed and is now authored.
- pages was mixed and is now authored.
- the repository root was mixed and is now authored.
- And 1 more origin change.
- 2 files added and 296 changed content, across 17 parts.

## What comes in

1. **Release.** When a release is published; or by hand. Runs packages/repomesh-cli/scripts/build.mjs and packages/repomesh-cli/tests/; packs anchor/xrpl/config.json, anchor/xrpl/package-lock.json, anchor/xrpl/package.json and 67 more into an image.
2. **anchor-xrpl.** On a schedule (`0 0 * * *`); or by hand. Runs anchor/xrpl/scripts/compute-root.mjs, anchor/xrpl/scripts/emit-anchor-event.mjs, packages/repomesh-cli/scripts/build.mjs and 1 more; packs anchor/xrpl/config.json, anchor/xrpl/package-lock.json, anchor/xrpl/package.json and 67 more into an image.
3. **pages-ci.** On a push to main touching 6 paths; or by hand. Runs pages/build-metrics.mjs, pages/build-pages.mjs, pages/build-stats.mjs and 7 more.
4. **attestor-ci.** On a schedule (`0 */6 * * *`); or by hand. Runs attestor/scripts/attest-release.mjs, policy/scripts/check-policy.mjs, verifiers/license/scripts/verify-license.mjs and 2 more; checks LICENSE.
5. **registry-ci.** On a push to main touching 5 paths; or by hand. Runs registry/scripts/build-anchors.mjs, registry/scripts/build-badges.mjs, registry/scripts/build-dependencies.mjs and 4 more.
6. **ledger-ci.** On a pull request touching 9 paths; or by hand. Runs ledger/scripts/validate-ledger.mjs.
7. **xrpl-watch.** On a schedule (`0 12 * * 1`), Monday at 12:00 UTC; or by hand. Runs anchor/xrpl/scripts/watch.mjs.
8. **repomesh-broadcast.** When a release is published; or by hand. Runs packages/repomesh-cli/scripts/build.mjs.
9. **@mcptoolshop/repomesh** (the package people import). Loads packages/repomesh-cli/dist/index.mjs, built from a source this map cannot place.
10. **RepoMesh verify-release** (an action other repositories use). Runs no file this map can see.
11. **repomesh** (a command people run). Runs packages/repomesh-cli/dist/cli.mjs, built from a source this map cannot place.

## What happens through Release

1. The workflow runs packages/repomesh-cli/scripts/build.mjs and packages/repomesh-cli/tests/ in repomesh-cli; it packs 10 files in anchor, packages/repomesh-cli/ and packages/repomesh-cli/package.json in repomesh-cli, and package-lock.json and package.json in the repository root into an image.
2. That reaches pages (2 files), registry (4 files), tools (5 files) and verifiers (4 files).
3. That reaches ledger (1 file).
4. It writes to packages/repomesh-cli/dist/, which is not tracked.
5. It publishes @mcptoolshop/repomesh to npm and a container image.

## Who reads the results

Release writes only to packages/repomesh-cli/dist/, which is not tracked.

## The other doors

**anchor-xrpl** runs anchor/xrpl/scripts/compute-root.mjs, anchor/xrpl/scripts/emit-anchor-event.mjs, packages/repomesh-cli/scripts/build.mjs and 1 more, packs anchor/xrpl/config.json, anchor/xrpl/package-lock.json, anchor/xrpl/package.json and 67 more into an image, reaches ledger, pages, tools and verifiers, writes to anchor/xrpl/manifests/, ledger/events/events.jsonl, registry/anchors.json and registry/trust.json, and to anchor/xrpl/partition-root.json and packages/repomesh-cli/dist/, which are not tracked, commits anchor/xrpl/manifests/*.json, ledger/events/events.jsonl and registry/anchors.json, then pushes to a branch for review, never to main, opens an issue when it fails, and opens a pull request.

**pages-ci** runs pages/build-metrics.mjs, pages/build-pages.mjs, pages/build-stats.mjs and 7 more, reaches anchor, ledger and verifiers, writes to registry/anchors.json, registry/badges/, registry/snippets/ and registry/trust.json, and to pages/out/, registry/metrics.json, registry/timeline.json and 2 more places, which are not tracked, and deploys the site.

**attestor-ci** runs attestor/scripts/attest-release.mjs, policy/scripts/check-policy.mjs, verifiers/license/scripts/verify-license.mjs and 2 more, checks LICENSE, writes to ledger/events/events.jsonl, registry/anchors.json and registry/trust.json, commits ledger/events/events.jsonl and pushes to a branch for review, never to main, runs git, opens an issue when it fails, and opens a pull request.

**registry-ci** runs registry/scripts/build-anchors.mjs, registry/scripts/build-badges.mjs, registry/scripts/build-dependencies.mjs and 4 more, reaches ledger and verifiers, writes to registry/anchors.json, registry/badges/, registry/capabilities.json, registry/dependencies.json, registry/nodes.json, registry/snippets/, registry/trust.json and registry/verifiers.json, commits registry/anchors.json, registry/badges/, registry/capabilities.json, registry/dependencies.json, registry/nodes.json, registry/snippets/, registry/trust.json and registry/verifiers.json, then pushes to a branch for review, never to main, and opens a pull request.

**ledger-ci** runs ledger/scripts/validate-ledger.mjs and reaches verifiers.

**xrpl-watch** runs anchor/xrpl/scripts/watch.mjs, reaches repomesh-cli, and opens an issue.

**repomesh-broadcast** runs packages/repomesh-cli/scripts/build.mjs, writes to packages/repomesh-cli/dist/, which is not tracked, commits into a clone of mcp-tool-shop-org/repomesh and pushes there, uploads provenance.json and sbom.json to the release, and opens a pull request.

**@mcptoolshop/repomesh** (the package people import) loads packages/repomesh-cli/dist/index.mjs, built from a source this map cannot place.

**RepoMesh verify-release** (an action other repositories use) runs no file this map can see and scans code with CodeQL.

**repomesh** (a command people run) runs packages/repomesh-cli/dist/cli.mjs, built from a source this map cannot place.

## What breaks what

- **verifiers** is imported by 5 parts (anchor, attestor, ledger, registry, tools), and by 1 more only from tests; it sits on the path of 6 doors.
- **anchor** is imported by 2 parts (pages, tools) and sits on the path of 4 doors.
- **repomesh-cli** is imported by 2 parts (anchor, tools) and sits on the path of 4 doors.
- **ledger** is imported by 1 part (registry), and by 1 more only from tests; it sits on the path of 5 doors.
- **registry** is run as a child process by 2 parts (repomesh-cli, tools) and sits on the path of 4 doors.
- **pages** is run as a child process by 2 parts (repomesh-cli, tools) and sits on the path of 3 doors.
- **ledger/events/events.jsonl** is written by .github, attestor and repomesh-cli, and read by .github, anchor, attestor, ledger, pages, policy, registry, repomesh-cli and tools, and by 4 tests; a hand edit reaches every reader.
- **registry/trust.json** is written by verifiers and read by pages, registry, repomesh-cli, scripts and verifiers; a hand edit reaches every reader.

## What tends to change together

No two source files changed together often enough to name.

Window: 180 days; a pair counts from 3 shared commits, since 0 source files reach 10 revisions; the floor rises to 10 when 25 do.

## What no test touches

Every code part is imported by at least one test.

72 test files run in no workflow: anchor/xrpl/tests/anchor-writepath-stagec.test.mjs, anchor/xrpl/tests/docker-image.test.mjs, anchor/xrpl/tests/idle-epoch.test.mjs and 69 more.

## Written but never read

- **registry/capabilities.json** is written by registry/scripts/build-registry.mjs and read by nothing else in this repository.
- **registry/dependencies.json** is written by registry/scripts/build-dependencies.mjs and read by nothing else in this repository.
- **registry/snippets/** is written by registry/scripts/build-snippets.mjs and read by nothing else in this repository.

## Helpers that look duplicated

These are candidates from names and call order, not a judgement.

- **__deriveLegacyForTests** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **deriveKeyWindowConstraints** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **isKeyValidForSignature** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **keyWindow** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.
- **mergeStricterWindow** is exported by packages/repomesh-cli/src/verify/key-window.mjs (repomesh-cli) and verifiers/lib/key-window.mjs (verifiers); the two look alike.

And 9 more pairs.

## Generated, never hand-edited

- **anchor/xrpl/manifests/** is written by anchor/xrpl/scripts/compute-root.mjs.
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

- **ledger/events/events.jsonl** is written by .github/workflows/anchor-xrpl.yml, .github/workflows/attestor-ci.yml, attestor/scripts/emit-key-event.mjs and packages/repomesh-cli/src/key/rotate-revoke.mjs, and by people: 23 of its 34 commits in the window are theirs.

## Where to start

.github/workflows/ledger-ci.yml → ledger/scripts/validate-ledger.mjs → verifiers/lib/key-window.mjs

Read those in order to follow one pull request end to end.

## What this map cannot see

- 107 imports could not be resolved: `attestor/tests/emit-key-event.test.mjs` imports a path built at run time, twice; `packages/repomesh-cli/tests/anchor-leaf-window.test.mjs` imports a path built at run time; `packages/repomesh-cli/tests/anchor-prev-chain.test.mjs` imports a path built at run time, twice; and 102 more.
- 6 reads use paths built at run time and are not named here.
- 23 writes go to places this repository does not track, so they are not listed as generated.
- 38 writes and 141 reads go to a path their caller passes, not to this repository.
- 7 writes and 13 reads go to the directory the command is run in (.repomesh-tmp/, anchor/ and ledger/) or a path their caller passes, not to this repository.
- 12 reads go to the directory the command is run in (anchor/, ledger/ and verifiers/), not to this repository.
- 1 read goes to a temporary directory, not to this repository.
- 9 commands are built at run time and not followed, all of them in tests.
- Statistics confidence is low: fewer than 25 source files reach 10 revisions in the window.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
