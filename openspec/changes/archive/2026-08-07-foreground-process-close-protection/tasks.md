## 1. Canonical signal

- [x] 1.1 Publish validated `foregroundBusy` state in activity snapshots and
  events, verified by tests proving provider state, recent output, and
  activity-indicator settings can neither create nor suppress it

## 2. Close paths

- [x] 2.1 Add a bounded Desktop close-confirmation capability with
  context-specific destructive button labels and **Keep Running** as default and
  cancel, verified by `scripts/main-window-close-confirmation.test.mjs`
- [x] 2.2 Guard direct terminal close actions only when that terminal is busy,
  verified by idle and busy cases in
  `scripts/foreground-close-protection.test.mjs`
- [x] 2.3 Guard project close actions when any contained terminal is busy without
  treating cross-view moves as closure, verified by aggregation and move cases
- [x] 2.4 Publish each Desktop window's bounded busy-session set to Electron so a
  native application or window close can guard work across projects and windows,
  verified by the aggregation coverage in
  `scripts/main-window-close-confirmation.test.mjs`
- [x] 2.5 Scope native-window close confirmation and confirmed closure to the
  target project window and reserve application quit for the final project window
  or an explicit Quit command, verified by the scoping and explicit-quit bypass
  cases

## 3. Verification

- [x] 3.1 Regress a busy torn-off project window closing while its sibling
  remains alive and usable, verified by `e2e/project-tabs.spec.ts`
- [x] 3.2 Cover idle, busy, cancel, confirm, aggregation, and explicit-quit
  bypass behaviour with focused and Docker-isolated Electron tests, verified by
  `scripts/foreground-close-protection.test.mjs`,
  `scripts/main-window-close-confirmation.test.mjs`, `e2e/workspace.spec.ts`,
  and `e2e/project-tabs.spec.ts`
- [x] 3.3 Run the required Electron suite through `npm run test:e2e`; post-merge
  main run 6749 passed every shard
