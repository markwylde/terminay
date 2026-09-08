## 1. Pin reconciliation to the confirmed projection

- [x] 1.1 In the workspace reconciliation effect in `src/App.tsx`, have the
  deferred pass read the store's current projection when it runs instead of the
  snapshot captured at schedule time, so a retried or coalesced pass adopts and
  removes against the newest confirmed projection. Verified by reading the
  effect: no scheduled callback closes over a snapshot value, and the retry
  re-enters through the same store read.
- [x] 1.2 Cancel any pending retry timer when a newer projection arrives, next to
  the existing pending-frame cancellation, so at most one pass is pending at a
  time. Verified by reading the effect: every path that schedules a frame also
  clears an outstanding retry, and effect teardown still clears both.
- [x] 1.3 Confirm `reconcileServerPanels` is called only with the canonical panel
  list of the projection the pass just read, so no pass can remove a panel the
  confirmed projection still contains. Verified by reading the call site.

## 2. Prove the behaviour

- [x] 2.1 Keep `e2e/rapid-terminal-creation.spec.ts` covering terminals created
  while another window presents a project of the same workspace, plus the
  single-window creation patterns. Verified by the spec asserting both that the
  expected tab count is reached and that it still holds after the workspace
  settles.
- [x] 2.2 Run the suite in its container: `sh scripts/run-e2e-container.sh
  e2e/rapid-terminal-creation.spec.ts`. Verified by every test in the file
  passing, where the popout test failed on all retries before the fix.
- [x] 2.3 Run the workspace-adjacent suites that share this effect —
  `e2e/workspace.spec.ts`, `e2e/project-tabs.spec.ts`, `e2e/terminal.spec.ts`,
  `e2e/terminal-tab-hydration.spec.ts` — in the container. Verified by them
  passing unchanged.

## 3. Land it

- [x] 3.1 Run `npm run lint` and `npm run typecheck:workspaces`. Verified by both
  completing clean.
- [x] 3.2 Validate the change with `openspec validate fix-stale-reconcile-panel-removal`.
  Verified by validation reporting no issues.
- [x] 3.3 Open a pull request from the change branch with the proposal's summary,
  and confirm its checks are green. Verified by the PR's checks reporting
  success.
