## Why

Once a workspace holds more than two or three projects, there is nowhere to see the whole thing at once. The project tab bar shows names and a rolled-up badge; the activity menu shows only terminals that are currently notable and hides everything idle. To answer "what is running, where, and what is waiting on me?" a user has to click through every project tab in turn. The workspace already knows every project and every panel — it just never shows them together.

## What Changes

- Add a **Home** control to the project tab bar, immediately after the sidebar toggle and before the first project tab. It is icon-only, always present, never closeable, never reorderable, and is not part of project ordering or overflow.
- Selecting Home shows a **dashboard view** in the workspace area instead of a project workspace: every project as a one-line header row (colour, emoji, name, rolled-up status counts) followed by one line per open tab in that project, showing that tab's kind and status. Every row is a single unwrapped line, truncated to the available width.
- Rows activate: a project row selects that project; a tab row selects that project and focuses that panel. Rows carry no other actions in this change.
- Home is a **per-device selection**, like the active project tab is today. It is never written to server-owned workspace state, and it is remembered across reload. Project workspaces stay mounted and keep running while Home is shown; the previously selected project stays the command target.
- Each project publishes a **full panel inventory** — every terminal, file, and folder panel with its title, kind, and status — rather than only the notable terminals it publishes today. The existing activity menu and tab badges keep their current behaviour by filtering that inventory to notable entries.
- Add a `show-dashboard` application command with default shortcut `CmdOrCtrl+0`, exposed in the application menu, Command Bar, and the shortcut settings surface like every other command.

## Capabilities

### New Capabilities
- `workspace-dashboard`: the Home control, the at-a-glance dashboard view, its row model and status vocabulary, row activation, and the workspace panel inventory that feeds it.

### Modified Capabilities
- `workspace-and-project-tabs`: the tab bar gains a leading Home control that is never displaced and is excluded from project ordering and overflow; the chrome band and active-tab rules must define what happens while Home rather than a project is selected.
- `terminal-workspace`: per-device selection memory must be able to remember Home as the selected view, and must fall back to a project when a remembered Home selection is not restorable.
- `settings-shortcuts-and-desktop-integration`: a new `show-dashboard` command joins the host menu command set, the application menu, the Command Bar, and configurable shortcuts with a default accelerator.

## Impact

- `src/App.tsx`: header/tab-bar composition (`project-tab-sidebar-toggle-box` neighbourhood), `workspace-stack` rendering, `executeCommandOnActiveProject`, and the per-project activity publication (`getActivityOverviewItems` / `publishTerminalActivityOverview`) which becomes an inventory publication.
- `src/workspace/`: new dashboard view and row model; `localViewState.ts` gains the remembered Home selection; `TerminalActivityOverview.tsx` and `activityCountBadge.ts` consume the inventory through a notable-entry filter.
- `src/keyboardShortcuts.ts`, `src/components/SettingsWindow.tsx`, `packages/protocol/src/host.ts` (`TERMINAY_HOST_MENU_COMMANDS`), `electron/main.ts` menu: the new command and its accelerator.
- `src/App.css`: Home control and dashboard list styling, including the truncation rule.
- No server, protocol transport, or authorization change beyond adding one menu command name; the dashboard reads only what the client already holds.
