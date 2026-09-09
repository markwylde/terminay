## 1. The restore becomes one server-owned implementation

- [x] 1.1 Add `packages/server-core/src/workspaceStartup.ts` holding the whole policy — discard stale terminal state, seed restored projects in presentation order with the active project first, retry a remote project's seed while its environment is connecting, and seed the first-run terminal — taking session creation as an injected seam; verified by unit tests over a restored repository, a fresh one, and a project whose root is missing
- [x] 1.2 Rename `WorkspaceStore.discardStaleLocalTerminalState` to `discardStaleTerminalState`, so the name states the condition that makes a panel stale; verified by the existing workspace tests passing under the new name and a test asserting the old name is gone

## 2. Both hosts get it from the same place

- [x] 2.1 Run the restore from `createServerCoreComposition().start()`, after extension activation and beside the existing project-environment recovery; verified by the restore tests exercising the policy with no host present, and by the guard below
- [x] 2.2 Reduce `ServerTerminalAuthority.initializeWorkspace` to its host-specific work — rebuilding process-local project bindings — and let the shared restore do the rest; verified by the Desktop authority reopening tests continuing to pass
- [x] 2.3 Delete the daemon's `ensureDefaultTerminalSession` and its `workspaceWasCreated` gate, and give it the same startup seam Desktop uses; verified by the guard asserting the daemon declares the seam and keeps no seeding of its own

## 3. The defect is gone and cannot come back

- [x] 3.1 Assert a restarted server publishes no terminal panel naming a session it does not own; verified by the restart test in task 4.1
- [x] 3.2 Assert the restore has exactly one call site, so a future host cannot acquire its own copy; verified by a test asserting neither host bootstrap invokes the restore or the discard directly, and that neither keeps its own ordering, retry, or first-run seeding

## 4. Proving it end to end

- [x] 4.1 Prove the restart against a persisted workspace file rather than in memory — open it, restore, commit, reopen — and assert the second generation publishes no terminal panel naming a session it does not own, while projects and non-terminal panels survive; verified by that test. The systemd container smoke cannot carry this: the process it supervises is a stub launcher with no workspace of its own
- [x] 4.2 Run `openspec validate --all` and `npm run test:ci`; verified by both passing in CI
