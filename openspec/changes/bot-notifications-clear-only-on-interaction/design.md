## Context

`BotChat` acknowledges a bot's posts whenever its Chat is `here`: the bot tab
is visible in Home, Home is in front, and the document is not hidden. It does
so on mount, on becoming visible, and again on every new post. So a reply
that arrives while the tab sits in front, with the user in another
application, is acknowledged before its settle period ends and is never shown.

Terminals solved the same problem in `notifications-clear-only-on-interaction`:
an agent's terminal clears only when the user clicks its tab, clicks into it,
types, focuses it with a navigation command, or dismisses its notification.
Focus that lands on its own clears nothing.

The server side (`bots.messages.acknowledge`, the monotonic acknowledged
sequence, the settle period) is correct and stays as it is. Only the client's
reason for sending an acknowledgement changes.

## Goals / Non-Goals

**Goals:**

- A bot's posts are acknowledged only by a deliberate user action, matching
  agent terminals.
- An action that brings a bot's tab forward before its history has loaded
  still acknowledges once it loads.

**Non-Goals:**

- The device-local unread divider and read position. They keep their rules.
- Any server, protocol, push, or MCP change.
- Window focus tracking. A pointer or key press implies the window has focus.

## Decisions

### D1. Interaction is a counter the bot tab owns

`BotTab` keeps an interaction counter and passes it to `BotChat`. It
increments on:

- a bot focus request (`botFocus.ts`), which `HomeWorkspace.openBot` now sends
  on every open. Every caller of `openBot` is a user action: the sidebar row,
  a Bots section card, a Home widget item, a notification row. Restoring the
  remembered Home layout goes through `fromJSON`, not `openBot`, so it sends
  none.
- a pointer press on the bot's Home tab chip. `HomeTabChip` sends a bot focus
  request for a bot descriptor. The close button already stops propagation.
- a pointer press or key press captured anywhere inside the bot tab's root,
  which covers the Chat/Configure switch, the transcript, and the composer.

`BotChat` acknowledges through the latest loaded sequence when the counter
has moved past what it last handled, it is `here`, and its history has
loaded. It starts from zero, so a Chat mounted by a click on **Chat** sees the
click. A Chat mounted at startup sees nothing.

Alternatives considered: tracking `document.hasFocus()` with visibility. That
is still presence, not interaction, and it would clear a reply the moment the
user tabs back to the window, which is exactly what agent terminals refuse to
do. Listening for Dockview's active-panel change was also rejected because it
fires for restored layouts and programmatic activation alike.

### D2. Configure does not acknowledge

The counter moves on any press in the tab, but `BotChat` is not mounted in
Configure, so nothing is acknowledged there. Switching to Chat is itself a
press, so it acknowledges once Chat mounts.

### D3. Arrival no longer acknowledges

The effect that acknowledged each new post while `here` is removed. A post
that arrives while the user is reading waits for their next action, or is
published after the settle period. This matches an agent terminal finishing
while the user watches it.

## Boundaries

This change stays in the renderer. Acknowledgement still goes through
`bots.messages.acknowledge` behind bot authority (ADR-0100). The server stays
the only owner of notifications and their settle period (ADR-0061, ADR-0100).

## Risks / Trade-offs

- [A user reading a reply as it streams in gets a notification for it] → This
  is the intended trade, the same one agent terminals make. Any click or key
  press in the Chat within the settle period stops it from ever showing.
- [Scrolling to read does not clear] → Matches terminals, where wheel
  scrolling is not interaction. Clicking anywhere in the transcript does
  clear.
- [A bot focus request from a future non-user caller would acknowledge] →
  `botFocus.ts` documents that a request means the user asked for the bot.

## Open Questions

None.
