## 1. Inventory gate (renderer)

- [x] 1.1 In `src/workspace/workspaceInventory.ts`, add `untracked?: true` to `WorkspaceInventoryEntry`. For every terminal entry whose panel has `activityIndicatorsEnabled === false`, including agent-authority entries, emit `status: 'idle'`, `untracked: true`, no `since`, and no `agentUnread`. Keep agent identity so detail still resolves. Make `indicatorsSuppressed` true whenever `untracked` is. Verified by new cases in the inventory unit tests: an untracked recent, attention, or agent-working terminal yields an idle, untracked entry.
- [x] 1.2 Update the `indicatorsSuppressed` doc comment and `selectNotableEntries`/`isNotableInventoryEntry` so untracked agent entries are never notable. Verified by unit tests: project-tab dot and badge counts exclude an untracked agent.
- [x] 1.3 In `src/components/TerminalTab.tsx`, draw no bound-agent RAG glyph when the panel is untracked. Verified by a component or unit test on the glyph selection.
- [x] 1.4 In the Agents pane (`src/components/AgentsSidebar.tsx` / `projectAgentItems` in `App.tsx`), list an agent bound to an untracked terminal with no state glyph and no unread mark. Verified by a unit test on the row model.
- [x] 1.5 In `src/workspace/publishedNotifications.ts`, hide every published `source: 'activity'` record whose entry is untracked, agent records included, as a defensive filter. Verified by unit test.

## 2. Server notification gate

- [x] 2.1 Give `bindNotificationsToActivity` (`packages/server-core/src/notifications/activityFeed.ts`) an `isTracked(sessionId)` lookup backed by the server workspace's panel for that session. An unknown session counts as tracked. Untracked sessions call `setActivity(owner, undefined)`. Verified by unit tests: an untracked session raises no record and a tracked one does.
- [x] 2.2 Subscribe the binding to workspace changes. When a panel's flag flips to off, withdraw its activity record. When it flips to on, acknowledge the session's current activity through the existing acknowledgement path, then reconcile. Leave process-sent records untouched. Verified by unit tests covering withdraw, no replay after re-enable, and a process-sent record that survives.
- [x] 2.3 Wire the lookup where the binding is constructed. Verified by a server-core integration test: phone push is not attempted for an untracked terminal's finished command.

## 3. Dashboard

- [x] 3.1 In `src/workspace/dashboardViewMode.ts`, add the `untracked` Board column after `done`, with label "Untracked" and empty-state text, and route every untracked card to it in both ungrouped and grouped builds. Verified by unit tests on column order, routing, and grouping parity.
- [x] 3.2 In `src/workspace/dashboardRows.ts`, make `countStatuses` count untracked entries only as `untracked`, and render that count in the summary when it is non-zero. Verified by unit test.
- [x] 3.3 In `src/workspace/localViewState.ts`, add the `terminay.view.dashboard-board-untracked-collapsed.v1` read/write. It defaults to collapsed and falls back to collapsed on error. Verified by unit tests mirroring the grouping-key tests.
- [x] 3.4 In `src/workspace/WorkspaceDashboard.tsx`, render the Untracked column with a keyboard-reachable collapse toggle that has `aria-expanded` and names the count. A collapsed column keeps its header and hides its cards. The state applies to every lane when grouped. Cards show no status or agent state. Verified by a component test and the E2E in 5.2.

## 4. Edit Tab copy

- [x] 4.1 In `src/shared/SharedEditTabRouteBody.tsx`, rename the row label and `aria-label` to **Track activity**, with the description "Show this tab's activity on its tab, its project, the sidebar, Home, notifications, and your phone. Turn off for long-running commands you don't need to watch." Update any test or E2E selectors that used the old label. Verified by `rg "Enable activity indicators"` returning nothing outside the archive.

## 5. Verification

- [x] 5.1 Confirm the left-column tree, collapsed-folder dots, and compact switcher read neutral for an untracked terminal with no code of their own, by extending their existing model unit tests with an untracked entry.
- [x] 5.2 Add an E2E to `e2e/workspace-dashboard.spec.ts`: turn off **Track activity** on a tab running a long command. Assert the tab, project dot, Notifications list, and List view are neutral. Assert the Board shows the card only in a collapsed Untracked column with count 1, and that expanding it persists across reload. Run it through `npm run test:e2e`.
- [x] 5.3 Run `npm run test:ci`, `npm run typecheck:workspaces`, and `npm run lint`. All pass. (Lint, typecheck and every suite pass except `GitService reports a worktree's unpushed work apart from what the default branch lacks` in server-core. That test fails the same way on `main` and is unrelated.)
- [x] 5.4 Run `openspec validate --all`. It passes.
