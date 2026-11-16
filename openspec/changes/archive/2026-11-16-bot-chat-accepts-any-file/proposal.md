## Why

A user tried to send a zip to a bot from the Bots chat and the composer refused it, because chat attachments accept only PNG, JPEG, GIF and WebP images (issue #594). Nothing about a bot needs that restriction: the bot runs in its own container and can unpack an archive, read a PDF or parse a log as easily as it can look at a screenshot. Only the thumbnail preview, and the agent's native image input, are specific to images.

## What Changes

- The composer accepts any file type through the attach button, drop and paste. The picker has no type filter.
- Raster images (PNG, JPEG, GIF, WebP, detected from their content) keep their behaviour: a thumbnail while pending, inline display in history, the 2 MiB limit and native model input for the triggering execution.
- Every other file shows as a chip with a file icon, its name and its size, both while pending and in chat history. Clicking a sent file's chip downloads it through the host save.
- Any non-image file up to 5 MiB can be uploaded. The four-per-message limit and the 64 MiB per-bot attachment storage bound stay.
- The server stores a non-image upload as opaque bytes with type `application/octet-stream`, whatever the client claims. It is never rendered, only downloaded.
- The execution started by the message receives every attachment as a file in its container. Images also keep their native input. The briefing lists each file's name, type, size and container path. A non-image's container file name is the server's position number plus a sanitised extension taken from the offered name, so the bot can tell a `.zip` from a `.pdf`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: user message attachments accept any file type; non-image attachments are stored opaquely, shown as file chips, downloaded on demand and delivered to the triggered execution as container files.

## Impact

- `packages/protocol/src/botMessages.ts`: upload limits name a file limit alongside the image limit.
- `packages/client-core/src/botMessages.ts`: `upload` and `attachment` accept non-image results.
- `packages/server-core/src/botService/images.ts`, `messages.ts`, `service.ts`, `messageProtocol.ts`, `sessions.ts`, `runtime.ts`: type detection with an opaque fallback, per-type size limits, container copies for every attachment, native image input for images only.
- `src/workspace/bots/BotChat.tsx`, `BotTranscript.tsx`, `botsModel.ts`, `bots.css`: unrestricted picker, file chips while pending and in history, download on click.
- Tests: server-core and client-core unit tests, `botsModel` unit tests and Bots chat e2e coverage with screenshots.
