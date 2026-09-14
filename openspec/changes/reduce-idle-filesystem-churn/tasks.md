## 1. Per-operation canonical root

- [ ] 1.1 Add an optional `canonicalRoot` to `CanonicalProjectPathOptions` in
  `packages/server-core/src/fileService/pathResolver.ts`, used by `resolve()` in
  place of calling `root()`, documented as accepting only a value returned by
  `root()`. Verified by `npx tsc --noEmit -p packages/server-core/tsconfig.json`
  passing with the new option consumed at a call site.
- [ ] 1.2 Have `FileCatalog.list()` call `resolver.root()` once and pass it to
  the directory `resolve()` and to every `describe()` below it. Verified by
  `packages/server-core/test/file-catalog.test.mjs` still passing with unchanged
  listing output.
- [ ] 1.3 Confirm no canonical root is held across operations. Verified by
  `packages/server-core/test/file-adapter.test.mjs` passing — specifically
  "file adapter rejects traversal, cross-project/server/session identities, and
  stale canonical replacements", which replaces a root between operations and
  requires the later one to fail closed.

## 2. Remove redundant per-entry lookups

- [ ] 2.1 In `describe()`, trust `raw.isSymbolicLink` when it is a boolean and
  fall back to the `lstat` probe only when the directory read omits it. Verified
  by the escaped-symlink and internal-symlink cases in
  `packages/server-core/test/file-catalog.test.mjs` still passing.
- [ ] 2.2 Have `canonicalTarget()` return the stat it already took and have
  `resolve()` reuse it instead of stat'ing the canonical path again. Verified by
  `packages/server-core/test/file-hardening.test.mjs` and `filePath.test.mjs`
  passing.

## 3. Lock the budget against regression

- [ ] 3.1 Add `packages/server-core/test/file-catalog-path-budget.test.mjs`
  counting adapter `realpath`/`stat`/`lstat` calls for a listing, asserting
  `realpath <= entries + 2`, `lstat === 0` for dirents that report link-ness,
  one `readDirectory`, and that a second listing re-canonicalizes the root
  rather than reusing the first one's. Verified by the new test passing, and by
  it failing against the pre-change implementation.
- [ ] 3.2 Record the before/after counts measured from the same harness in
  `openspec/adr/evidence/idle-filesystem-path-lookup-cost.md`. Verified by the
  numbers in that file matching a fresh run of the harness.

## 4. Change-driven desktop settings reads

- [ ] 4.1 In `electron/main.ts`, split the disk read out of
  `readTerminalSettings()` and serve a cached parsed value from it. Verified by
  `npx tsc --noEmit` reporting no errors in `electron/main.ts`.
- [ ] 4.2 Arm an `fs.watch` on the user-data directory that invalidates the
  cache for `terminal-settings.json` and `remote-access-settings.json`, cache
  nothing while no watcher is live, and drop the watcher on its `error` event.
  Verified by inspection of the read path plus `npm run test:close-protection`
  passing.
- [ ] 4.3 Invalidate the cache inside `writeTerminalSettings` and
  `writeRemoteAccessSettings` so a read immediately after a write observes the
  written value. Verified by `npm run test:close-protection` passing and by
  confirming no call site mutates the returned settings object
  (`grep -n "settings\.[a-zA-Z.]* =" electron/main.ts` returns nothing).

## 5. Gate

- [ ] 5.1 `npm run test:ci --workspace @terminay/server-core` passes.
- [ ] 5.2 `npm run lint` and `npm run typecheck:workspaces` pass.
- [ ] 5.3 `npm run smoke` passes.
- [ ] 5.4 `npm run test:e2e` passes in Docker — required because the settings
  read path runs in the packaged app and `e2e/installed-sidebar-resize-repro.spec.ts`
  seeds `terminal-settings.json` directly.
- [ ] 5.5 `npx openspec validate reduce-idle-filesystem-churn` reports the change
  valid.
