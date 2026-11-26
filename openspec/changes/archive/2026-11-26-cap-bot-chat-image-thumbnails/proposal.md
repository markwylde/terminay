## Why

An image a bot posts in Bots chat can fill almost the whole message area (issue #670). The user has to scroll past one picture to read the conversation around it. Inline images are only capped at 70% of the window height today, not at the height of the chat they sit in, so a short chat pane or a tall image still leaves the image dominating the view.

## What Changes

- Inline image thumbnails in Bots transcripts are capped at 40% of the visible height (content box) of the transcript area they render in, rather than a share of the window height.
- Thumbnails keep their aspect ratio: never stretched or cropped. Width scales down with the height cap, and the existing cap at the container's width still applies.
- The cap follows the transcript area as it resizes: the window, a pane, or the composer growing with a long draft.
- The same cap applies everywhere a transcript shows inline images: Chat and a thread panel; user and bot messages; messages with several image attachments; and Markdown image previews from the bot's container. Session transcripts load no images today, so they are out of scope.
- Clicking a thumbnail behaves exactly as it does today. This change adds no click, preview or lightbox behaviour.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: adds a requirement that bounds the displayed size of inline transcript images.

## Impact

- Renderer only: `src/workspace/bots/bots.css` and `botPanels.css` (the `.bots-inline-image` rule, and `.bots-msgs` and `.bots-thread__body`, which become size query containers).
- No change to the server, the attachment protocol, image loading or the Electron/preload boundary.
- Tests: `e2e/bots.spec.ts` gains coverage for user and bot images, tall, wide and small images, window and pane resizing, and the thread panel, with screenshots. A unit test checks that attachment and container Markdown images share the bounded class.

Closes #670.
