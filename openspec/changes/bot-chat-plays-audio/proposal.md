## Why

When a user or a bot attaches a song, voice note or sound effect to a Chat message, it shows only as a download chip, so listening means saving the file and opening another app (issue #664). Chat already plays MP4 and WebM inline; audio deserves the same, in a compact form that fits a conversation.

## What Changes

- MP3, WAV, Ogg (Vorbis or Opus), FLAC and M4A content is recognised from its first 64 bytes and recorded as `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/flac` and `audio/mp4`, for user uploads and bot posts alike. Names and claimed types are still ignored.
- Chat renders an audio attachment as a compact inline mini player: a play/pause button, a seek bar and the elapsed and total time, plus a download button that saves the exact bytes through the host save flow. It never autoplays, and starting one clip pauses any other clip playing in Chat.
- Audio loads on demand through the authorized attachment operation, like video, and falls back to the plain download chip when it cannot be loaded or decoded.
- Audio keeps the existing limits: it is a non-image file, so 5 MiB and four per message, and it reaches an execution only as a file, never as model input.
- A text-free post whose attachments are all audio gets the notification excerpt "Sent an audio file".
- The `chat_post` description and the execution briefing say that audio plays inline.
- The workspace content security policy is unchanged: `media-src 'self' blob:` already admits blob audio.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: attachment typing recognises audio, Chat plays audio inline with a mini player and download, notification excerpts name audio, and bot-facing descriptions mention audio.

## Impact

- `packages/protocol/src/botMessages.ts`: audio detection, `BOT_AUDIO_MIMES`, `isBotAudioMime`.
- `packages/client-core/src/botMessages.ts`: accepts the audio types.
- `packages/server-core/src/botService/`: `messages.ts` (excerpt), `runtime.ts` (snapshot typing, tool description, briefing).
- `src/workspace/bots/`: `botsModel.ts` (`attachmentView`), `BotTranscript.tsx` (audio player, shared blob loader), `botPanels.css`.
- Tests: `packages/server-core/test/bot-attachments.test.mjs`, `src/workspace/bots/botsModel.test.ts`, `e2e/bots.spec.ts`.
- New ADR-0143 superseding ADR-0139, admitting server-typed audio to `<audio>`.
