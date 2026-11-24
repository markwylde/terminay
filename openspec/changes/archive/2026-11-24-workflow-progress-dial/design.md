## Context

`WorkflowTabProgress` (`src/workspace/workflows/WorkflowTabBadge.tsx`) draws `done/total` as 11px secondary text plus a red dot after a terminal tab's title, reading `tabSummary()` from `workflowPanelModel.ts`. The tab chrome (`DockTabChrome`) renders `afterTitle` then the close button. The close button always takes its 20px; hover and focus only change its opacity. The Tabs sidebar (`FoldersTree` `PanelRow`) shows a status dot, the live title and an optional worktree tag. It has no server id, and `useTerminalWorkflow(serverId, sessionId)` needs both. The compact switcher (`CompactSwitcher` `CompactSwitcherPanel`) rows already carry `serverId` and `sessionId`. At phone width it is the only list of terminals, since the panel tab strip is absent there.

The server already pushes workflow state to every client (ADR-0097). This change is presentation only, in the shared server-bundled workspace UI, so desktop, browser and phone clients all render it the same way.

## Goals / Non-Goals

**Goals:** a legible dial on the tab, the Tabs sidebar row and the compact switcher row; the state in words for the tooltip and screen readers; a finished dial that clears once seen.

**Non-Goals:** no server, protocol or MCP change; no change to the workflow panel or rail; no dial in the project tab's peek.

## Decisions

- **One `WorkflowDial` component, an SVG ring.** A 12px SVG with a track circle and an arc drawn with `stroke-dasharray` from the done fraction. Tones reuse the rail's colours (green done, amber running, red alert, grey idle) through CSS classes. An unrestorable workflow has fraction 1 and the red tone. Alternative considered: a conic-gradient span. Rejected because SVG strokes stay crisp at 1x and theme through `currentColor`.
- **Extend the summary model rather than replace it.** `tabSummary(view, now)` returns `tone`, `fraction`, `completionKey` (set only when finished) and `label`. It stays pure and is unit-tested without React. Label forms:
  - running: `Implement · 3 of 8 · 14m`
  - needs input: `Review needs you · 2 of 5 · 3m`
  - a failed step beside the named one: append ` · Build failed`
  - only a failed step: `Build failed · 2 of 5`
  - between steps: `Next: Verify · 4 of 8`
  - finished: `All 8 steps done`
  - unrestorable: `Workflow could not be restored`

  The time is `now − startedAt` of the named step. The canonical spec keeps `startedAt` across `running` ↔ `needs_input`, so this is time since the step started, not time in its current status. A 30-second ticker re-renders the dial only while a step is active, and is cleared on unmount.
- **Placement.** The tab already renders `afterTitle` immediately before the close button, which is always laid out. The dial goes last in `afterTitle` (after the recording and macro indicators) with `flex-shrink: 0`. The title already truncates with an ellipsis. No change to `DockTabChrome`.
- **Lists.** `FoldersTree` takes an optional `serverId` prop, which `ProjectWorkspace` passes through `FoldersColumn`. `PanelRow` renders the badge for terminal rows after the worktree tag. `CompactSwitcherPanel` renders it after the title text, using the row's own `serverId` and `sessionId`. **Boundary:** the server id only selects which server's already-received workflow map to read. It grants no authority, so the project/window and terminal-session boundaries are untouched.
- **Seen record keyed by completion.** A completion key is `workflowId + ':' + max(endedAt)` over the steps. When a seen workflow reopens and finishes again, the latest end time changes, so the new completion has a new key and shows again. No clearing is needed. A replacement workflow has a new id.
- **Pending lifecycle.** A hook, `useWorkflowSeen(completionKey, isActive)`, holds a pending key in a ref. The key is set while the terminal is active and the summary has a completion key. When `isActive` turns false, or the component unmounts, it commits the pending key if it still equals the current completion key. If the completion key changes or disappears first, the pending key is dropped. Only the tab marks a completion as seen; the rows only read.
- **Active signal.** `isActive` is the terminal panel's `isFocused` parameter, which the workspace sets on the one terminal the user is in. It is the same signal the tab uses to draw itself active. The terminal pane (`TerminalPanel`) runs `useMarkWorkflowSeen`, not the tab: at phone width the tab strip is absent, but every layout mounts the pane. The tab and rows only read the record. The commit logic lives in a small `WorkflowSeenTracker` class, so it is unit-tested without React.
- **Storage.** `workflowSeen.ts` keeps a list of completion keys, newest first and capped at 500, in `localStorage` under `terminay.workflowSeen.v1`. Every read and write is wrapped in try/catch, with an in-memory fallback. It exposes `subscribe`, `isSeen` and `markSeen`, and re-reads on the `storage` event so other windows of the same client update. Writes re-read the stored list and merge it before writing, so two windows don't drop each other's entries. **Boundary:** the record stays on the client and is never part of server workspace state, like the device-local panel-collapse setting.

## Risks / Trade-offs

- [The `◐` glyph some agents put in titles looks like a dial] → the dial sits at the other end, before the close button, with a visible track ring.
- [localStorage unavailable] → the record falls back to memory. A finished dial then comes back after a reload, which is harmless.
- [Eviction past 500] → only the oldest seen completions can come back, which is acceptable and within the spec's bound.
- [Meaning carried only by colour] → the tooltip and accessible name carry the state in words.

## Migration Plan

None: this is presentation only. Rollback is reverting the change.

## Open Questions

None. ADR-0097 stays in force and is unaffected. The 30-second display ticker is a time-only presentation refresh, which ADR-0028 allows.
