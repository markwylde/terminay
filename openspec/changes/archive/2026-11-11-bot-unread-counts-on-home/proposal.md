## Why

A bot's unread posts are counted in only one place: the header Notifications control, where a bot counts once however many posts it has. From a project, nothing on the Home control says a bot has written. In Home, nothing on the Bots item or on a bot's sidebar row says which bot has unread posts or how many.

## What Changes

- The Home control on the project bar shows a small count of unread bot posts, and its accessible name says the count.
- The Bots item in the Home sidebar shows the same count, as the Workflows item shows workflows that need you.
- Each bot's row in the Home sidebar shows how many unread posts that bot has.
- The counts are the post counts of the bot notifications the server already publishes for the Notifications list, so they follow its settle period and cover the bots of the window's server. Bots on other attached servers show no count.
- They clear when any client shows the bot's Chat, when the user messages the bot, or when its notification is dismissed. Chat's device-local unread divider is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-dashboard`: adds the unread bot post counts on the Home control, the Bots sidebar item, and each bot's sidebar row.

## Impact

- `src/workspace/publishedNotifications.ts`: `botUnreadCounts` and `botUnreadLabel`, read from the published notification snapshot.
- `src/App.tsx`, `src/App.css`: the count on the Home control and the Bots section badge.
- `src/workspace/bots/BotsSidebarList.tsx`, `src/workspace/homeView.css`: the count on each bot's row.
- No server, protocol, or MCP change.
- Tests: `scripts/published-notifications.test.mjs` and the bot notification scenario in `e2e/bots.spec.ts`.
