## Context

The server's `NotificationManager` (`packages/server-core/src/notifications/`)
is the only place that holds notifications (ADR-0061). Each record belongs to
one terminal (`projectId`, `sessionId`) and comes from one of two sources:

- `activity`, which the activity feed sets per terminal;
- `message`, which a process sends through the control endpoint.

The manager holds a record as pending for `NOTIFICATION_SETTLE_MS` before it
publishes it. Its records are in memory only. `notifications.snapshot`, `.delta`
and `.dismiss` serve the published set at `read` scope. Project-claimed clients
are narrowed by `projectId`, both in the manager's snapshot and replay and in
the journal event projector. The workspace UI turns the published set into
header rows (`publishedNotificationItems`) by matching each record to a
terminal in the window's inventory. The push sender and the MCP notification
adapter are two more readers of the same set.

Bots (`packages/server-core/src/botService/`) are server-owned and never belong
to a project. Every bot operation requires bot authority, checked by
`assertBotAuthority`: `write` or `admin` scope, no capability, project, or
session claim, and not the MCP system client. `BotMessageStore` persists each
bot's message log in `messages.json` with a monotonic `sequence`. Bot posts
arrive through the runtime tools with `author: 'bot'`. The Chat UI keeps a
read position per device, used only for the unread divider (`BotChat.tsx`).

## Goals / Non-Goals

**Goals:**

- A bot post produces one server-held notification per bot. It shows in the
  same header list and count as terminal notifications, with the same settle
  period, the same dismissal, and the same agreement across clients.
- Acknowledgement is shared by every client, survives a restart, and is driven
  by viewing Chat, posting, or dismissing.
- A bot notification never crosses the bot authority boundary. It never reaches
  a project or session-scoped client, MCP, or push.

**Non-Goals:**

- Push banners for bot posts on paired phones.
- OS-level desktop notifications.
- Changing the per-device unread divider.
- Notifying on bot state other than posts, such as needs-you permission
  requests or failures.
- Per-bot mute settings.

## Decisions

### 1. Bot notifications live in the one notification manager

The manager gains a second kind of owner. `NotificationRecord` becomes a
discriminated union on `owner`:

- `TerminalNotificationRecord`: `owner: 'terminal'`, with the required
  `projectId` and `sessionId` it has today;
- `BotNotificationRecord`: `owner: 'bot'`, with the required `botId` and no
  `projectId` or `sessionId`. It also carries `source: 'bot'`,
  `kind: 'bot-message'`, `body` (the excerpt), `count`, `throughSequence` (the
  sequence of the latest covered post), and `raisedAt` (the latest post time).

`NotificationEvent` is the same union. Every event carries `owner`, plus
`projectId` and `sessionId` or `botId`, at the top level. That includes
`notification.removed`, which has no record body, so projection never depends
on the body. Wire parsers on both sides reject a record, event, or dismissal
payload that mixes the two identities or lacks its owner's fields. The manager gets
`setBot(botId, state | undefined)`, which works like `setActivity`:

- adding a bot record starts the settle period;
- a change keeps the record id and its publication state, and emits
  `notification.changed` once published;
- `undefined` removes the record.

Terminal records keep every existing wire field and gain `owner: 'terminal'`.
A record without `owner` parses as a terminal record, so a newer client still
reads an older server.

*Alternative:* carry bot notifications on the bot protocol, with each client
merging them into the header list. Rejected. That has clients deriving
notifications, which ADR-0061 rejected because every surface would have to
agree on the rule. It also needs a second settle timer, and makes **Clear all**
span two protocols.

*Boundary crossed:* the notification manager stops being terminal-only. That is
recorded as a new ADR superseding ADR-0061.

### 2. The bot service is the bot record's only source

A new `BotNotificationFeed` in `botService/` subscribes to `BotMessageStore`
changes and owns `setBot`. For each bot it computes the state from the store:

- the bot posts after the bot's `acknowledgedSequence`;
- their count;
- the latest one's excerpt, from the existing summary excerpt, cut to 280
  characters, or `Sent an image` when it has attachments and no text;
- the latest one's `createdAt`.

It recomputes on post, edit, remove, clear, and acknowledge. It calls
`setBot(botId, undefined)` when no unacknowledged post remains, or when the bot
is removed. At startup it walks every bot once and restores the records. The
settle period then applies again, which is harmless.

`acknowledgedSequence` is a new field in the persisted message state. When it
is missing, it reads as the current `sequence`, so existing bots start with
nothing unread and no notification appears for old posts. The store writes it
durably with the same `writeFileDurablySync` path as messages.

*Alternative:* persist the notification record itself. Rejected. ADR-0061 keeps
the manager as live state. The source of truth is the message log, so deriving
from it on startup cannot drift.

### 3. Acknowledgement is a bot operation behind bot authority

A new command, `bots.messages.acknowledge { botId, throughSequence }`, calls
`assertBotAuthority`. It sets `acknowledgedSequence` to
`max(current, min(throughSequence, sequence))`. It is monotonic and
idempotent, so concurrent devices cannot move it backward. The client always
sends the sequence it has observed, never "everything", so a post that is
stored but not yet delivered stays unacknowledged and keeps the notification.

