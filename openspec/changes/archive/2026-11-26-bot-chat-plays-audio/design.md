## Context

Chat already plays MP4 and WebM inline (change `bots-attach-videos-and-files`, ADR-0139). `botAttachmentType` in `@terminay/protocol` types attachment bytes from their first 64 bytes; anything it does not recognise is stored as `application/octet-stream` and shown as a download-only `FileChip`. `VideoPlayer` in `BotTranscript.tsx` loads bytes through the authorized attachment operation near the viewport, rechecks the server-derived type, and plays a `blob:` URL. The workspace policy already contains `media-src 'self' blob:`. ADR-0139 decision 2 admits only server-typed video to a media element, so audio needs a superseding ADR.

## Goals / Non-Goals

**Goals:** audio from users and bots plays inline in a compact player with play/pause, seek, time and a download button, under the existing limits and boundaries.

**Non-Goals:** waveforms, playback speed, playlists, background or cross-tab playback, AAC ADTS, WebM-audio or Matroska detection, raising any size limit, sending audio to the model, or changing the content security policy.

## Decisions

### 1. Audio is a recorded content type from a bounded content check

**Boundary: untrusted attachment bytes to the server's type record.** `botAttachmentType` gains an audio step after images and before the video check, within `BOT_ATTACHMENT_TYPE_BYTES` (64):

Each format needs its whole header inside the window; a header that is cut short or has a reserved field is opaque. A well-formed header followed by an undecodable payload is still typed as audio and is handled by the player's decode-failure path.

- `audio/mpeg`: a complete 10-byte ID3v2 header (`ID3`, major 2–4, minor not `0xFF`, no flag bit reserved by that major version, four syncsafe size bytes each `< 0x80`); or a complete 4-byte frame header with 11 sync bits, a version that is not reserved, layer III, bitrate index 1–14 and sample-rate index 0–2. Layer I/II are left opaque to keep false positives rare.
- `audio/wav`: 12 bytes: `RIFF` + 4 size bytes + `WAVE`.
- `audio/ogg`: a 27-byte `OggS` page header with version 0 and the beginning-of-stream flag, a segment table that fits in the window, and a first packet, also inside the window, whose length from the lacing values is at least 30 bytes for `\x01vorbis` or 19 bytes for `OpusHead`. Theora and other Ogg payloads stay opaque.
- `audio/flac`: all four bytes of `fLaC`.
- `audio/mp4`: an `ftyp` box passing the existing box checks with major brand `M4A `. Video brands are unchanged.

Alternative rejected: trusting the extension or claimed type, which the existing contract forbids. Alternative rejected: a media-probing library, which would add a dependency and read beyond the 64-byte window.

Audio is a non-image type, so `botAttachmentLimit` already gives it 5 MiB, and the composer, upload and `chat_post` paths need no new limit logic. `BOT_AUDIO_MIMES` and `isBotAudioMime` sit beside the video helpers; `client-core`'s `knownMime` accepts them so upload and attachment reads are not refused.

**Rollback.** As for video, execution snapshots (`triggerAttachments`) store audio as `application/octet-stream`, so the persisted session format and its validator do not change; the briefing takes the real type from the message record. Message records keep the audio type they were written with. An older server's attachment operation re-derives the response type from the bytes (opaque, to it), so the renderer's recheck refuses to play and the message shows a file chip; the stored metadata is not rewritten.

**History.** The renderer chooses a player from the recorded type, so attachments recorded as opaque before this change stay file chips and their bytes are not requested for playback. Re-typing stored records was rejected: it would rewrite durable message metadata for a cosmetic gain.

### 2. A shared on-demand blob loader

**Boundary: attachment operation to the workspace renderer.** The near-viewport load, far-and-paused release, abort on unmount and discard of late results move out of `VideoPlayer` into one hook, `useAttachmentMedia(load, id, kind)`, used by both players. The hook rechecks `attachmentView(serverMime) === kind` before creating the `blob:` URL with the server type, so a name or recorded type never selects a player. Only `<video>` or `<audio>` receives the URL. Duplicating the logic was rejected: two copies of a security-relevant recheck drift.

### 3. A compact custom player, not native controls

Chromium's native `<audio controls>` is a wide pill that ignores the theme and cannot sit beside a name and download button compactly. The `AudioPlayer` renders a hidden `<audio preload="metadata">` and its own controls: a card with a music icon, name and size on the first line and a download button on the right; a play/pause button, a range-input seek bar and `m:ss / m:ss` time on the second. Controls are native `<button>` and `<input type="range">` so keyboard and screen-reader support come from the platform; accessible names include the attachment name. No `autoplay`, `loop` or `muted`.

The download button reuses `FileChip`'s save path (`saveDownload`, ADR-0130) and stays usable while bytes load. If load or decode fails, the card is replaced by the ordinary `FileChip`, so the message never shows a broken player.

### 4. Player lifecycle

**One clip at a time, per workspace window.** A module-level registry in the renderer holds the one currently playing `<audio>` element. On `play`, a player pauses the registered element if it is another and registers itself; on `pause`, `ended` or unmount it clears the entry if it is itself. Scoping it to the window (not per Chat) is deliberate: two bots' Chats or the main stream and a thread panel never play over each other. Video is muted and not part of it.

**Only while shown.** A ResizeObserver on the player sees it collapse to no box when it is no longer displayed (Chat view switched, bot tab hidden, thread panel closed), wherever it is scrolled; a playing player pauses then. The near-viewport IntersectionObserver cannot be used for this: once a player is already outside its root, hiding it causes no intersection change. Unmounting pauses too, by dropping the element. Window visibility alone does not pause, matching ordinary media players.

**Controls state.** Total time shows `--:--` and the seek bar is disabled until `loadedmetadata` gives a finite duration. On `ended` the player returns to paused at `0:00`. A rejected `play()` promise leaves the player paused. A download error shows inline under the player.

### 5. Policy and ADR

No policy change: `media-src 'self' blob:` already covers audio. ADR-0143 supersedes ADR-0139, restating its decisions with decision 2 widened to server-typed audio for `<audio>`. **Boundary: workspace content security policy (ADR-0005, ADR-0011, ADR-0137).**

## Risks / Trade-offs

- [A bare MPEG frame-sync heuristic misclassifies random binary as MP3] → The header check needs layer III plus valid version, bitrate and sample rate; a false positive only produces a player that fails to decode and falls back to the download chip.
- [Electron's Chromium may lack a codec for some content, e.g. AAC in M4A] → Decode failure falls back to the file chip. The E2E fixture uses PCM WAV, which every build decodes.
- [Browser audio decoders now parse attachment content] → Same posture as video in ADR-0139: sandboxed renderer, blob URLs only, no added privilege.
- [Audio recorded as opaque before this change stays a download chip] → Accepted; see History above.
- [Up to four 5 MiB clips per message held in memory] → Bytes load only near the viewport and are released when far and paused.

## Migration Plan

No data migration. Existing attachments keep their recorded type (opaque) and stay file chips; new uploads and posts get audio types. Rollback is a plain revert: an older server returns audio bytes as opaque from the attachment operation, so they show as file chips; stored records are not rewritten.

## Open Questions

None. ADR-0139 is superseded by ADR-0143 rather than edited.
