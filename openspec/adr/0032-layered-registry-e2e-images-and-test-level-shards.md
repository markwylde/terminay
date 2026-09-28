# ADR-0032: Pull-request E2E runs on a lockfile-keyed base image from the internal registry, sharded by test

Status: accepted, supersedes ADR-0010
Date: 2026-09-28
Supersedes: ADR-0010

## Context

ADR-0010 scoped pull-request CI to a merge-confidence gate and fixed its shape:
a packaged macOS smoke, one fast gate, one shared E2E-image build, and ten
Electron Playwright shards. That shape still holds.

Its account of how shards receive the E2E image no longer matches the
repository. ADR-0010 says the image is saved as a compressed workflow artifact
and loaded by each shard. Gitea CI has since published a content-addressed
image to the internal registry at `git.i.wylde.net`, and shards pull it by tag.

Measurements on Gitea run 16020 showed that pulling that image had become the
dominant cost of every shard:
- The image is 1.49 GB compressed. One layer (npm dependencies, Electron and
  Chromium) is 1,057 MB of it.
- That layer got a new digest on every commit, because the image was rebuilt
  without a layer cache.
- Ten shards pulled it at the same moment, and each took 70–219 seconds. A
  single runner pulls the same image in 29–38 seconds.

Sharding by file also left one shard with 72 tests and another with none.

## Decision

1. **The shape of pull-request CI is unchanged from ADR-0010.** Keep the
   confidence gate, the provider-exclusive `.github/workflows/` and
   `.gitea/workflows/` directories, the amd64-only E2E jobs that fail closed on
   other architectures, and ten shards that depend only on their provider's
   E2E-image build.
2. **The E2E test environment is two images.**
   - A dependency base image holds system packages, npm dependencies, Electron
     and Playwright Chromium. It is tagged by a content hash of exactly its
     inputs and published to the internal registry only when that tag is
     absent.
   - A per-commit E2E image is built `FROM` that base. It adds only source and
     build outputs, and is tagged by the hash of the build context.
   - Shards pull the per-commit image. Its base layers are identical across
     commits, so runners keep them and download only the per-commit layers.
3. **The internal registry, not workflow artifacts, distributes the images.**
   Runner cleanup keeps the newest base and removes superseded ones.
4. **Build-time caches the suite depends on ship in the per-commit image.** For
   example, the browser-shell fixture's Vite dependency cache is built during
   the image build. No test pays for a cold build of it.
5. **The suite is sharded by test** (`fullyParallel` with one worker per
   shard). A spec whose tests share one application instance declares itself a
   single group.

## Consequences

- A commit that changes only source reuses the base. Each shard downloads
  roughly the per-commit layers instead of the dependency layer.
- A commit that changes dependencies pays for one base build and full pulls,
  as every commit did before.
- The base key script must cover every input the base Dockerfile copies. A
  contract test enforces this.
- Shards stay within a few tests of each other. A new spec that shares state
  across tests must declare itself a group.
- ADR-0010's workflow-artifact transfer, its one-day image expiry and its
  `terminay-e2e:ci-$GITHUB_SHA` tag no longer describe Gitea CI. This ADR
  replaces them.
