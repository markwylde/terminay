## Context

The workspace UI renders every project at once. `src/App.tsx` maps `projects` to a `ProjectWorkspace` inside `.workspace-stack`, and only `isActive` decides which one is visible — inactive projects are `visibility: hidden` but fully mounted, with live Dockview APIs and attached terminals. That fact is what makes a dashboard cheap: the client already holds every project's panel list; nothing new has to be fetched from the server.

The header is a single `.project-tabbar` row: a `.project-tab-sidebar-toggle-box` button, then `ProjectTabList`, then the new-project split button, then `.header-actions` (update pill, `TerminalActivityOverview`, `RemoteAccessConnectionMenu`).

Status already exists in two forms, with a settled authority order (`terminal-activity-signals`): a terminal under agent authority reports an `AgentState`, and everything else reports a raw-output `TerminalActivityState`. `getActivityOverviewItems` in `App.tsx` already walks `api.groups[].panels[]` and encodes that precedence — but it drops every panel that is not currently notable, and it drops file and folder panels entirely. `App.tsx` collects those per-project arrays into `terminalActivityItemsByProject`, from which the activity menu (`buildTerminalActivityOverview`) and the per-tab badges (`summarizeActivityBadge`) are derived.

Per-device view state lives in `src/workspace/localViewState.ts` (`terminay.view.active-session.v1` in `localStorage`), deliberately best-effort. `activeProjectId` lives in `useProjectCollection` and is presentation-local by `workspace-and-project-tabs`.

Application commands are a fixed union in `packages/protocol/src/host.ts` (`TERMINAY_HOST_MENU_COMMANDS`), given titles in `src/keyboardShortcuts.ts` (`appCommandMetadata`, `defaultKeyboardShortcuts`), dispatched in `App.tsx` by `executeCommandOnActiveProject` — which handles app-scoped commands itself and otherwise delegates to the active `ProjectWorkspace` — and surfaced by the Electron menu in `electron/main.ts`.

## Goals / Non-Goals

**Goals:**
- One at-a-glance view of every project and every open tab, with status, that is correct the moment it is opened.
- A Home control that is unmistakably not a project tab, and a selection model that leaves everything running.
- One publication path for panel status, consumed by the dashboard, the activity menu, and the tab badges.

**Non-Goals:**
- No server, protocol transport, persistence, or authorization change. The only shared-contract edit is one new name in the host menu command union.
- No row actions beyond activation — no close, rename, create, or drag from the dashboard.
- No cross-device Home selection, no dashboard for projects living in torn-off windows beyond what the current view holds, and no history of past activity.

## Decisions

### Selected view is a discriminated local state, not a nullable project id

Add `selectedView: { kind: 'home' } | { kind: 'project'; id: string }` next to `activeProjectId` rather than modelling Home as `activeProjectId === null`. `activeProjectId` keeps meaning "the project commands act on", so it survives Home unchanged and `executeCommandOnActiveProject`, close protection, and the sidebar toggle keep working with no special case. Rendering derives from the pair: `isActive={selectedView.kind === 'project' && project.id === activeProjectId}`.

*Alternative considered:* a synthetic project entry with `id: '__home__'` in the `projects` array. Rejected — every consumer (ordering, overflow, drag, close protection, environment binding, server reconciliation) would need to exclude it, and one missed exclusion sends a fake project id to the server.

### Home lives in the header, not in `ProjectTabList`

Render the Home button as a sibling of `.project-tab-sidebar-toggle-box`, inside the same non-shrinking leading group. `ProjectTabList` owns overflow measurement, drag-and-drop, and reordering; keeping Home outside it means the control cannot be dragged, overflowed, or made a drop target by omission rather than by defensive code — which is exactly what the spec requires.

### The dashboard is a sibling in `.workspace-stack`

Render `<WorkspaceDashboard>` as one more absolutely-positioned child of `.workspace-stack`, shown when `selectedView.kind === 'home'`, with every `ProjectWorkspace` inactive. Because inactive projects are already hidden-but-mounted, this is the state the app enters whenever you switch tabs — terminals stay attached, leases behave as they do for any backgrounded project, and no lifecycle path is new. Mount the dashboard only while Home is selected so it costs nothing otherwise; its data source is external, so it renders complete on first paint.

### One inventory publication replaces the notable-only one

