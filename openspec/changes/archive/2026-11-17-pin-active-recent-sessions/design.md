## Context

`BotContextRail` renders `sessions.slice(0, 6)` from the per-bot projection in `useServerBots`, which is `client.sessions(botId)` sorted newest first and cut to 20 (`RECENT_SESSIONS`). The rail already treats `queued`, `running`, and `needs-you` as stoppable, and `BotChat` uses the same three states for its `active` list. Other consumers of the projection (Sessions tab, profile, environment, sidebar list, `botActivity`) rely on newest-first order.

## Goals / Non-Goals

**Goals:**
- Pin active sessions above inactive ones in the rail, newest first within each group, before the six-row cap.
- Never lose an active session from the client projection because of the 20-row cut.
- Mark active rows as live using existing bot styling.

**Non-Goals:**
- Reordering the Configure → Sessions tab, which is a filterable history.
- Server or protocol changes; the server already returns all retained sessions and never prunes active ones.

## Decisions

1. **One shared active predicate in `botsModel.ts`** (`isActiveSession`), used by the rail's ordering, its Stop button, and `BotChat`'s active list. Alternative: inline arrays as today — rejected because the pin set and the Stop set must not drift.
2. **Order in a pure helper** (`recentSessions(sessions, limit)`): stable partition into active then inactive, each sorted by `startedAt` descending, then slice. With more than `limit` active sessions the slice holds the newest active ones; the user's request keeps recency order within the active group rather than ranking by state, and View all reaches the rest. Pure, so it is unit-tested without React. Alternative: reorder the projection itself — rejected because other views depend on newest-first order.
3. **Projection keeps active sessions beyond the 20 newest**: after sorting newest first, keep the first 20 plus any older active session, preserving newest-first order. Extracted as a pure helper (`retainRecentSessions`) so it is unit-tested; the projection stays newest first for its other consumers. Active sessions are bounded by bounded admission (at most four work, one coordination, and twenty waiting executions), so the projection stays small. Alternative: raise the cap — still loses an active session eventually.
4. **Live marker reuses `bots-pulse`** on `.bots-sess__dot` for active states, disabled under `prefers-reduced-motion` like the existing typing dot. No new colours or tokens.

Boundary: all changes are renderer-side presentation of data the client is already authorized to read for this bot; no Electron privilege, project/window, or terminal-session boundary is crossed.

## Risks / Trade-offs

- [More than six active sessions] → the rail shows the six newest active ones; an older running session can be hidden by newer queued ones. Accepted: recency within the group is the requested order and View all lists everything.

- [Pinned rows reorder as states change] → Ordering is derived from the live projection on every render, so a session moves groups as soon as its state update arrives; this is the intended behaviour.
- [`needs-you` dot shares the failure colour] → The label "Needs you" and the pulse distinguish it from Failed; no colour change in this change.

## Migration Plan

None. Pure client rendering change; rollback is a revert.

## Open Questions

None. In-force ADRs are unaffected.
