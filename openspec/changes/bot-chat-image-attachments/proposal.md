## Why

The Bots chat only accepts text, so the user cannot show a bot an image such as a screenshot of a bug, a design mock or an error dialog. Bots can already post images back, but nothing goes the other way. The server stores message images durably and Codex and Claude both accept image input, so the missing pieces are a composer, an upload path and image delivery to the execution.

## What Changes

- The Bots chat composer gains an attach button (paperclip) that opens a file picker limited to PNG, JPEG, GIF and WebP.
- Images can also be dropped onto the composer or pasted into it from the clipboard.
- Pending images show as removable thumbnails above the composer before sending. A message may be images only, text only, or both, with at most four images of up to 2 MiB each. These are the limits the message log already applies.
- New `bots.messages.upload` command: the client sends each image's bytes on its own, and the server checks the type from its magic bytes, applies the size and storage limits, stages the image in the bot's server-owned attachment storage, and returns an upload token. `bots.messages.post` gains an optional `uploads` list of tokens. The tokens are consumed atomically and retry-safely, and they turn the staged images into durable attachments on the user message.
- User messages with attachments render their images inline in chat history. This uses the same rendering as bot-posted images.
- The execution started by that message receives its images as model input. Claude Code gets image content blocks in its stream-json user message. For Codex, the images are written into the bot container and passed with `--image`. The briefing also lists each image's name and its path in the container, so the bot can work with the file.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: user messages can carry raster attachments uploaded from the client; executions triggered by such a message receive those images as model input; the communication UI offers attach, drop and paste with removable pending thumbnails.

## Impact

- `packages/protocol/src/botMessages.ts`: new `upload` operation, `uploads` tokens on post.
- `packages/client-core/src/botMessages.ts`: `upload()` and post with upload tokens.
- `packages/server-core/src/botService/messageProtocol.ts`, `messages.ts`, `service.ts`: upload staging, post validation and pruning that keeps staged images.
- `packages/server-core/src/botService/native.ts`, `agentProcess.ts`, `runtime.ts`: image delivery to Claude Code and Codex, plus the briefing that lists the images.
- `src/workspace/bots/BotChat.tsx`, `bots.css`: composer attach button, drop, paste and thumbnails.
- Tests: server-core and client-core unit tests, plus Bots chat e2e coverage.
