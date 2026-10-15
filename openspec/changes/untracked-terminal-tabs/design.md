## Context

Each terminal panel already carries `activityIndicatorsEnabled` in server-owned workspace state (`packages/server-core/src/workspace.ts:80`). It is set from the Edit Tab window (`src/shared/SharedEditTabRouteBody.tsx`) and travels with the panel through transfer and adoption.

In the renderer, `buildProjectInventoryEntries` (`src/workspace/workspaceInventory.ts`) always puts the raw status on the inventory entry and adds only `indicatorsSuppressed`. Agent-authority entries skip the flag entirely. Of the readers, only `selectNotableEntries` (header Notifications fallback, project-tab dot, badge) and `publishedNotifications.isHiddenBySettings` honour it, and the latter only for non-agent records. Every reader of `entry.status` ignores it: dashboard rows, the Board, summary counts, the left-column tree and its folder roll-ups, and the compact switcher. `TerminalTab.tsx` hides the raw-output glyph but still draws a bound agent's glyph.

On the server, `bindNotificationsToActivity` (`packages/server-core/src/notifications/activityFeed.ts`) turns every session snapshot into a notification record without consulting the panel, so the header, the badge, and phone push all fire for an untracked tab.

Boundaries this design crosses:
- **Server-owned workspace state vs live server state (ADR-0058).** The tracking flag is workspace state, set by a person. Activity is live state derived from output. The change reads the flag at presentation points and never writes activity into the workspace or the flag into activity.
- **Notification ownership (ADR-0061).** Notifications are records owned by the server's manager, and clients show what it publishes. Untracked filtering of notifications therefore belongs to the server, not to each client.
- **Terminal-session boundary.** The flag is resolved per panel, keyed by server and project. A panel's flag never affects another server's session that happens to share a session id.

## Goals / Non-Goals

**Goals:**
- One definition of "untracked" that every activity surface gets from the same two sources: the renderer inventory and the server's notification manager.
- The Board's Untracked column, with per-device collapse state that starts collapsed.
- The toggle renamed **Track activity**, with a description that says what it does.

**Non-Goals:**
- Changing activity detection, agent journal observation, or canonical agent state.
- Changing MCP terminal status tools. `get_terminal_status`, `wait_for_idle`, and similar keep reporting real activity.
- Renaming or migrating the persisted `activityIndicatorsEnabled` field.
- Suppressing notifications that processes send on purpose through the control endpoint.

## Decisions

### 1. The inventory entry is the single renderer-side gate

`buildProjectInventoryEntries` resolves `untracked = params.activityIndicatorsEnabled === false` for every terminal entry, agent-authority entries included. For an untracked entry it emits `status: 'idle'`, `untracked: true`, no `since`, no `agentUnread`, and `isAgentStatus` unchanged so agent detail (name, provider, model, prompt) stays available to the Board card.

Every surface that already reads `entry.status` (dashboard rows, the Board, summary counts, the left-column tree, collapsed-folder dots, the compact switcher, the project-tab dot) then turns neutral without per-surface code. Only two places branch on `untracked`: the Board, which routes the card to the Untracked column, and the summary, which counts it separately.

*Alternative considered:* teaching each surface to check `indicatorsSuppressed`. Rejected. That is how the current bug arose, since every new surface has to remember the check, and it keeps "the dashboard shows the canonical status" as a second truth. `indicatorsSuppressed` stays for its narrower meaning, the global active/finished display settings, and is redefined so that untracked always implies suppressed.

### 2. Agent detail is kept, agent state is dropped

The Board's Untracked card and the Agents pane still show who the agent is. Neither shows its state glyph or unread flag. `TerminalTab.tsx` stops drawing the bound-agent RAG glyph when the panel is untracked, and the header aggregate drops those entries.

*Alternative considered:* hiding untracked agents from the Agents pane entirely. Rejected, because the spec requires surfaces to keep listing what they list. Silencing a tab should not make its agent unfindable.

### 3. Notifications are filtered at the server's source

`bindNotificationsToActivity` gets a lookup `isTracked(sessionId)`, backed by the server workspace's panel for that session. In `reconcile`, an untracked session calls `manager.setActivity(owner, undefined)`. That withdraws a pending or published activity record, and through the manager it reaches the header, the badge, and push in one place, as ADR-0061 requires. The binding also subscribes to workspace changes (ADR-0059) and reconciles a session whenever its panel's flag flips.

Process-sent records (`source !== 'activity'`) are untouched: they are messages a process chose to send.

When the flag flips from off to on, the server acknowledges the session's current activity before reconciling it, using the same acknowledgement path that a terminal view or interaction uses. A command that finished while untracked therefore does not surface as "finished" the moment tracking is turned back on.

*Alternative considered:* filtering in each client (`publishedNotifications.isHiddenBySettings`). Rejected. Phone push is sent by the server, so a client-side filter cannot stop it, and ADR-0061 forbids clients from deriving notifications. The client filter is kept as a defensive no-op for untracked activity records and extended to agent records, so a stale record is not shown during the round trip.

### 4. Untracked column collapse is a per-device view hint

`localViewState.ts` gains `terminay.view.dashboard-board-untracked-collapsed.v1`, defaulting to collapsed when absent or unreadable, following the existing Board-grouping key pattern. In grouped mode the same flag applies to every lane's Untracked column.

### 5. Rename only the label

The Edit Tab row becomes **Track activity**, with the description "Show this tab's activity on its tab, its project, the sidebar, Home, notifications, and your phone. Turn off for long-running commands you don't need to watch." The `activityIndicatorsEnabled` field, and the `aria-label`, which follows the visible label, are the only identifiers touched: the label changes and the field name does not.

## Risks / Trade-offs

- [Server lookup from session to panel is missing for a session not yet in any panel, e.g. during adoption] → treat an unknown session as tracked, which is today's behaviour, and reconcile again on the workspace change that places it.
- [Remote clients on an older server show the dashboard neutral while push still fires] → acceptable. Server and client ship together (ADR-0047), and the renderer change alone already fixes the reported symptom.
- [Acknowledging on re-enable could clear an agent's unread "done" that the user wanted to see] → this is intended per the spec. The agent's state is unchanged and still visible in the Agents pane.
- [Summary counts change meaning for anyone comparing old screenshots] → the untracked count is omitted at zero, so the common case reads the same.

## Migration Plan

No data migration is needed: the persisted field is unchanged and absent still means tracked. Rollback is a plain revert. A stored Untracked collapse key is ignored by older builds.

## Open Questions

None. Scope decisions were confirmed with the user: agent state is hidden, push is suppressed, the column starts collapsed, and MCP stays real.
