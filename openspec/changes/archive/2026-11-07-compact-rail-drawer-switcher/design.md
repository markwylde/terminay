## Context

The compact switcher (`src/workspace/CompactSwitcher.tsx`, about 650 lines) is a bottom sheet. Its content is shaped by `compactSwitcherModel.ts`, which builds connection → project → folder → panel groups from the dashboard model. `App.tsx` mounts it and wires about twenty callbacks. The compact chrome row (`CompactChromeRow.tsx`) opens it from a breadcrumb and from the connection glyph.

The direction was settled in an interactive prototype review: the Rail Drawer, version C of the "Terminay Switcher POCs" artifact. The review added Home at the top of the rail plus a Home toggle in the chrome row. It placed the workflow dial on terminal rows only, in one aligned trailing column. It added a split create control whose dropup lists Claude Code, Codex and Terminal.

Every action the drawer needs already exists on the wide workspace:
- project reorder through `project.move` and composition order;
- folder reorder and the folder context menu (`folderMenuModel.ts`), plus the folder delete flow;
- the panel folder move and canonical panel order;
- terminal and project close protection;
- the server's terminal launcher list and create-with-launcher;
- `TerminalWorkflowBadge` / `WorkflowDial`, `useLongPress`, and Home sections (`homeSection.ts`).

## Goals / Non-Goals

**Goals:**
- Replace the bottom sheet with a leading-edge drawer: a project rail plus a panel that shows either one project's folder tree or Home.
- Keep every capability the sheet had: multi-connection reach, server switching, server upgrades, Add connection, New project, the Agents tab, filtering, and close protection.
- Add reordering, folder removal, launchers, workflow progress, and a one-tap Home toggle at phone width.
- Fix the prototype's animation glitch: changes inside the drawer must not replay its entrance.

**Non-Goals:**
- No server, protocol, or persisted workspace-state change.
- No change to the wide (above 640px) workspace, the Folders tree, or the desktop project bar.
- No new "create worktree" action. Worktrees still come from agents and Git, and the prototype's Worktree button becomes New project.
- No terminal-thumbnail previews (those were version B).
- No New folder in the drawer. Creating a folder stays on the wide Folders tree; the drawer covers the folder context menu's entries.
- No cross-server mutation from the drawer (decision 3a).

## Decisions

### 1. One drawer component built from small parts, mounted once per open

`CompactSwitcher` becomes a drawer shell made of these parts:
- `CompactRail`: server control, Home, projects, New project.
- `CompactProjectPanel`: header, Tabs and Agents tabs, `CompactFolderTree`, and the create bar.
- `CompactHomePanel`.
- `CompactLauncherDropup`.
- `CompactSheetMenu`: an action sheet reused for row, folder and server menus.

The shell mounts when the switcher opens and unmounts when it closes. The entrance animation is a CSS animation on the shell only. Rail selection, edit mode, menus and the dropup are internal state, so they never remount the shell.

The prototype re-rendered the whole tree, which replayed the entrance. That is why the alternative of keying inner panels on the selection was rejected.

### 2. The model stays the single source of rows

`compactSwitcherModel.ts` keeps building connection → project → folder → panel groups. It gains three things:
- rail shaping: per-project badge = attention count, else working count, from the existing `summary`;
- a Home needs-you list: terminals whose state is `waiting` or `blocked`;
- a flat filter result: terminals and folders matching title, folder, project or connection name.

The rail and the tree read the same groups, so a badge and its rows can never disagree. That property was already required of the sheet's header summary.

### 3. Rail selection is switcher-local and does not activate

Opening the drawer selects Home when Home is the view, and the project in front otherwise. Tapping a rail project only changes what the panel presents. The selection is not remembered across opens.

**Boundary:** a project on another connection is presented from the groups this window already has. Rows of a project whose folders are unknown are listed flat, as today. Activation and default-shell create still go through `activateAnotherServer`, which keeps the "a window is one server" rule (ADR-0047) intact.

