## Why

To read further back in a bot's chat, you scroll to the top, press "Load older
messages" and wait, then do it again for every 25 messages (issue #655: "This
load older messages button is horrible"). The thread panel has the same
button, "Load older replies". Mainstream chat apps don't work this way: older
history arrives as you scroll up.

Each click can also throw the reader back to the bottom. If Chat was still
following new messages, it only stops following once the fetch completes.

## What Changes

- Chat and the thread panel load older history as the reader scrolls toward
  the top. The next page is requested while the oldest loaded message is still
  about one screen above the viewport, so in normal reading the reader never
  reaches the top and waits.
- The "Load older messages" and "Load older replies" buttons are removed.
- When older messages are prepended, the message the reader is looking at
  stays at the same place on screen.
- Each view has at most one older page in flight. After each page arrives, the
  view checks again, so a tall window or a short page fills without more
  scrolling.
- A quiet loading row ("Loading earlier messages…") shows at the top while a
  page loads. If a page fails, the same spot shows an inline error with Retry,
  and nothing retries until the reader chooses Retry.
- Once the oldest message is loaded, Chat shows a "Start of conversation"
  marker above it. A thread's start is its root, which the panel already shows.
- Loading older history never fights following new messages. A reader at the
  bottom stays at the bottom, and a reader who has scrolled up is not moved.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: adds how Chat and the thread panel load older history on
  scroll, keep the reading position, and mark the start of the conversation.
  It also modifies "Thread panel" so that scenario no longer names a button.

## Impact

- `src/workspace/bots/BotChat.tsx`, `src/workspace/bots/BotThreadPanel.tsx`,
  a new shared hook `src/workspace/bots/useOlderHistory.ts`, and
  `src/workspace/bots/botPanels.css`.
- Tests: `scripts/bots-ui.test.mjs` (browser components against the fake
  server in `scripts/bots-ui-harness.tsx`) and `e2e/bots.spec.ts`.
- The archived `bot-chat-threads` change put a "Thread panel" requirement
  into `bot-message-log`, and one of its scenarios names the "Load older
  replies" button. This change modifies that requirement so the scenario
  describes replies loaded by scrolling up.
- Renderer only. It reads the existing `bots.messages.list` cursor pages, with
  no protocol, server or privileged-host change.
