## Why

A pull request waits about 17 minutes for CI, and each of the ten E2E shards takes 7–9 minutes even though its tests run for 30 seconds to 3.6 minutes. Measured on run 16020:

- **3–4 minutes pulling the image.** Every shard re-downloads a 1,057 MB layer, all ten at the same moment. The layer holds `npm ci`, Electron and Chromium, and it gets a new digest on every commit because the image is rebuilt without a layer cache. One runner pulls the whole image in 29–38 seconds on its own. Ten at once saturate the registry host.
- **About 2 minutes of setup on pop-os shards.** The Vite dependency pre-bundle added in #302 runs in every shard, even the nine without browser-shell specs.
- **Uneven shards.** Tests are sharded by file, so one shard runs 72 tests and another runs none, while still pulling the image.
- **A 7½-minute image build** gates every shard. About 97 seconds of it rebuilds the same dependencies, and 55 seconds pushes the same 1 GB layer again.

## What Changes

- Split the E2E image in two:
  - a **dependency base image** (system packages, `npm ci`, Electron, Playwright Chromium), keyed by a hash of its inputs and built only when those inputs change;
  - a per-commit **E2E image** built `FROM` that base.
  
  Runners then keep the base layers between commits and pull only the thin per-commit layers.
- Pre-bundle the browser-shell fixture's Vite dependencies while building the E2E image, so shards start with a warm cache. The Playwright global setup stays as a fast check that the cache is committed.
- Shard the E2E suite by test instead of by file, so the ten shards carry about the same number of tests and none is empty. Specs whose tests share one application instance stay together as one group.
- Record per-test durations in CI and print the slowest tests in each shard's log.
- Stop Vite printing compressed bundle sizes during builds.
- Keep base images on runners across jobs in the Docker cleanup step, pruning only superseded bases.

## Capabilities

### New Capabilities

- `pull-request-ci`: how pull-request CI builds and distributes the E2E test environment, shards the suite, and reports test timings.

### Modified Capabilities

_None._

## Impact

- `Dockerfile.e2e` (split), a new `Dockerfile.e2e-base`, `scripts/e2e-base-image-key.mjs`, and `scripts/run-e2e-container.sh` (builds the base locally).
- `.gitea/workflows/ci.yml` (base image build/restore, and the base passed to the E2E build) and `scripts/prune-ci-docker-images.sh`.
- `playwright.config.ts` (`fullyParallel`, JSON reporter in CI), `e2e/server-ui-sandbox.spec.ts` (grouped), `scripts/support/e2e-container-entrypoint.sh` (timing summary), and a new `scripts/summarize-e2e-timings.mjs`.
- Vite configs (`reportCompressedSize: false`).
- `openspec/adr`: a new ADR supersedes ADR-0010, which still describes handing the image to shards as a workflow artifact.
- No product, protocol or security-boundary changes. The GitHub mirror's workflows are unchanged.
