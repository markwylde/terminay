## 1. Audio typing (protocol)

- [x] 1.1 Add `BOT_AUDIO_MIMES`, `isBotAudioMime` and the bounded audio check (MP3 via complete ID3v2 header or Layer III frame header, WAV, Ogg Vorbis/Opus, FLAC, M4A) to `botAttachmentType` in `packages/protocol/src/botMessages.ts`. Verify: tests in `packages/server-core/test/bot-attachments.test.mjs` for every positive case (ID3, bare frame, WAV, Ogg Vorbis, Ogg Opus, FLAC, M4A), every look-alike and every truncated header in the spec.
- [x] 1.2 Oversized audio keeps its type in the bot-post refusal. Verify: a test asserts the refusal of a 7 MiB FLAC names `audio/flac` and the 5 MiB limit.
- [x] 1.3 User upload records audio from content. Verify: a test uploads MP3 bytes named `song.dat` with a claimed `application/zip` type and the record is `audio/mpeg`.

## 2. Server and client plumbing

- [x] 2.1 Accept audio types in `knownMime` in `packages/client-core/src/botMessages.ts`. Verify: client-core tests (after `npx turbo run build --filter=@terminay/client-core...`) accept upload and attachment responses typed `audio/wav`.
- [x] 2.2 Store audio as opaque in execution snapshots (`triggerAttachments`) in `runtime.ts`, like video. Verify: a test dispatches a message with `song.mp3` and with MP3 bytes named `song.dat`; the session validates, container files use `.mp3` and `.dat`, the briefing lists `audio/mpeg`, and there is no image input.
- [x] 2.3 Add `BOT_AUDIO_ONLY_EXCERPT` ("Sent an audio file") in `messages.ts`. Verify: notification excerpt test for an audio-only post, and the mixed audio+image case still says "Sent a file".
- [x] 2.4 Mention audio in the `chat_post` description and the execution briefing in `runtime.ts`. Verify: description/briefing assertions updated and passing.

## 3. Chat renderer

- [x] 3.1 Extend `attachmentView` in `botsModel.ts` with `'audio'`. Verify: `botsModel.test.ts` covers audio, video, image and opaque types.
- [x] 3.2 Extract the on-demand blob loading from `VideoPlayer` into a shared hook that rechecks the server type for the requested kind and reports when the element stops being displayed. Verify: `scripts/bot-video.test.mjs` passes unchanged.
- [x] 3.3 Build `AudioPlayer` per the spec: name, size, download (available while loading, inline error on failure), play/pause, range seek, `m:ss / m:ss` time with `--:--` before metadata, end returns to `0:00`, refused `play()` stays paused, accessible names, no autoplay/loop/mute; falls back to `FileChip` on load, recheck or decode failure. Style it in `botPanels.css`. Verify: harness test (3.5).
- [x] 3.4 Window-wide one-clip registry and pause-when-not-displayed. Verify: harness test (3.5).
- [x] 3.5 Add `scripts/bot-audio-harness.tsx` and `scripts/bot-audio.test.mjs` covering: no request until near the viewport; far-and-paused release and reload; abort and no leaked URL on unmount; recheck refusal shows the chip; decode failure shows the chip; play/pause/seek/time and `--:--`; end state; rejected `play()`; keyboard operation and accessible names; download while loading and download failure; two players (incl. separate roots) never play together and the registry clears on unmount; hidden player pauses. Register it in the `test:bots-ui` script with `--test-force-exit --test-timeout=120000`. Verify: `npm run test:bots-ui` runs it and passes.
- [x] 3.6 Render audio attachments in `MessageFiles` with `AudioPlayer` (no separate chip while the player shows). Verify: harness test and E2E.

## 4. Spec, ADR and checks

- [x] 4.1 ADR-0143 recorded and referenced from `adr.md`. Verify: file exists; `git diff origin/main -- openspec/adr/0139*` is empty.
- [x] 4.2 Run lint, typecheck and the affected unit suites. Verify: all pass.
- [x] 4.3 Run `openspec validate --all`. Verify: this change and `bot-message-log` report no errors, and the set of failing items matches `origin/main` (no new failures).

## 5. End to end

- [x] 5.1 Extend `e2e/bots.spec.ts`: a bot posts a WAV and a user posts a WAV; the mini player plays, seeks, shows time, and the download saves exact bytes; a text file named `song.mp3` stays a chip. Capture screenshots of the idle and playing player. Verify: `npm run test:e2e -- e2e/bots.spec.ts` (Docker) passes.
