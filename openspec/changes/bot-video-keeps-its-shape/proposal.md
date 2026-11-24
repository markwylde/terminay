## Why

Chat's inline video player is locked to a 16:9 frame, and the video inside it
renders at its full height. Any video taller than 16:9 loses its bottom: a
nearly square 2x2 comic strip showed only its top two panels.

## What Changes

- The player frame takes the video's own aspect ratio once its metadata loads.
- The whole picture is always visible, at most the message width and 70% of the
  window height.
- The frame keeps that shape while a paused, far-away video releases its bytes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: inline video players show the whole video at its own shape.

## Impact

- `src/workspace/bots/BotTranscript.tsx`, `src/workspace/bots/botPanels.css`.
- E2E: the inline video case in `e2e/bots.spec.ts` gains a tall video.
- No server, protocol, or privileged-host change.
