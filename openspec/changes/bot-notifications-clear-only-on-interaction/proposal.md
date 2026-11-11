## Why

A bot's reply is thrown away when its Chat happens to be on screen. Ask a bot
to do something, switch to a browser while it works, and its answer is
acknowledged the moment it lands because the bot's tab is still in front.
Nothing reaches the header, the Home counts, or the Dock badge, so the user
never hears that the bot answered. Agent terminals had the same problem and
now clear only when the user does something in them. Bots should behave the
same way.

## What Changes

- A bot's posts are acknowledged only by something the user does: bringing the
  bot's tab forward (clicking its tab, its sidebar row, a Home widget item, or
  its notification row), switching the tab to Chat, clicking or pressing a key
  inside the bot's Chat, sending the bot a message, or dismissing its
  notification (including **Clear all**).
- A bot's Chat being visible acknowledges nothing on its own: not when the
  window returns to the front, not when Home is brought in front of a project,
  not when the app restores the tab, and not when a post arrives while the
  Chat is showing. Such a post is published after the settle period unless the
  user acts first.
- Scrolling and moving the pointer are not acknowledgement.
- The device-local unread divider is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: what acknowledges bot posts, and the settle scenario that
  assumed a visible Chat reads a post.
- `workspace-dashboard`: the unread bot post counts clear on the same actions.

## Impact

- `src/workspace/bots/BotChat.tsx` — acknowledges on a user action instead of
  on visibility or arrival.
- `src/workspace/bots/BotTab.tsx`, `src/workspace/bots/botFocus.ts`,
  `src/workspace/HomeWorkspace.tsx` — report a deliberate open, a tab click,
  and pointer or key input in the bot's tab as interaction.
- Tests: the bot notification scenario in `e2e/bots.spec.ts`.
- No server, protocol, or MCP change. `bots.messages.acknowledge` is unchanged.
