## Context

Three surfaces show the same per-terminal activity items, all filtered from the workspace panel inventory:

- The **terminal tab** renders `AgentStatusIndicator` before its label: a 7px dot, amber and breathing for working, red for attention, green for finished.
- The **project tab** renders `ProjectTabActivityBadge` after its title: an 18px circle with a count, coloured by the highest-priority state. The same component sits in `ProjectSwitcherMenu` and `CompactSwitcher` rows.
- The **header** renders `TerminalActivityOverview`: a button holding up to three 18px count pills (attention, finished, working) and a chevron, opening a flat list of rows. The whole control is absent when the list is empty.

Acknowledgement already exists end to end. Each project workspace owns a terminal-activity controller whose `markViewed(sessionId)` clears the local fallback record and reports `activity.acknowledge` and the agent acknowledge operation to that project's server. Selecting a terminal tab calls it. Nothing outside a project workspace can call it today.

Decisions already made with the owner are recorded in `questionnaires/scope.yaml`.

## Goals / Non-Goals

**Goals:**

- A project reads the same way as a terminal: one small dot before the name.
- One place in the header answers "does anything need me?" with one number, and lets it be cleared without visiting each terminal.
- Dismissal is real acknowledgement, not a local hide, so every surface and every attached client agree.

**Non-Goals:**

- No new notification sources, history, or persistence. The list is still a live filter over the inventory; a dismissed notification leaves no record.
- No OS-level notifications, sounds, or dock badge changes.
- No change to which terminals are notable, to the activity settings, or to the dashboard.
- No protocol or server change.

## Decisions

### Reuse `AgentStatusIndicator` for the project dot

The project tab and switcher rows render `AgentStatusIndicator` at its `small` size with the project's summarised state mapped through the existing `terminalOverviewStateToAgentState` vocabulary (`attention` → `blocked`, `recent` → `working`, `unviewed` → `done`). `ProjectTabActivityBadge` becomes a thin wrapper that does this mapping and supplies the accessible label ("2 terminals, working"), keeping a project-specific element class so tests and the overflow observer can locate it independently of terminal tab dots.

Alternative considered: restyle the existing badge to 7px and hide the number. Rejected — two implementations of "the dot" would drift, which is exactly the inconsistency being fixed.

The summary keeps its count (`summarizeActivityBadge`) because the accessible label uses it; only the visible number goes.

### One Notifications control, split by dismissability

`buildTerminalActivityOverview` returns two lists instead of three counts: `notifications` (attention, then finished) and `working`. The header number is `notifications.length`. `TerminalActivityOverview` is reshaped into the Notifications control: a bell icon button, a single red count pill reusing the fixed-circle sizing in `activityCountBadge.ts`, and a two-section menu. The control renders unconditionally; the effect that closes the menu when the list empties is removed, since an empty list is now a valid open state.

Alternative considered: count everything, including working. Rejected by the owner — a working terminal is not something to act on and cannot be cleared, so it would make the number unclearable.

### Dismiss calls the owning workspace's existing acknowledgement

The project workspace's imperative handle gains one method, `acknowledgeTerminal(sessionId)`, which calls the controller's existing `markViewed`. The header's dismiss handler resolves the item's workspace by server and project and calls it; **Clear all** does so for every notification item. No selection, focus, or project activation happens.

This crosses the project/window and terminal-session boundary in one narrow way: a header control acts on a terminal in a project that is not active, possibly on another attached server. It stays inside the boundary because the call is routed to the workspace that owns that session and uses that server's own client, with the server and project taken from the inventory entry rather than from anything the row displays. Acknowledgement remains server-owned; the renderer gains no new authority, only a second trigger for an operation it could already perform by selecting the tab.

Alternative considered: a header-level list of hidden notification ids. Rejected — it would desynchronise the header from the tab and project dots and from other clients.

### Row activation acknowledges through the normal path

Activating a row keeps calling `activateTerminal(panelId, sessionId)`. That is specified as equivalent to selecting the tab, so it acknowledges. If the current implementation does not acknowledge on this path, it is corrected to call the same `markViewed`.

## Risks / Trade-offs

- [Header rows from other attached servers are keyed by project id alone in `workspaceRefs`] → Resolve the workspace by the server-and-project key the tab strip already uses; cover with the two-servers-same-project-id scenario.
- [A dismissed terminal that is still producing output reappears as a notification on its next completion] → Intended: dismissal acknowledges what happened, it does not mute the terminal.
- [Removing the number loses "how many"] → The count stays in the dot's accessible label and tooltip, and the Notifications list shows every terminal.
- [An always-visible icon takes header space on compact layouts] → It replaces a control that was up to three pills wide; at zero it is narrower than before whenever anything was showing.
- [E2E suites locate `.project-tab-activity-badge` text and `.terminal-activity-pill--*` classes] → Update the locators in the same change; keep distinct, stable class names for the project dot and the header count.

## Migration Plan

Pure renderer change shipped in the workspace bundle; no data or protocol migration. Rollback is reverting the change.

## Open Questions

None. No in-force ADR needs revisiting.
