## Why

A bot that makes a video or animated GIF cannot show it to the user: `chat_post` refuses every MP4, even at 833 KB, and any GIF over 2 MiB, so the bot can only quote a container path the user cannot open. Users can already send bots any file up to 5 MiB, but the bot's path still reads attachments through an image-only reader with a misleading error.

## What Changes

- `chat_post` accepts any regular file under `/tmp` or `/home/bot`, with the user-upload rules: type from content, images up to 2 MiB, other files up to 5 MiB, four per message. Path, symlink, regular-file and container-ownership checks stay.
- Refusals name the file and state its size, type and the limit that applied. A GIF over 2 MiB stays refused, and its error suggests converting to MP4 or WebM.
- MP4 and WebM are recognised from their content and recorded as `video/mp4` and `video/webm`, for bot and user attachments alike.
- Chat plays video attachments inline (`controls loop muted playsinline`, no autoplay) with the download action kept. Other non-image files from bots show as file chips.
- Video is never sent to the model as image input.
- The workspace content security policy gains `media-src 'self' blob:`, which inline playback requires.
- A text-free post's notification excerpt names what was sent: an image, a video or a file.
- The `chat_post` description and runtime briefing state what bots can attach and the limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: bot posts carry any file type, attachment typing recognises video, Chat plays video inline, and notification excerpts name the attachment kind.

## Impact

- `packages/protocol/src/botMessages.ts`: video detection and type helpers.
- `packages/server-core/src/botService/`: `images.ts`, `runtime.ts`, `messages.ts`, `sessions.ts`.
- `packages/client-core/src/botMessages.ts`: accepts the video types.
- `packages/ui-bundle/src/manifest.ts`, `scripts/build-ui-bundle-manifest.mjs`, `scripts/server-ui-archive-benchmark.mjs`: workspace policy.
- `src/workspace/bots/`: transcript rendering and attachment view.
- Tests in `packages/server-core/test/` and `e2e/bots.spec.ts`.
- New ADR-0139 for the policy change.
