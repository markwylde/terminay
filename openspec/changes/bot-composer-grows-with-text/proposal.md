## Why

The message box in a bot's chat is about two lines tall and never grows
(issue #596: "it's too thin"). A multi-line message, a pasted log, or a few
Shift+Enter paragraphs scroll inside a two-line slot, so the user can't see
what they're about to send.

## What Changes

- The bot chat composer starts three lines tall.
- It grows with its text — typing, wrapping, pasting, Shift+Enter, and a draft
  restored when the tab is reopened — up to twelve lines or 40% of the window
  height, whichever is smaller. Past that the text scrolls inside the box.
- It shrinks back as text is removed, and returns to three lines once a
  message is sent or the draft is cleared.
- It re-fits when the tab's width changes and the text re-wraps, and the
  maximum follows the window height. Three lines always wins over the maximum.
- Enter still sends (not during IME composition); Shift+Enter still adds a
  line; a failed post keeps its text at the height it needs. The resize handle
  stays hidden.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminay-bots`: the bot chat composer sizes itself to its text between a
  minimum and a maximum height.

## Impact

- `src/workspace/bots/BotChat.tsx`, `src/workspace/bots/botPanels.css`.
- E2E: `e2e/bots.spec.ts` gains a composer sizing case.
- No server, protocol, or privileged-host change. Another change (issue #597,
  quoting a message into the composer) edits the same component; text it
  inserts is sized by the same rule.
