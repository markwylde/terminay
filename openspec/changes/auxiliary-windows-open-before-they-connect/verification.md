# Verification: auxiliary-windows-open-before-they-connect

Reviewed 2026-11-24 against `main...HEAD`, the working-tree diff, and the
untracked change artifacts and E2E test. There are no committed branch changes
relative to main in this worktree.

| Dimension | Result |
| --- | --- |
| Completeness | 7/8 original tasks complete; packaged remote check 2.3 remains incomplete |
| Correctness | Both added requirements mapped to implementation; remote failures, cancellation and retry covered with controlled Node timings; Local presentation and navigation covered in Docker E2E |
| Coherence | Main retains credentials, connection ownership, validated auxiliary routes and narrow preload; design updated for review fixes |

## Findings fixed

- **P1 — Remote auxiliary windows used Local's Chromium partition.** Their
  launch metadata is now prepared after creation, so the old partition fallback
  selected Local. Select the remembered remote server/profile partition before
  creating the shell; use origin/profile when server identity is not remembered.
  The window controller also starts with the correct remote profile binding.
  The key is computed by one helper, `serverUiPartitionKey`
  (`apps/terminay-desktop/src/main/serverUiPartition.ts`), shared by the window
  shell and the bundle host, so the two cannot drift.
- **P2 — Loading completion did not establish visibility before handshake.**
  Await the first `ready-to-show` as well as document loading, show the window,
  then connect. Reuse the readiness gate on Retry and settle it on close.
- **P2 — Requests during workspace navigation could be lost or abort mounting.**
  Keep requests pending until mounting finishes, including after document commit;
  apply the latest route in the same mounting transaction. Prevent competing
  `loadURL` calls from incorrectly sending a successful launch to recovery.
- **P2 — Failed mounts retained an active document endpoint.** Retire it before
  recovery so its reconnect loop cannot compete with Retry for this window's
  authenticated connection.
- **P2 — Diagnostic failure prevented unsafe-bundle window closure.** Close in
  `finally`, even when recording the diagnostic fails.
- **P2 — Server identity discovery was misclassified as a bundle failure.**
  Complete discovery as connection work before packaged-bundle preparation,
  pass the window's abort signal to its fetch, retire its lane on failure and
  offer Retry. Closing during discovery now cancels the request.
- **P2 — The repeat-request E2E relied on incidental Local timing.** Gate loader
  completion explicitly; add before/after-commit regression cases. Child helpers
  now also exclude the initial `about:blank` document.

## Validation

- Focused Node suites: **40 passed**, including eleven launch/partition/queue
  regression cases, window identities, route validation, recovery, loading CSP
  and auxiliary placement. Runs use both required Node timeout/exit flags.
- Desktop `npx tsc --noEmit`: passed.
- Four existing source-shape suites: **10 passed, 8 failed**. Compared with a
  temporary export of `main`: identical failing tests and expected expressions.
- `openspec validate auxiliary-windows-open-before-they-connect --strict`:
  passed. `openspec validate --all`: **102 passed, 13 failed**; the same 13
  failures occur in a temporary export of `main` (101 passed without this change).
- Docker E2E: **41 passed** across `auxiliary-window-loading`, `app`,
  `settings-update-channel`, `mcp-install-targets`, `settings` and
  `performance-log-window`. The final identity-discovery adjustment changes
  only the remote launch path and is covered by the subsequent Node run.

## Re-verification (2026-11-24, after review fixes)

- Every scenario has a test: remote ordering, close in queue / handshake /
  identity discovery / bundle preparation, failure recovery and Retry with the
  latest route and window id, and unsafe-bundle closure in
  `scripts/auxiliary-window-launch.test.mjs` (11 passed); latest-request routing
  and single window in `e2e/auxiliary-window-loading.spec.ts`; a real remote
  server in `e2e/desktop-loopback-standalone-pairing.spec.ts` (task 2.3, passed).
- Docker E2E after the partition-key refactor: 38 passed across
  `auxiliary-window-loading`, `settings`, `performance-log-window` and `app`.
  `apps/terminay-desktop` `server-bundle-host` tests: 5 passed.
- Design decisions match the code; the new helper module follows the package's
  `.js` ESM import convention.

## Remaining verification

**Task 2.4 remains open:** opening Settings from a remote server in a packaged
macOS build has not been verified; it needs a Mac and is left to the owner.
Task 2.3 covers the same behaviour against a real standalone server in Docker. Controlled tests establish launch ordering,
abort propagation, late-lane cleanup, failure recovery and reuse of the window id;
they do not establish real WebRTC/HTTP cancellation or packaged remote behavior.
No critical implementation issue remains in the checks completed; the change is
not fully verified for archive while that explicit task is unfinished.
