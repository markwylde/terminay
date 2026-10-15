# ADR-0065: An untracked terminal is silenced where activity is read, never where it is detected

Status: accepted
Date: 2026-10-16

## Context

A terminal panel carries a person's choice not to track its activity. Until now
that choice was honoured surface by surface: the tab dot and the notable-entry
filter checked it, while the dashboard, the left-column tree, the compact
switcher, bound-agent glyphs, and server-sent push did not. Each new activity
surface had to remember a check, and most did not, so a tab the person had
silenced still showed as working on Home and still sent a push to their phone.

ADR-0058 makes activity live server state, distinct from the workspace commit
that holds the panel and its flag. ADR-0061 makes notifications server-owned
records that every client only shows. Both leave open where a per-terminal
"don't tell me" belongs.

## Decision

1. **Tracking is a presentation gate, not a detection switch.** Turning tracking
   off for a terminal SHALL NOT stop activity detection, agent observation, or
   canonical agent state, and control interfaces such as the MCP terminal status
   tools keep reading real activity.
2. **The gate sits at the two sources every activity surface reads.** In a
   client, that is the workspace panel inventory: an untracked terminal's entry
   is idle and marked untracked, whatever its activity or agent state. On the
   server, it is the binding from activity to the notification manager: an
   untracked terminal raises no activity record, and becoming untracked
   withdraws the record it holds.
3. **A surface never re-derives activity around the gate.** A surface that
   needs status reads the inventory entry's status, and a surface that needs
   notifications reads the manager's published set. Reading raw session activity
   or agent state directly for presentation is not allowed.
4. **Messages are not activity.** A notification a process sends on purpose
   through the control endpoint is not gated.
5. **Re-tracking does not replay.** Turning tracking back on acknowledges the
   terminal's current activity, so only state that arises afterwards is
   reported.

## Consequences

- New activity surfaces get untracked behaviour without doing anything, as long
  as they read the inventory or the published notifications. Code review can
  reject a presentation path that reads raw activity.
- The flag stays in server-owned workspace state under its existing field name.
  It is read by the server's notification binding, which therefore depends on
  workspace changes as well as activity changes.
- The dashboard no longer shows "the canonical status regardless of indicator
  settings" for an untracked terminal. Diagnosing what a silenced terminal is
  doing goes through the MCP status tools or the terminal itself.
- Turning tracking back on clears unread state that accumulated while the
  terminal was untracked.