Widen `getActivityOverviewItems` into `getWorkspaceInventoryItems`: walk the same `api.groups[].panels[]`, emit an entry for **every** panel, and record `kind` from the panel params that already distinguish them (`sessionId` → terminal, `filePath` → file, `folderPath` → folder), plus `status` computed by the existing precedence with `idle` as the resting value. `App.tsx` stores it in one `inventoryByProject` map. The activity menu and tab badges then derive from a `selectNotableEntries(inventory)` filter that reproduces today's predicate — `isAgentAttentionState` / `working` / unread `done` for agent-owned terminals, `isTerminalActivityIndicatorStateVisible` otherwise — so their behaviour is provably unchanged while the dashboard reads the unfiltered list.

*Alternative considered:* a second, dashboard-only publication alongside the existing one. Rejected — two publications of the same underlying panels drift, and a status could read one way in the activity menu and another on the dashboard.

The publication is already triggered from panel add/remove, title change, activity change, and layout events (`publishTerminalActivityOverview` is called from ~10 sites, each behind a `requestAnimationFrame`). Widening the payload keeps those triggers; audit them for panel **rename** and **reorder** and add the missing calls, since those did not matter when only notable terminals were published.

### Status vocabulary is reused, never re-derived

The dashboard renders `AgentStatusIndicator` with the canonical `AgentState`, reusing `terminalOverviewStateToAgentState` for fallback states, so the same panel reads identically on its tab, in the activity menu, and on the dashboard. The dashboard adds exactly one value the other surfaces never needed — `idle` — and one non-status kind marker for file and folder rows.

### Truncation is CSS, not measurement

Each row is a grid with fixed-width status/colour/emoji cells and one `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` text cell. No JavaScript width measurement, no `ResizeObserver`, so narrowing the window can only truncate — it cannot reflow, reorder, or drop a row.

### `show-dashboard` is an app-scoped command handled before delegation

Add `show-dashboard` to `TERMINAY_HOST_MENU_COMMANDS`, `appCommandMetadata`, and `defaultKeyboardShortcuts` (`CmdOrCtrl+0`), place it in the Electron View menu, and handle it in `executeCommandOnActiveProject` alongside the other app-scoped commands, before the delegation to the active `ProjectWorkspace`. That placement is what makes it work with no active panel and with no projects at all. Hosts stay protocol-blind (ADR-0008): the desktop menu forwards an opaque command name and the server-bundled UI decides what it means.

### Boundaries crossed

None that are privileged. The dashboard is renderer-only, reads state the client already holds, and performs no filesystem, PTY, or network operation; the renderer remains untrusted at every privileged boundary (ADR-0005, ADR-0011). Home selection is per-device presentation state written only to `localStorage`, never to server-owned workspace state, preserving the `workspace-and-project-tabs` separation between canonical facts and local view. Panel titles and file paths shown on rows are already client-visible for the same panels; the dashboard exposes no data that a project tab does not, and it never crosses a project or session authorization boundary because activation goes through the existing `activateProject` + `activateTerminal` path rather than reaching into another project's state.

## Risks / Trade-offs

- **Publishing every panel instead of only notable ones increases inventory churn in large workspaces** → The payload is per-project, bounded by open panels (tens, not thousands), and publication is already `requestAnimationFrame`-coalesced. If it proves hot, the dashboard can subscribe to the map while the notable filter stays memoised per project.
- **Widening the shared publication could silently change the activity menu or tab badges** → The notable predicate moves into one named `selectNotableEntries` function with unit tests asserting the pre-change item set for agent-owned, raw-output, unread-done, and idle panels.
- **`localStorage` remembering Home could strand a user on a dashboard they did not choose** → The remembered value is a hint validated on restore, and any failure falls back to selecting a project, matching the existing per-device selection contract.
- **`CmdOrCtrl+0` collides with "reset zoom" in some hosts** → Terminal zoom in this app is `CmdOrCtrl+-/+` with its own reset binding; the accelerator goes through the existing validation path and is rebindable, so a collision is user-resolvable rather than baked in.
- **Row activation into a project that was closed between render and click** → Activation resolves the project and panel at click time and re-renders the list if either is gone, rather than trusting the row's captured ids.

## Migration Plan

Purely additive to the client bundle: a new control, a new view, one new command name, and a widened in-memory publication. No persisted schema, no server state, and no protocol message changes, so an older client against a newer server and the reverse both behave exactly as before. Rollback is reverting the change; the only durable trace is a `localStorage` key that an older build ignores.

## Open Questions

- None blocking. No in-force ADR needs revisiting for this change.
