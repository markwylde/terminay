## 1. Layered images

- [x] 1.1 Create `Dockerfile.e2e-base` from the dependency half of `Dockerfile.e2e`, and make `Dockerfile.e2e` build `FROM ${E2E_BASE_IMAGE}`. Verify: a local `npm run test:e2e` of one spec builds both and passes.
- [x] 1.2 Add `scripts/e2e-base-image-key.mjs`, hashing every input the base copies. Verify: a contract test checks that every `COPY` source in `Dockerfile.e2e-base` is covered by the key.
- [x] 1.3 Update `scripts/run-e2e-container.sh` to build the base, then the E2E image, with the base passed as a build argument. Verify: the same local run as 1.1.
- [x] 1.4 Update `.gitea/workflows/ci.yml` to restore or build-and-push the base, then build the E2E image on it. Verify: on CI, the second commit's image job reports the base restored, and shard pulls download only per-commit layers.
- [x] 1.5 Teach `scripts/prune-ci-docker-images.sh` to keep the newest and named base, and remove superseded ones. Verify: its contract test covers the base repository.

## 2. Warm Vite cache

- [x] 2.1 Add `scripts/prebundle-e2e-vite-deps.mjs` and run it in `Dockerfile.e2e` after `build:app`. Verify: on CI, the gap between the test step starting and "Running N tests" is under 15s on every runner.

## 3. Balanced shards

- [x] 3.1 Set `fullyParallel: true`, and group `e2e/server-ui-sandbox.spec.ts` with `test.describe.configure({ mode: 'default' })`. Verify: `playwright test --list --shard=k/10` gives every shard at least one test and keeps the sandbox spec's tests in one shard. The E2E suite passes on CI.

## 4. Per-test timing

- [x] 4.1 Add the JSON reporter in CI, and `scripts/summarize-e2e-timings.mjs`, called by the container entrypoint without changing the exit status. Verify: a unit test for the summary script, and CI logs show the slowest tests per shard.

## 5. Build trims

- [x] 5.1 Set `build.reportCompressedSize: false` in the three Vite configs. Verify: the E2E image build log no longer shows "computing gzip size".

## 6. Verification

- [x] 6.1 Update the contract tests that read `Dockerfile.e2e`, the entrypoint and the CI workflow (`scripts/e2e-container-contract.test.mjs`, `scripts/provider-portable-ci.test.mjs`). Verify: `npm run smoke`'s node test lists pass.
- [ ] 6.2 Push, and measure two consecutive CI runs (the first builds the base, the second reuses it). Verify: per-shard pull, setup and test times read from the Gitea API. The target is every shard under 5 minutes on the second run.
- [x] 6.3 Run `openspec validate --all`. Verify: it passes.

## 7. Fast gate

- [x] 7.1 `scripts/task20-standalone-release-archive.test.mjs` extracted the packed archive once per integrity descriptor, taking 183s of the 474s "Build, lint, and unit tests" step on run 16031. Extract once and read the payloads from disk. Verify: the test takes under 5s locally (measured 3.8s), and the CI step shortens by about three minutes.
