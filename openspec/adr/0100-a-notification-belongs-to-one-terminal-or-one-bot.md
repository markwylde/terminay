# ADR-0100: A notification belongs to one terminal or one bot

Status: accepted, supersedes ADR-0061 in part
Date: 2026-11-06
Supersedes: ADR-0061 (decisions 1, 2 and 8 only; every other decision continues)

## Context

ADR-0061 made a notification a server-owned record that belongs to exactly one
terminal. Terminal activity and processes in that terminal were its only
sources, and it was never persisted. Bots came later (ADR-0089, ADR-0093). A bot
is workspace-wide and never belongs to a project or terminal, yet the most
useful thing it does is post a message the user has not seen. Under ADR-0061
that post had no way to reach the header Notifications list, the count, or the
application icon badge. A bot's result could sit unread indefinitely.

Carrying bot notifications on the bot protocol, with clients merging them into
the list, would bring back what ADR-0061 rejected: clients deriving
notifications, a second settle rule, and **Clear all** spread across two
protocols.

## Decision

1. **A notification belongs to exactly one owner: a terminal or a bot.** The
   server resolves that owner. The notification manager remains the one place
   that holds notifications and decides when they are published.
2. **Each owner has its own sources.** A terminal's sources are terminal
   activity and processes calling the control endpoint. A bot's only source is
   the bot service, which holds at most one notification per bot, derived from
   the bot's posts since they were last acknowledged.
3. **A bot notification stays behind bot authority.** Only clients holding bot
   authority on the server see it or can dismiss it. It never reaches a project
   or session-scoped client, an MCP or control-endpoint caller, or a push
   banner.
4. **Notifications are live state and are not persisted.** A source that must
   outlast a restart persists its own facts and re-adds its notification at
   startup. A bot persists how far its posts have been acknowledged, beside its
   message log.

ADR-0061's decisions 3 to 7 continue unchanged: the settle period, consumers
showing only the published set, status indicators not being notifications,
interaction with a terminal removing its notifications, and bounded plain-text
process text.

## Consequences

- A bot post appears in the header list and count, and on the icon badge,
  after the same settle period as any other notification. Viewing the bot's
  Chat on any client, posting to it, or dismissing the notification clears it
  everywhere.
- Every reader of the published set must handle a record with no terminal.
  Project projection, the MCP adapter, push, and automation-space visibility
  each exclude or pass through bot records explicitly.
- A new kind of owner, should one arise, takes the same shape: an owner
  identity, one source in the server, and an explicit authority line at every
  reader.
- Bot posts do not yet reach a paired phone by push. Allowing that is a
  separate decision about whether bot content may leave the server sealed for a
  device.

## Open items

- Whether bot notifications should be pushed to paired devices that hold bot
  authority.