- The client calls it with the latest loaded sequence when Chat becomes visible
  (bot tab in front, Home the active view, Chat mode, window visible), and
  again whenever a new
  message arrives while that holds. A background tab, a hidden window, and
  Configure mode never call it.
- A user post acknowledges through the post's own sequence on the server,
  inside `post`, so no extra round trip is needed.
- `notifications.dismiss` for a bot record calls a new
  `acknowledgeBot(botId, throughSequence)` option on the notification
  registry, which the bot service provides, after checking bot authority on
  the request. The dismissal carries the `throughSequence` the client was
  shown, and the server acknowledges through the smaller of that and the
  record's own, so a post that updated the record in place after the client
  read it survives the dismissal, and a client cannot claim past the record. **Clear all**
  is a loop of dismissals, as today.

*Boundary crossed:* the renderer's sense that Chat is visible decides when the
client asks to acknowledge. That is acceptable. Acknowledgement grants no
authority and only hides a notification, the same trust terminal
acknowledgement already relies on. The server still enforces bot authority on
every call.

### 4. The authority boundary is enforced at every reader

- **Snapshot and replay.** `NotificationManager.snapshot` and `replay` take a
  visibility filter in place of the bare project claim:
  `{ projectId?: string; bots: boolean }`. `bots` is
  `canReadBotEvents(client)`. With a project claim, or without bot authority,
  bot records and bot events are omitted. Revisions and cursors stay global, as
  they already are under project narrowing.
- **Journal projector.** `createNotificationEventProjector` drops an event
  whose top-level `owner` is `bot` unless `canReadBotEvents(client)`, and
  always drops it for a project-claimed client. This covers published,
  changed, and removed events alike.
- **Dismiss.** The payload carries either `projectId` and `sessionId`, or
  `botId`. A `botId` dismissal throws `forbidden` without bot authority.
- **MCP.** `notificationAdapter.ts` filters `list` to terminal records, and
  `dismiss` resolves only terminal records, so a bot id is not found.
- **Push.** The push sender's `describe` returns `undefined` for bot records.
  Its existing `visible()` filter then keeps them out of banners and counts.
- **Automation space.** `automationSpaceVisibility` already withholds by
  terminal space. Bot records pass through it unchanged, and it must not crash
  on records with no `projectId`.

### 5. The client renders bot rows from the same published set

`publishedNotificationItems` runs once per connection, as it does today, and
takes that connection's bot lookup (id → name, avatar, colour) beside its
inventory entries. Every row is keyed by the connection's server id plus its
owner identity, so bots that share an id on two servers are two rows. Open,
acknowledge, and dismiss go through the connection that published the row. For a bot record it emits a row with
`kind: 'bot'`, `botId`, `count`, the excerpt, and `since: raisedAt`. It sorts
the row in the attention group. A record whose bot is not known to the window
is skipped, as an unknown terminal is today.

`App.tsx` builds the lookup from the bots it already subscribes to. Activating
a bot row opens or focuses the bot's Home tab in Chat. Dismissing a bot row
sends `notifications.dismiss` with `botId`. The header count is the length of
the row list, so bot rows are counted with no extra code, and the Desktop icon
badge follows the header count.

An older bundle attached to a newer server receives bot records only if it has
bot authority. It skips them, because they match no terminal.

## Risks / Trade-offs

- [A client stuck showing Chat, such as a forgotten foreground window, keeps
  acknowledging every post] → The trigger is "window visible", the same rule
  the existing Chat read marking uses. The behaviour matches what a user
  watching the chat expects.
- [A busy bot posting often churns `notification.changed` events] → Updates are
  coalesced by the manager's one-record-per-owner rule. The existing bot post
  rate bounds apply. No new timer or poll is added.
- [The optional `projectId` and `sessionId` on records could break consumers
  that assume them] → Every in-repo consumer is updated and type-checked:
  projector, MCP adapter, push sender, automation visibility, and the UI. Unit
  tests cover a bot record through each one.
- [Writing `acknowledgedSequence` on every Chat view costs a durable file
  write] → The operation is a no-op, with no write, when the sequence does not
  advance.

- [Three in-flight changes (`server-notification-manager`,
  `notifications-clear-only-on-interaction`, `one-window-one-server`) also
  rewrite the notification requirements in `agent-status-and-sidebar`, and
  `one-window-one-server` removes and replaces them] → This change's MODIFIED
  blocks are written against the current main spec. Whichever change
  archives second rebases its deltas onto the other's result, carrying the
  bot clauses into the replacement requirements.

## Migration Plan

`acknowledgedSequence` defaults to the current `sequence` when it is missing,
so upgrading raises no notification for history. Rollback is safe: an older
server ignores the extra field in `messages.json`.

## Open Questions

None. The divergence from ADR-0061 (a bot owner, and the bot service as a
source) is recorded in ADR-0100, which supersedes ADR-0061 decisions 1, 2 and
8.
