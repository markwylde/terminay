## Context

Bot sessions are server-owned records (`packages/server-core/src/botService/sessions.ts`). A session's `origin` is `{ kind: 'chat' }` or `{ kind: 'trigger' | 'run-now', triggerId, triggerName, fireTime }` (`packages/protocol/src/bots.ts`). The `bots.sessions` read takes `{ botId, origin?, state?, search? }`. The handler checks that the bot exists and calls `sessions.list(botId, filter)`, which filters in memory and sorts newest first.

In the client, `BotTab` owns the Configure tab state (`configTab`) and renders one panel at a time. `BotTriggersPanel` renders the trigger table and the editor sheet. `BotSessionsPanel` holds its own origin, outcome and search state and re-queries the server when they change. `subscribeBotFocus` already moves a bot tab to Sessions with a selected session, which is the pattern this change follows.

Boundary: the renderer is untrusted (ADR-0011). It names a bot and a trigger id. The server derives the result from that bot's own records, so a trigger id cannot reach another bot's sessions.

## Goals / Non-Goals

**Goals:**

- One action from a trigger row, or from a saved trigger's sheet, opens Sessions filtered to that trigger.
- The filter covers both firings and Run now sessions of the trigger.
- The filter is visible and removable on the Sessions tab, and it combines with the existing filters.

**Non-Goals:**

- Trigger filtering in the agent runtime tools (`sessions_list`) or MCP.
- A trigger picker inside the Sessions tab. The filter is entered from the trigger only.
- Session counts per trigger in the table.
- Keeping an unsaved editor draft across the tab switch. Leaving the Triggers tab drops it, as it already does.

## Decisions

1. **Filter on the server by `triggerId`.** Add an optional `triggerId` to the `bots.sessions` read and to `sessions.list`. A record matches when `origin.kind !== 'chat' && origin.triggerId === triggerId`. *Alternative:* filter client-side by trigger name over the full list. Rejected: names are not unique or stable, and the list would have to be fetched unfiltered. *Boundary:* the filter applies after the existing `botId` match, so it never widens the result past the requested bot.

2. **Match by id, not by kind.** `trigger` and `run-now` sessions both carry `triggerId`. The trigger filter ignores kind, so both appear. The existing origin select still narrows by kind if the user wants only firings.

3. **The filter is state in `BotTab`.** `BotTab` keeps `sessionsTrigger?: { id, name }`. `BotTriggersPanel` gets `onShowSessions(trigger)`, which sets it and switches `configTab` to `sessions`. `BotSessionsPanel` gets `trigger` and `onClearTrigger` props, sends `triggerId` in its query, and renders a chip "Trigger: <name> ×". *Alternative:* route through `subscribeBotFocus`. Rejected: that bus is for cross-component focus requests from outside the tab. This is a local hand-off between two panels of the same tab.

4. **Clearing and selection.** The chip's × clears the trigger filter. Choosing the Sessions tab header also clears it, and only it, so the header means "sessions without a trigger filter". Origin, outcome and search are panel state and survive both. The `subscribeBotFocus` handler that opens a specific session also clears the trigger filter, so a Needs you or recent-session request from another trigger is never hidden. Applying a trigger filter resets `chatSessionId` and the panel's selection, so the panel selects the newest matching session.

5. **Chip label.** `onShowSessions` hands over the saved trigger's `{ id, name }`, so a trigger with no sessions has a name too. The chip shows that captured name until the filter is applied again. Filtering always uses the id, so a rename, or two triggers with the same name, cannot change which sessions match.

6. **Deleted triggers.** The filter matches the trigger id stored in each session origin. It does not check the bot's current trigger list. A deleted trigger's retained sessions stay reachable while its filter is applied, and an id that no session of that bot records returns an empty list.

7. **Placement.** Row: a small icon button with a `History` icon, labelled "Sessions for <name>", between Run now and delete. Sheet: a "Sessions" button in the footer, rendered only when `trigger` is defined (a saved trigger).

## Risks / Trade-offs

- [Unknown `triggerId` returns an empty list rather than an error] → Intended. A trigger that never ran is a normal case. The empty-state text reads "No sessions match." and the chip stays visible, so the cause is clear.
- [A renamed trigger's chip shows its old name] → Accepted. The label is the name captured at navigation, and choosing Sessions again refreshes it.
- [Header click clearing the filter may surprise a user who wanted to keep it] → The chip shows clearly while it is applied, and reapplying it takes one click from the trigger.

## Migration Plan

None. The new protocol field is optional. Older clients omit it, and the handler ignores it when absent.

## Open Questions

None.