### 3a. Mutations only on the window's own server

The window holds only its current server's workspace, folder facts and launcher list. Today's `closeCompactSwitcherPanel` shows the hazard: for a foreign panel it switches the server and returns without closing. So for a project on another connection the drawer offers only actions whose first effect is the switch:
- Open (activate a panel or folder);
- New Terminal with the default shell, via the existing `pendingCompactTerminalRef` cross-server create.

Rename, Move to folder, Close, folder menu entries other than New Terminal, launchers, edit mode and reorder are absent there. They become available after the switch, when the window holds that server. A failed switch is reported through the existing switch-failure path and performs nothing.

Considered and rejected: queueing each mutation across a bundle switch. It would add a pending-action protocol for every command, it fails awkwardly when the switch fails, and it buys little on a phone, where a single tap switches.

### 3b. Rail grouping and project order

The rail groups by connection: the current server first, then the others in server-menu order. Within a group it uses the window's composition order. A drag stays inside the current server's group and commits through `project.move`, so the rail always shows server-committed order. Cross-server presentation order stays editable on the wide project bar. That order is client-owned and the rail doesn't edit it, which avoids an order the rail could not honestly display.

### 4. Reordering reuses each existing commit path behind one grip hook

A new `useGripReorder` hook uses pointer-tracked grips. It does not use HTML5 drag and drop, matching the project menu's grips, which must work inside title-bar drag regions. The hook is axis-locked, opens a slot for the dragged item, and respects reduced motion. It autoscrolls its scroll container while the pointer is held within 32px of an edge. Escape or `pointercancel` aborts the drag and restores the previous order. Each grip is also a button: Arrow Up and Arrow Down move the item one place, commit, and announce the new position through a polite live region, matching the Folders tree's keyboard reorder. On release it calls:
- for projects: `project.move` within the current server (decision 3b);
- for folders: the folder reorder command used by `FoldersTree`'s `onReorderFolders`;
- for panels within a folder: the canonical panel-order commit that a dropped panel tab uses.

The list shows the server-committed order. No optimistic local order outlives the next snapshot.

**Boundary:** all mutations are existing server commands. The renderer gains no new authority.

### 5. Folder actions are the folder context menu, with launchers prepended

The ⋯ menu is built from `folderMenuEntries()` with the same inputs `FoldersTree` passes it: kind, Git facts, and pulling and deleting state. Each entry dispatches to the same handlers. The default-shell and launcher entries are prepended. Edit mode's folder close control opens the folder's delete entry (Delete worktree or Delete folder), so it runs the existing confirmation. General has no close control. `App.tsx` already owns these handlers for the Folders column, and they are exposed to the switcher the same way.

The folder's own controller (`useFolderMenuController`) is split so a caller outside the Folders tree can ask it for a folder's entries and run one: `describeFolderMenu(folderId)` returns the entries and a `run(action, anchor)`, and each project workspace exposes it on its handle. The dialogs those actions raise (rename, delete confirmation, pull feedback) are in-page modals of the folder's own workspace, and they sit below the drawer. So any folder action other than a new terminal dismisses the drawer first, brings that folder's project and folder to the front, and runs there, where its dialog and confirmation are in view. A new terminal from a folder stays on the create path and needs no dialog.

### 6. Launchers come from the server list, and the last choice is a device preference

The dropup and the folder menus read the same launcher list hook the Folders tree's New terminal row uses. That list belongs to the window's current server, so it applies only to that server's projects. For another connection's project the dropup shows Terminal alone and names the server to switch to (decision 3a). That list already updates live on server change events, so no polling is added (ADR-0028). Creating a terminal passes the launcher id through the existing create path. The default shell creates with no launcher id.

The last-used choice is stored as a device preference keyed by server id, through the same device-preference storage as folder collapse. It holds `shell` or a launcher id. A stored id that is no longer listed falls back to the shell. A failed read also falls back to the shell, silently.

The alternative of storing it per project was rejected: users pick an agent, not a project-specific agent.

