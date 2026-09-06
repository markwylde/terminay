## 1. Panel inventory

- [x] 1.1 Add the inventory types next to the existing overview types (`src/workspace/`): a `WorkspaceInventoryEntry` carrying project id, panel id, session id where present, `kind` (`terminal` | `file` | `folder`), title, colour, emoji, project title/emoji, canonical `status` including `idle`, and an `isAgentStatus` flag. Verified by `npm run typecheck` passing with the new types exported and consumed.
- [x] 1.2 Widen `getActivityOverviewItems` in `src/App.tsx` into `getWorkspaceInventoryItems`: emit an entry for every panel in `api.groups[].panels[]`, derive `kind` from `sessionId` / `filePath` / `folderPath` params, and keep the existing authority order (agent state when a session is under agent authority, raw-output activity state otherwise, `idle` at rest). Verified by a unit test over a synthetic panel set asserting one entry per panel with the expected kind and status.
- [x] 1.3 Add `selectNotableEntries(entries)` reproducing today's predicate exactly (`working` / attention states / unread `done` for agent-owned terminals, `isTerminalActivityIndicatorStateVisible` otherwise, file and folder panels excluded). Verified by unit tests asserting the pre-change item set for agent-owned, raw-output, unread-done, and idle panels.
- [x] 1.4 Rewire `App.tsx` so `terminalActivityItemsByProject` becomes `inventoryByProject`, and `buildTerminalActivityOverview` and `summarizeActivityBadge` consume `selectNotableEntries(...)`. Verified by the existing activity-menu and tab-badge tests passing unchanged, plus `npm run test:workspaces`.
- [x] 1.5 Audit every `publishTerminalActivityOverview` call site and add republication on panel rename and panel reorder/move where missing. Verified by a test that renames and moves a panel and asserts the affected projects' inventories are republished.

## 2. Selected-view state

- [x] 2.1 Introduce `selectedView: { kind: 'home' } | { kind: 'project'; id: string }` in the project collection, leaving `activeProjectId` as the command target that Home never changes. Verified by unit tests: selecting Home leaves `activeProjectId` unchanged, and selecting a project sets both.
- [x] 2.2 Move the command target to a neighbour when the retained project is closed while Home is selected, without leaving Home. Verified by a unit test closing the retained project and asserting Home stays selected with a valid neighbour as the target.
- [x] 2.3 Persist and restore the Home selection in `src/workspace/localViewState.ts` as a best-effort hint, falling back to a project when it cannot be restored. Verified by unit tests covering restore, unrestorable value, and a throwing/unavailable `localStorage`.
- [x] 2.4 Drive `isActive` for each `ProjectWorkspace` from `selectedView.kind === 'project' && project.id === activeProjectId`. Verified by asserting every project workspace is inactive while Home is selected and terminals stay mounted and attached.

## 3. Home control

- [x] 3.1 Render the Home button in the header's leading group, immediately after `.project-tab-sidebar-toggle-box` and outside `ProjectTabList`, with a home/dashboard icon, an accessible name naming the dashboard, keyboard reachability, and a selected state. Verified by a unit/DOM test asserting DOM order relative to the sidebar toggle and the first project tab.
- [x] 3.2 Style the control and the neutral dashboard chrome band in `src/App.css` so it reads as chrome rather than a project tab, and no project tab renders active while Home is selected. Verified in the running app and by an e2e assertion that no project tab carries the active class on Home.
- [x] 3.3 Confirm Home never participates in project drag, reorder, or overflow. Verified by an e2e test dragging a project tab across the control and asserting neither displacement nor reordering, plus an overflow case with many projects where the control stays fully visible.

## 4. Dashboard view

- [x] 4.1 Add `WorkspaceDashboard` as a `.workspace-stack` sibling mounted only while Home is selected, rendering projects in project order as header rows with rolled-up status counts, each followed by its panels in panel order, including empty projects. Verified by a component test over a fixture inventory asserting row order and the empty-project header.
- [x] 4.2 Render each row as a single grid line reusing `AgentStatusIndicator` and the canonical status vocabulary, with `idle` as the resting state and a kind marker for file and folder rows. Verified by a component test asserting an agent-owned terminal shows its agent state and no competing raw-output state.
- [x] 4.3 Implement CSS truncation: fixed-width status/colour/emoji cells and a `min-width: 0` nowrap ellipsis text cell, with no JavaScript width measurement. Verified by an e2e test that narrows the viewport and asserts row count and heights are unchanged while long titles truncate.
- [x] 4.4 Implement row activation — project rows select that project, panel rows select the project and focus the panel through the existing `activateProject` + `activateTerminal` path — and resolve ids at click time so a stale row refreshes the list instead of failing. Verified by e2e activation of a terminal row and a unit test for the stale-row path.
- [x] 4.5 Keep the dashboard live while shown: status changes update in place and create/close/rename/reorder are reflected without leaving Home. Verified by an e2e test that renames a tab and changes a status with the dashboard open.

## 5. Show Dashboard command

- [x] 5.1 Add `show-dashboard` to `TERMINAY_HOST_MENU_COMMANDS` in `packages/protocol/src/host.ts`, to `appCommandMetadata`, and to `defaultKeyboardShortcuts` with `CmdOrCtrl+0`. Verified by `npm run typecheck` and the protocol/settings tests covering the command union and shortcut defaults.
- [x] 5.2 Handle `show-dashboard` in `executeCommandOnActiveProject` before delegation to the active `ProjectWorkspace`, so it runs with no active panel and with no projects open. Verified by unit tests invoking it in both states.
- [x] 5.3 Add the command to the Electron View menu in `electron/main.ts` and to the browser host's in-page menu. Verified by the existing menu-parity test extended to cover the new entry.
- [x] 5.4 Confirm it appears in the Command Bar and the shortcut settings surface with its default shown and rebindable. Verified by extending `e2e/keyboard-shortcuts.spec.ts`.

## 6. Verification

- [x] 6.1 Add an e2e spec (`e2e/workspace-dashboard.spec.ts`) covering: selecting Home leaves terminals running, the dashboard lists every project and panel including idle ones, rows are single-line and truncate, row activation lands on the right panel, and Home is restored after reload. Verified by the spec passing under `npm run test:e2e`.
- [ ] 6.2 Run `npm run lint`, `npm run typecheck`, `npm run test:workspaces`, and `npm run test:e2e` (Docker-isolated; never Playwright's Electron suite directly on the host). Verified by all four passing. **lint, typecheck and test:workspaces pass. test:e2e cannot produce a clean run on this machine: the Docker Electron/Xvfb container fails to boot the app within the fixture's 15s window for a large share of launches. An untouched control spec (`e2e/app.spec.ts`) shows the same profile there — 10 passed, 3 flaky, 2 failed, all at `fixtures.ts:617` — so this is the local environment, not the change. Needs a re-run on a quieter machine or in CI (10 shards, 2 retries).**
- [x] 6.3 Launch the app and confirm the dashboard against the intent: at a glance, every project and every tab with status, one line each. Verified by a screenshot of the dashboard with several projects open.
