## Why

When a bot posts a message, nothing tells the user. The header Notifications
list stays empty, the count badge doesn't move, and the Dock badge stays where
it was. The only sign is an unread divider inside that bot's Chat, and the user
only sees it if they think to open the bot. A bot running on a schedule, or one
that answers twenty minutes after it was asked, can post a result nobody reads.

The technical cause is that a notification can only belong to a terminal. The
server's notification manager holds records owned by one terminal (ADR-0061).
Bots are workspace-wide and never belong to a project, so a bot post has
nowhere to go.

## What Changes

- **A bot post raises a notification.** When a bot posts to its message log,
  the server holds one notification for that bot. It shows in the header
  Notifications list and count, and on the Desktop application icon badge.
  Further posts update the same notification, so a bot never has more than one.
  User posts never raise one.
- **It follows the existing notification rules.** The notification goes through
  the same settle period, so one acknowledged within a few seconds is never
  shown. It appears in the attention group, newest first, and can be dismissed
  singly or with **Clear all**. Dismissing it on one client clears it on every
  client.
- **It reads as a bot message.** The row shows the bot's avatar and name, how
  many unread posts there are, an excerpt of the latest post, and how long ago
  it was posted. Activating the row opens that bot's tab in Chat and closes the
  list.
- **Viewing the bot clears it.** The notification is acknowledged when any
  client shows that bot's Chat in a visible window, when the user sends the bot
  a message, or when it is dismissed. It also goes when its posts are removed,
  the chat is cleared, or the bot is deleted.
- **Acknowledgement persists.** The server stores, per bot, how far its posts
  have been acknowledged. A bot's notification therefore comes back after a
  server restart if it was never acknowledged, and stays gone if it was.
- **Only clients with bot authority see it.** A bot notification is visible
  only to clients that hold bot authority on that server. It is never visible
  to a project-scoped client, never returned or dismissed through the MCP
  notification tools, and never sent as a push banner.
- The per-device unread divider in Chat is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: adds the requirement that a bot post raises one
  server-held notification for its bot, together with its acknowledgement,
  persistence, settle, and authority rules.
- `agent-status-and-sidebar`: the header Notifications count, list, and
  dismissal include bot notifications, describe how a bot row reads and what
  activating it does, and keep the **Show indicator** settings scoped to
  terminal rows.
- `mcp-server`: the notification tools cover terminal notifications only.
  `list_notifications` never returns a bot notification, and
  `dismiss_notification` cannot resolve one.

## Impact

- `packages/server-core/src/notifications/`: notification records and events
  gain a bot owner, a `bot-message` kind, and an unread count. The protocol
  projector withholds bot records from clients without bot authority.
  Dismissing a bot record calls back into the bot service.
- `packages/server-core/src/botService/`: the message store persists an
  acknowledged-through sequence per bot. A new feed keeps one notification per
  bot in line with posts, edits, removals, clears, and deletions. A new
  `bots.messages.acknowledge` operation sits behind bot authority.
- `packages/protocol`, `packages/client-core`: wire types for bot notification
  records, plus the acknowledge operation on the bot messages client.
- `src/workspace/publishedNotifications.ts`, `src/App.tsx`,
  `src/workspace/bots/BotChat.tsx`: bot rows in the list and count, opening the
  bot tab from a row, and acknowledging while Chat is visible.
- `apps/terminay-server/src/mcp/notificationAdapter.ts`: excludes bot records
  from the MCP notification tools.
- `packages/server-core/src/push/sender.ts`: bot records never leave the
  server.
- New ADR superseding ADR-0061: a notification belongs to one terminal or one
  bot.
- Tests: notification manager and protocol unit tests, bot message store tests,
  MCP adapter tests, and an e2e scenario in `e2e/bots.spec.ts`.
