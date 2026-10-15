## Why

A user who runs something like `caffeinate` in a tab only to keep it alive turns off that tab's **Enable activity indicators** and expects the tab to go quiet. It does not. The tab's own dot goes quiet, but the Home dashboard (Board, List, and Projects views and its summary counts), the left-column tree, the compact switcher, an agent running in the tab, and phone push notifications all keep reporting it as working, done, or needing attention. The toggle's wording, "Show this tab in the top activity menu and color its activity underline", also undersells what a user expects it to mean.

Technically, the per-tab flag only filters the indicator-driven surfaces (`indicatorsSuppressed` on the inventory entry). Every surface that reads the inventory's raw `status` ignores it, agent-authority entries never carry it, and the server's notification manager does not know about it at all.

## What Changes

- A terminal tab can be **untracked**. Untracked means its activity is not reported anywhere a person reads activity: no working, finished, or attention state on its tab, its project-tab dot, the header Notifications list, the application icon badge, phone push, the left-column tree, the compact switcher, the Agents pane, or the Home dashboard. This covers raw-output activity and the state of an agent bound to the tab.
- The tab still appears everywhere it is listed. It always reads as idle, except on the Board.
- The Home dashboard Board gains an **Untracked** column after Done, which holds every untracked tab's card. The column is collapsible, starts collapsed, and its collapse state is remembered per device. List and Projects views show untracked tabs as ordinary idle rows. The summary counts untracked tabs separately and never as needing a person, working, or done.
- The per-tab toggle is renamed **Track activity**. Its description now says what turning it off does.
- The server does not raise or publish activity notification records for an untracked terminal, and turning tracking off withdraws any it holds. A notification a process sends on purpose through the control endpoint (for example MCP `send_notification`) is still delivered. Turning tracking back on acknowledges the terminal's current activity, so nothing that happened while it was untracked is reported later.
- MCP terminal status tools (`get_terminal_status`, `wait_for_idle`, and similar) keep reporting real activity. They are a control interface, not an indicator.
- The persisted per-panel flag keeps its existing name and meaning, so existing workspaces keep their setting. There is no data migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: adds the untracked-terminal contract, covering every activity surface, notifications, push, agent state, and MCP exemption, plus the renamed **Track activity** toggle.
- `agent-status-and-sidebar`: the tab RAG glyph and the header aggregate leave out an agent bound to an untracked terminal.
- `workspace-dashboard`: the Board gains a collapsible **Untracked** column, Board grouping keeps it, the summary counts untracked tabs separately, and List and Projects show untracked tabs as idle.

## Impact

- Renderer: `src/workspace/workspaceInventory.ts` (the inventory entry carries `untracked` and an idle status for untracked terminals, agent entries included), `dashboardRows.ts`, `dashboardViewMode.ts`, `WorkspaceDashboard.tsx`, `localViewState.ts` (Untracked column collapse key), `folderTreeSources.ts`, `compactSwitcherModel.ts`, `publishedNotifications.ts`, `components/TerminalTab.tsx` (bound agent glyph), the Agents pane, and `shared/SharedEditTabRouteBody.tsx` (label and description).
- Server: `packages/server-core/src/notifications/activityFeed.ts` and the workspace panel lookup, so notification records and push respect the panel's tracking flag.
- Unchanged: the persisted `activityIndicatorsEnabled` panel field, the MCP terminal status tools, and the global **Show indicator for active tabs** and **Show indicator for finished tabs** settings.