### 7. Workflow presentation reuses the terminal's workflow subscription

Rows render `TerminalWorkflowBadge` inside a fixed-width trailing slot. The slot is as wide as the folder header's ⋯ control, so dials line up with each other and with the ⋯ column. Rows without a workflow keep the slot empty. A new small `TerminalWorkflowStep` uses the same `useTerminalWorkflow` and `tabSummary` to render the step text as the row's second line. When no workflow is attached, the row falls back to the preview line. Folder headers render no dial.

The activity indicator for `working` stays the existing `AgentStatusIndicator`, which is a dot. It is never a ring, so it cannot be confused with the dial.

### 8. Chrome row: title block and Home toggle

The breadcrumb becomes a two-line title block. Line one names the active panel:
- `LiveTerminalTitle` for a terminal;
- the file name for a file panel;
- the panel title for a folder panel;
- the project name when no panel is active.

Line two is swatch, project › folder (with the `worktree-` prefix stripped), plus the dial when the active panel is a terminal. On Home, line one is the front Home tab's title. App.tsx already derives `terminalTitle` and `terminalPanelId` from the active panel, and it gains the active panel's kind so the block never shows a stale terminal. A Home control with a house glyph sits before Notifications.

Pressing it while a project is in front calls `selectHome()`. Pressing it while Home is selected activates the retained command-target project, which is the project in front before Home (workspace-dashboard "Command target while Home is selected"). Its attention marker shows while any terminal of any attached connection is waiting or blocked, the same set the drawer's Home badge counts and its Needs you list shows, so the three never disagree.

### 8a. Layering, edit mode and keyboard

The shell keeps one layer stack: a menu or the dropup, then an expanded filter, then the drawer. Escape and outside presses pop only the top layer. Each layer records its opener and returns focus to it.

Edit mode is a single boolean in the shell. Selecting a rail item, selecting Agents, toggling it off, or a close of the presented project clears it. Row menus also open on right-click and on ContextMenu / Shift+F10, so a long press is never the only route.

### 9. Home panel

The panel lists the six sections from `homeSection.ts`, in the sidebar's order. Each has a one-line summary computed only from data the window already holds: for example, the open tab count from the inventory and the workflow count from the Workflows projection. A section with no held data shows a short description instead. No fetch is added. Choosing a section calls the same open-section path as the Home sidebar and dismisses the drawer. A needs-you list follows the sections.

### 10. Layout and motion

The drawer is a fixed overlay below the top safe area, 86% wide with a maximum width. The workspace stays visible in the trailing strip as a dismiss target. The rail is 64px wide. Rows are at least 44px tall for touch. The filter input is set at 16px to avoid iOS zoom, as today. With reduced motion there is no slide, no slot animation, and no pulse.

## Risks / Trade-offs

- [Narrower panel truncates long titles sooner than the sheet] → Folder names drop the `worktree-` prefix, rows truncate with the full name as the accessible name, and the step or preview line gives a second cue.
- [Long-press, swipe-to-scroll and grip-drag conflicts on touch] → Grips appear only in edit mode and use `touch-action: none`. Rows outside edit mode have no drag. Long press cancels on 8px of movement, as `useLongPress` already does.
- [Agents tab only for the project in front] → Matches today's contract. Browsing a background project shows its tree only.
- [Large rewrite of a component with broad e2e coverage] → E2E selectors keep their `data-compact-switcher-*` attribute names where the concept survives (panel, terminal, folder, new-terminal), so the suite changes only where behaviour changed.
- [Rail initials can collide (two "te…" projects)] → Items show the project emoji when one is set, otherwise initials, always on the project's colour, with the full name as the accessible name and on long-press editing.

## Migration Plan

This is a client-only change shipped with the server bundle. There is no data migration. The new device preference has no previous value. Rollback means reverting the client.

## Open Questions

None. Choices the review did not cover are recorded above: Agents tab placement, server control at the top of the rail, the Home section summaries, and New project in place of the prototype's Worktree button.
