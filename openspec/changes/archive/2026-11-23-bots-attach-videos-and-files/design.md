## Context

`chat_post` reads each attachment through `readBotImage`, which runs a Python reader inside the bot container as the `bot` user. The reader walks the path with `O_NOFOLLOW`, accepts regular files only, and caps them at 2 MiB. The store (`putAttachment`) already types bytes with `botAttachmentType` and applies the 2 MiB and 5 MiB limits. The same image reader also serves `BotIoProtocol.image`, which must stay image-only.

The workspace policy has no `media-src`, so media falls back to `default-src 'self'` and a `blob:` video is blocked.

## Goals / Non-Goals

**Goals:** bots post any regular file under the user-upload rules, errors state the real limit, MP4 and WebM play inline, and video never becomes model image input.

**Non-Goals:** transcoding, poster generation, streaming or range requests, raising any size limit, or rendering any other file type.

## Decisions

### 1. A separate attachment reader; the image reader is unchanged

Add `readBotAttachment` beside `readBotImage`. **Boundary: bot container to server.** The file's bytes, size and name are untrusted. The reader keeps the same traversal, `O_NOFOLLOW`, `O_NONBLOCK`, regular-file check and owned-running-container check, and runs as `bot`.

It writes one JSON header line, then base64 content. For a file over 5 MiB it sends the size and first 64 bytes only, so the server can report size and type without transferring the file. It reads at most limit + 1 bytes, so a file growing during the read is still bounded. The exec output cap covers the header plus base64 of 5 MiB. Malformed reader output is a refusal, never a partial attachment. Size, type and limit are reported only for a file the reader safely opened; path, symlink, missing-file and container failures report only their cause.

Alternative rejected: widening `readBotImage`, which would let the UI's image operation return arbitrary files.

### 2. Video is a recorded content type

`botAttachmentType` returns `video/mp4` for an `ftyp` box with an allowlisted video major brand (`isom`, `iso2`-`iso6`, `mp41`, `mp42`, `avc1`, `M4V `), and `video/webm` for an EBML header whose DocType is `webm`. HEIC, AVIF, Matroska and other containers stay opaque.

Detection reads at most the first 64 bytes (`BOT_ATTACHMENT_TYPE_BYTES`), and the reader sends exactly those bytes for an oversized file, so accepted and refused content get the same type. The WebM check walks the EBML header's child elements within that window and returns opaque on any truncated or malformed element. Recognition does not prove a playable track; the player's decode-failure path handles that.

The type must be on the record so a client can choose a player without downloading every opaque file. Attachments stored earlier keep their recorded type and stay file chips. The attachment read re-derives the type from content, as it does today, and the renderer accepts either.

**Rollback.** Execution snapshots (`triggerAttachments`) keep storing a video as `application/octet-stream`, so the persisted session format and its validator do not change and an older server still loads them. The briefing takes the real type from the message record. An older server reads message records without checking their type, re-derives opaque for video content, and shows a file chip.

### 3. A GIF over 2 MiB stays refused

GIFs are images and are sent to the model, so the 2 MiB rule applies. Storing large ones as opaque would make one format's type depend on its size. The error points the bot at MP4 or WebM, which play inline at up to 5 MiB.

### 4. Inline playback from a blob URL

**Boundary: untrusted attachment bytes to the workspace renderer.** The transcript fetches bytes through the existing attachment operation, rechecks that the server-derived type is a video type, and creates a `blob:` URL with that type. The name and recorded type never choose the renderer. Only `<video>` receives the URL.

Loading starts when the player nears the viewport, so history does not download every video. A paused player more than two viewports away revokes its URL and reloads on return, which bounds retained memory while scrolling. Unmounting aborts any request and revokes the URL, and a late result is discarded. If loading or decoding fails, the message keeps its download chip and shows no broken player.

### 5. The policy adds only `media-src 'self' blob:`

**Boundary: workspace content security policy (ADR-0005, ADR-0011, ADR-0137).** No remote media origin is admitted. Earlier manifest policies are accepted and emitted as the current one, following the existing pattern. Desktop verifies only its own packaged bundle, so a newer server cannot break an older Desktop's manifest check. Recorded in ADR-0139.

## Risks / Trade-offs

- A malformed video reaches the browser's media decoder → Only allowlisted containers from blob URLs are played, inside the sandboxed renderer with no added privilege.
- Chromium builds without H.264 cannot play some MP4s → The failure falls back to the download chip. The E2E fixture uses WebM for this reason.
- Up to 20 MiB of base64 per post crosses the exec channel → Files are read one at a time under the existing deadline, abort signal and 64 MiB per-bot storage bound.
