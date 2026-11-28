## Why

Opening a bot thread focuses its "Reply in thread" composer, so on a phone the on-screen keyboard pops up and covers most of the thread the user opened to read ([#682](https://git.i.wylde.net/markwylde/terminay/issues/682)).

## What Changes

- Opening a thread no longer focuses the reply composer, by any route (hover action, message menu, reply bar). The user taps or tabs to the composer to reply.
- Keyboard focus moves to the thread panel itself on open, so desktop keyboard users keep Escape to close and Tab into the panel's controls.
- Explicit actions that put text in the composer, such as Quote, still focus it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: where focus goes when a thread opens.

## Impact

`src/workspace/bots/BotThreadPanel.tsx`, `src/workspace/bots/BotChat.tsx`, `src/workspace/bots/BotTranscript.tsx`, `src/workspace/bots/bots.css`, `e2e/bots.spec.ts`. No API, protocol or storage change.
