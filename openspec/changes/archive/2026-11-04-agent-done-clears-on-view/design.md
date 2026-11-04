## Context

An agent root's state and its read flag are separate fields. Acknowledgement
(`AgentStatusService.acknowledge` → `AgentStatusStore.markAcknowledged` /
`markTerminalAcknowledged` in `packages/server-core`) clears `unread` and
stamps `acknowledgedAt`, and nothing else. A `done` root therefore keeps
`state: 'done'` after the user has looked at it. Tab dots hide because they
gate on `unread`, but surfaces that show operational state — the Agents pane,
the dashboard Done column, the home overview — keep it green.

It only drops to `idle` when something else rewrites the state: the session
source bridge remapping the next snapshot (`rootState` treats a last turn that
ended before `acknowledgedAt` as `idle`), or a `session.started` /
`session.stopped` lifecycle event. That is why the user sees Done clear "some
time later", or not at all for a quiet session.

Plain terminals have no such gap: `markViewed` moves their activity from
`unviewed` to `viewed` immediately.

## Goals / Non-Goals

**Goals:**

- Acknowledging a `done` root makes it `idle` in the same store revision, on
  every attached client.
- A later snapshot from the source does not put it back to `done`.
- Agent tab glyphs, project badges, and header counts obey the same
  tab-indicator settings as plain terminals.

**Non-Goals:**

- Changing which interactions count as acknowledgement. That set is owned by
  the `notifications-clear-only-on-interaction` change and is reused as is.
- Changing `waiting`, `blocked`, or `working` on acknowledgement.
- Changing subagent entries.

## Decisions

### Rewrite the state inside the server's acknowledge, not in the renderer

`acknowledged(entry, at)` in `packages/server-core/src/activity/agentStore.ts`
returns `state: 'idle'` (with a fresh `stateStartedAt`, and `completionOutcome`
and `summary` cleared) when the entry is a `root` in `done`. Both
`markAcknowledged` and `markTerminalAcknowledged` select entries to touch by
`unread || (kind === 'root' && state === 'done')`, so a done root that was
already read is still cleared.

This keeps state authority in Terminay Server, the boundary
`agent-status-and-sidebar` already requires: clients render the server's
snapshot and never derive state. Alternative — have each client present an
acknowledged `done` as `idle` — rejected: every surface would need the rule,
MCP and remote clients would disagree, and the snapshot would lie.

### Rely on `acknowledgedAt` to keep the next snapshot `idle`

`rootState` already maps an `idle` snapshot to `done` only when its last turn
ended after `acknowledgedAt`, and only infers "ended now" when the previous
state was neither `idle` nor `done`. With the root now `idle` and
`acknowledgedAt` stamped, the next snapshot of the same finished turn maps to
`idle`; a genuinely new turn ends after the stamp and maps to `done` and
unread. No bridge change is needed. Hook-driven `agent.done` events are
reduced against the current entry, so a later `agent.metadata` keeps `idle`.

### Mirror the change in `src/agentStatusStore.ts`

The renderer-side `AgentStatusStore` carries the same acknowledge methods and
its own unit tests. It is updated to match so the two stores never disagree.

### One visibility predicate for both kinds of terminal

Plain terminals pass their activity state through
`isTerminalActivityIndicatorStateVisible` (`src/workspace/workspaceInventory.ts`),
which applies the per-terminal switch and the active/finished settings. The tab
(`TerminalTab.tsx`) and `isNotableInventoryEntry` bypass it for agent states.
Map the agent state onto the activity vocabulary (`working`→`recent`,
`done`→`unviewed`, `waiting`/`blocked`→`attention`) after the existing
unread gating, run it through the same predicate, and hide the glyph and drop
the inventory count when it is not visible. A pending MCP approval stays
outside the predicate, because it is a request for the user, not activity.
The same predicate also filters agent rows in the header Notifications list
(`publishedNotifications.ts`). It filters another attached server's agent
project badges (`crossServerAgentBadges.ts`) too, using the window's global
active/finished settings, since no per-tab switch exists for those terminals
here.

This is renderer presentation only; the server snapshot is untouched, so the
Agents pane and MCP still see true state. Alternative — a separate set of
agent indicator settings — rejected: the user asked for one behaviour, and two
switches for one dot is the inconsistency being removed.

## Risks / Trade-offs

- [Users with **Show indicator for active tabs** off — its default — lose the
  agent working glyph on tabs] → That matches plain terminals under the same
  setting; the Agents pane still shows working.

- [The Agents pane no longer shows a finished result once the user has looked
  at it] → That is the requested behaviour; the summary and outcome are still in
  the terminal itself.
- [A snapshot without `lastTurnEndedAt` arriving after the acknowledgement could
  look like a fresh end] → `rootState` only infers "ended now" from a previous
  `working`/`waiting`/`blocked` state, never from `idle`, so it stays `idle`.
