## Context

Measured on Gitea run 16020 (PR #302), with each E2E shard's step timestamps from the Gitea API and its raw log:

| Stage | home3 runner | pop-os runner |
|---|---|---|
| Queued behind "Build E2E image" | 455s | 455s |
| Pull and verify image | 70s | 164–219s |
| Container start and Playwright setup | 7s | 110–126s |
| Tests | 30–165s | 74–218s |

- **The pull.** The E2E image is 1.49 GB compressed. One layer (`npm ci`, Electron install, Playwright Chromium) is 1,057 MB of that. Its digest changed between runs 16014 and 16020 with no dependency change: the image is built in a fresh BuildKit with no cache, so every step from `apt-get` onward produces new files and new digests. A runner that already held the previous image downloaded the full layer again.
- **Pulls are fine alone.** On the live cluster, one pop-os runner pulled the whole image in 29s and one home3 runner in 38s. Ten shards pulling the same blob at once from home2 got 9–21 MB/s each, about 1 Gbit/s combined. The runners use `overlay2` on an ext4 host volume; storage is not the constraint.
- **The setup.** The Playwright global setup added in #302 cold-bundles the browser-shell fixture's Vite dependencies. That costs about 2 minutes on pop-os in every shard, including shards with no browser-shell specs, where it was 2–7s before #302.
- **The sharding.** With `fullyParallel: false`, Playwright shards by file group. Shard 8 gets 72 tests, shard 9 gets 0, and the rest get 30–40.
- **The image build** takes 446s: 97s of dependency layers, 46s of Turbo cache replay, about 205s of production Vite builds with about 12s printing gzip sizes, 9s of export, and 55s of push.

## Goals / Non-Goals

**Goals:**
- Pull per shard is dominated by per-commit layers (~180 MB unpacked), not dependencies.
- No shard pays for a cold Vite dependency bundle.
- Shards are within a few tests of each other, and none is empty.
- The per-commit image build no longer rebuilds or re-pushes dependencies.
- Per-test durations are visible in CI logs, so later work targets real per-test cost.

**Non-Goals:**
- Changing the runner fleet, the registry host, or the network path. Measured single pulls are fast, and removing the repeated 1 GB layer removes the contention.
- Changing what the E2E suite tests, or building unminified bundles for it.
- Reusing one Electron app across tests. That needs per-test timings first.
- The GitHub mirror's workflows, which run no E2E suite.

## Decisions

### Two images: a lockfile-keyed dependency base, and a per-commit image FROM it

`Dockerfile.e2e-base` takes everything above today's `COPY . .`. `Dockerfile.e2e` becomes `ARG E2E_BASE_IMAGE` / `FROM ${E2E_BASE_IMAGE}`, followed by the source copy and `build:app`.

`scripts/e2e-base-image-key.mjs` hashes the base's inputs as git blob IDs:
- `Dockerfile.e2e-base`
- `package-lock.json` and every workspace `package.json` the base copies
- the helper script it runs

In CI, the image job resolves the base tag and restores it if the registry has it. Otherwise it builds and pushes it. It then builds the E2E image with `--build-arg E2E_BASE_IMAGE=<tag>`. The E2E image key stays the hash of the whole build context, so it still changes with every commit.

*Alternative:* keep one Dockerfile and add BuildKit registry cache (`--cache-from/--cache-to type=registry`). That also makes unchanged layers reproducible, but it ties correctness to cache-export behaviour and cache-image lifetime. A named, content-addressed base is visible in the registry and trivial to reason about.

### Pre-bundle Vite dependencies during the E2E image build

After `build:app`, the E2E Dockerfile runs `scripts/prebundle-e2e-vite-deps.mjs`. It calls the same `prebundleSharedWebShellDependencies()` the global setup uses, so the committed cache in `node_modules/.vite` matches what the fixture expects: same root, same aliases, same lockfile.

The global setup stays. With a committed cache it takes about a second. On a stale or missing cache it still prevents the cold-start failure #302 fixed.

### Shard by test

Set `fullyParallel: true` and keep one worker per shard. Playwright then distributes individual tests across shards. `server-ui-sandbox.spec.ts` shares one Electron app, created in `beforeAll`, across its tests, so it declares `test.describe.configure({ mode: 'default' })` and stays one group. The other `beforeAll` users start a per-worker fixture that each shard can create for itself.

### Per-test timings

In CI, the Playwright reporters add `json` with its `outputFile` under `test-results/`, which is already copied into the shard artifact. The container entrypoint runs the tests, then runs `scripts/summarize-e2e-timings.mjs` to print the slowest tests, then exits with the Playwright status.

### Cleanup keeps bases

`prune-ci-docker-images.sh` treats the base repository the same way it treats E2E images: keep the newest, keep the one the job names, and remove the rest.

### Build trims

Set `build.reportCompressedSize: false` in the three Vite configs.

## Risks / Trade-offs

- [Order-dependent tests split across shards] → Only one spec shares an instance through `beforeAll`, and it is pinned as a group. CI proves the rest.
- [Base key misses an input, leaving a stale base] → The key covers every file the base Dockerfile copies. A contract test checks that each `COPY` source in `Dockerfile.e2e-base` is hashed by the key script.
- [First commit after a lockfile change] → That commit pays for one base build and push, plus full pulls, as today.
- [Vite cache hash mismatch between build time and run time] → The build uses the fixture's own function and config. If the hashes differ, the global setup rebuilds the cache once, which is today's behaviour.

## Migration Plan

The first CI run on this branch builds and pushes the base. Later commits reuse it. Rollback is a revert. The old single-image tags stay in the registry until pruned.

## Open Questions

None.
