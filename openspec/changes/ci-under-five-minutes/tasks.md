## 1. Parallel unit jobs

- [x] 1.1 Add a `workspace-tests` job that runs `npm run test:workspaces`, and reduce the gate job to `npm run smoke && npm run test:workspace-models && npm run test:release-evidence`. Verify: `npm run test:workspaces` passes on a clean checkout with no build output, and both jobs pass on CI.
- [x] 1.2 Add a contract assertion that the two jobs' commands equal `npm run test:ci`. Verify: `node --test scripts/provider-portable-ci.test.mjs` passes, and fails when a command is removed from either job.

## 2. Container image smoke

- [x] 2.1 Give each isolated case its own signaling port and ICE range, and run every case in its own process when `--only` is absent. Verify: the CI job log shows `ok bare`, `ok advertised`, `ok derived` and `ok control`, and the smoke step takes about as long as its slowest case.
- [x] 2.2 Build the official image while dependencies install. Verify: the CI job passes, and a failing image build prints its log and fails the step.

## 3. npm cache on the runner

- [x] 3.1 Set `npm_config_cache` to `${{ runner.tool_cache }}/npm-cache` on every Linux install step and drop `cache: npm`. Verify: no job log contains a cache archive or upload step, and `npm ci` on a runner's second run takes no longer than it did with the restored archive.

## 4. macOS job

- [x] 4.1 Cancel the session-holder test's deadline timer once the application has quit. Verify: on CI the gap between the test's pass line and its summary is under two seconds.

## 5. Fourteen shards

- [x] 5.1 Change the shard matrix, job name, artifact names and `--shard` argument from ten to fourteen. Verify: every shard runs at least one test on CI, and the contract tests that read the workflow pass.

## 6. Verification

- [x] 6.1 Update `scripts/provider-portable-ci.test.mjs`, `scripts/e2e-container-contract.test.mjs` and `scripts/repository-ownership-release.test.mjs`. Verify: they pass with the other workflow contract tests.
- [ ] 6.2 Measure two consecutive source-only runs from the Gitea API. Verify: each run's wall clock, from creation to its last job's completion, is under 300 seconds with every status `success` or `skipped`.
- [ ] 6.3 Run `openspec validate --all`. Verify: it passes.
