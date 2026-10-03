## 1. Parallel unit jobs

- [x] 1.1 Add a `workspace-tests` job that runs `npm run test:workspaces`, and reduce the gate job to `npm run smoke && npm run test:workspace-models && npm run test:release-evidence`. Verify: `npm run test:workspaces` passes on a clean checkout with no build output, and both jobs pass on CI.
- [x] 1.2 Add a contract assertion that the two jobs' commands equal `npm run test:ci`. Verify: `node --test scripts/provider-portable-ci.test.mjs` passes, and fails when a command is removed from either job.

## 2. Container image smoke

- [x] 2.1 Draw each isolated case's signaling port and ICE range at random, retrying when the host has them allocated, and run every case in its own process when `--only` is absent. Verify: the CI job log shows `ok bare`, `ok advertised`, `ok derived` and `ok control`, and the smoke step takes about as long as its slowest case.
- [x] 2.2 Build the official image while dependencies install. Verify: the CI job passes, and a failing image build prints its log and fails the step.

## 3. npm cache on the runner

- [x] 3.1 Set `npm_config_cache` to `${{ runner.tool_cache }}/npm-cache` on every Linux install step and drop `cache: npm`. Verify: no job log contains a cache archive or upload step, and `npm ci` on a runner's second run takes no longer than it did with the restored archive.

## 4. macOS job

- [x] 4.1 Cancel the session-holder test's deadline timer once the application has quit. Verify: on CI the gap between the test's pass line and its summary is under two seconds.

- [x] 4.2 Run the DMG boot beside the built-in lifecycle and session-holder checks. Verify: the macOS job passes on CI with all three in its log, and takes under 300 seconds on an idle runner.

## 5. Eighteen shards

- [x] 5.1 Change the shard matrix, job name, artifact names and `--shard` argument from ten to eighteen. Verify: every shard runs at least one test on CI, and the contract tests that read the workflow pass.

- [x] 5.2 Deal tests to shards in turn instead of in contiguous slices, keeping a spec that shares setup whole, through `scripts/support/run-e2e-playwright.mjs` and Playwright's `--test-list`. Verify: `node --test scripts/e2e-shard-test-list.test.mjs` passes; `playwright test --list --test-list=<shard list>` selects exactly the tests dealt to that shard; on CI the shards' test counts sum to the suite and their test times are within a minute of each other.

## 6. Application build

- [x] 6.1 Add `scripts/run-together.mjs` and use it in `build:app` for the server UI bundle, the root type check and the Desktop bundle. Verify: `npm run build:app` on a clean checkout produces `dist-web`, `dist` and `dist-electron`, `node --test scripts/packaged-desktop-artifact.test.mjs` passes, and a failing part fails the build.

## 7. Base image key

- [x] 7.1 Hash a manifest into the base image key without the scripts npm does not run during an install. Verify: the contract test shows a longer test list leaves the key alone, and a changed dependency, override or install script moves it; on CI, a commit that only edits `scripts` reports the base restored.

## 8. Tests failing on main

- [x] 8.1 Do not read a file above the large-file boundary whole before an engine is chosen. Verify: `e2e/file-viewer-conflicts-large-files.spec.ts` passes ten times in a row in the container with no retries, and renderer memory with the chooser open stays near 230 MiB instead of 2.5 GiB.
- [x] 8.2 Let the Monaco editor own its text while it is typed in. Verify: `e2e/file-viewer-language.spec.ts` passes ten times in a row in the container with no retries, and `src/components/file-viewer/editorTextEcho.test.ts` passes.
- [x] 8.3 Make the terminal focus tests blur until the terminal stays unfocused. Verify: `e2e/terminal.spec.ts` passes on CI.

## 9. Verification

- [x] 6.1 Update `scripts/provider-portable-ci.test.mjs`, `scripts/e2e-container-contract.test.mjs` and `scripts/repository-ownership-release.test.mjs`. Verify: they pass with the other workflow contract tests.
- [ ] 6.2 Measure two consecutive source-only runs from the Gitea API. Verify: each run's wall clock, from creation to its last job's completion, is under 300 seconds with every status `success` or `skipped`.
- [ ] 6.3 Run `openspec validate --all`. Verify: it passes.
