## 1. View request race

- [x] 1.1 Make `locate` wait for a named project inside its existing tab wait. Verify with a unit test where the project arrives late.
- [x] 1.2 Keep the `unavailable` refusal for a project that never arrives. Verify with a unit test.
- [x] 1.3 Share a 9-second deadline across all waits of one view operation. Verify with a unit test of a late lookup followed by a presentation that never completes.
- [x] 1.4 Verify the folder-launch E2E passes 15 of 15 through `npm run test:e2e` with `--retries=0`.

## 2. Project edit saves

- [x] 2.1 Serialise the server writes per project. Verify with unit tests of two overlapping saves and of a failed save followed by a save that still runs.
- [x] 2.2 Rebuild each attempt from the latest snapshot so an unchanged root stays the committed root. Verify with unit tests of a rename from an older draft and of another client's root change during a retry.
- [x] 2.3 Retry stale revisions through one helper, up to 4 attempts. Verify with unit tests of recovery, exhaustion, a non-stale conflict and a failed refresh.
- [x] 2.4 Surface a failed save to the user. Verify with a unit test of the reported error.
- [x] 2.5 Restore terminal focus only when no newer editor has opened or is awaiting input. Verify with a unit test of the edit guard and the chooser E2E.
- [x] 2.6 Verify the recent-folder chooser E2E passes 15 of 15 through `npm run test:e2e` with `--retries=0`.

## 3. CI limits

- [x] 3.1 Set the bot image build limit to 20 minutes, and both `timeout-minutes` and `TERMINAY_CI_JOB_TIMEOUT_MINUTES` to 30. Verify with the CI contract tests.
- [x] 3.2 Measure a no-cache bot image build locally. Verify the recorded duration is under 20 minutes.
- [x] 3.3 Set npm fetch retries to 3 with 2 to 10 second backoff, the `npm ci` bound to 300 seconds and the bootstrap bound to 120, including the macOS job. Verify with `scripts/provider-portable-ci.test.mjs`, which checks the flags, the bounds and that a persistent failure fails the install.

## 4. Remaining flakes

- [x] 4.1 Repeat each test below 10 times through `npm run test:e2e` with `--retries=0`, and record pass counts in `evidence.md` in this change:
  - `e2e/linked-folders.spec.ts`: "a repository project shows General", "folder context menus offer"
  - `e2e/project-tabs.spec.ts`: "dragging a project into a new window", "adds, edits, switches, and closes"
  - `e2e/desktop-loopback-standalone-pairing.spec.ts`: "Desktop reopens straight onto"
  - `e2e/file-viewer-html-preview.spec.ts`: "an HTML file opens as a sandboxed page"
  - `e2e/terminal.spec.ts`: "dragging across the xterm surface", "terminal activity overview jumps"
  - `e2e/task20-queue-bounds.spec.ts`, `e2e/task20-browser-responsiveness.spec.ts`
  - `e2e/macros.spec.ts`: "saves several macros at once"
  - `e2e/whats-new.spec.ts`: "sits second in Home"
- [x] 4.2 Fix the root cause of each test that fails, without raising retries or assertion timeouts, and update these artifacts first if the fix changes product behaviour. Verify that test then passes 10 of 10.

## 5. Validation and delivery

- [x] 5.1 Run typecheck, lint and affected unit tests. Verify they exit 0.
- [x] 5.2 Run all listed E2E tests together with `--retries=0`. Verify no failures.
- [x] 5.3 Run `openspec validate --all`. Verify this change reports no errors.
- [x] 5.4 Read back every Gitea commit status on the pull request head. Verify each is `success` or `skipped`.
