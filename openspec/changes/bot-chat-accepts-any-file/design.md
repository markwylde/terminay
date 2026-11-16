## Context

`bot-chat-image-attachments` added user uploads to the bot message log: `bots.messages.upload` stages one body, `bots.messages.post` consumes up to four tokens, and the triggering execution receives the images natively (Claude Code content blocks, Codex `--image`) plus container copies under `/tmp/terminay-attachments/<executionId>/`. Every layer checks for the four raster types: `botImageMime` in `BotMessages.putAttachment` and `BotService.uploadUserImage`, the session record validator, `executionImagePath`, the client's `attachment()` result check, the composer's `acceptChatImages` and the picker's `accept` filter.

The smallest protocol profile allows a body of just under 8 MiB per frame, and an attachment is both uploaded and read back in one frame.

## Goals / Non-Goals

**Goals:**
- Accept any file type in the composer and on the server.
- Keep image thumbnails and native image input exactly as they are.
- Deliver non-image files intact to the triggering execution's container.

**Non-Goals:**
- Chunked uploads or files larger than 5 MiB. The bot's Files tab already uploads large files into the bot home.
- Letting bots post non-image files from `chat_post`. Bot posts stay images.
- Previewing non-image files (PDF, text) in chat.

## Decisions

### 1. Content decides "image"; everything else is opaque

`botAttachmentType(bytes)` returns the sniffed raster MIME when the magic bytes match PNG, JPEG, GIF or WebP, and `application/octet-stream` otherwise. The client's claimed type and the file name never decide the stored type.

An opaque attachment is never rendered by the client. It is only offered as a download, so an HTML or SVG file cannot run in the workspace origin.

*Alternative:* derive a MIME from the extension for nicer icons. That would let a name pick a type that some later renderer trusts. Rejected; the client may choose an icon from the display name, which affects nothing else.

**Boundary:** client-to-server. The renderer stays untrusted; the server still bounds size before writing, redacts the offered name and checks bot authority.

### 2. Two size limits, one per kind

Raster images stay at 2 MiB, because they are sent to the model as native input. Any other file may be up to 5 MiB, which leaves room under the smallest frame limit for the upload and the attachment read. An image over 2 MiB is refused with the image message; it is not silently downgraded to a file, so the user is never told a bot saw an image it did not. The per-message count (4) and per-bot storage bound (64 MiB, staged uploads included) are unchanged.

`BOT_MESSAGE_UPLOAD_LIMITS` gains `fileBytes`, and the container reader and writer helpers use the larger bound for their byte caps.

### 3. Every attachment is copied; only images go in natively

At start, the server copies every snapshotted attachment into `/tmp/terminay-attachments/<executionId>/` with the existing symlink-refusing, temp-then-rename helper. The file name is `<n>.<ext>`:

- Images use their sniffed type's extension, as before.
- Other files use the offered name's last extension when it matches `[a-z0-9]{1,10}` after lower-casing, otherwise `bin`.

The extension is the only part of the offered name that can reach the container path, and it cannot contain a separator or dot. Claude Code receives image content blocks for images only. Codex receives `--image` for images only. The briefing's `triggerMessage.attachments` lists every attachment with name, type, size and path, so the bot finds files the same way it finds images.

**Boundary:** server-to-container. Bytes go only into the owning container through the `ownedResource` check, never to host paths, as before.

### 4. Composer and history

`acceptChatFiles` replaces `acceptChatImages`. It treats a file as an image when its type is one of the four raster types (the server re-checks), applies the matching size limit and the four-file limit, and reports the first refusal. Pending images keep their thumbnail. Other pending files show a chip with a file icon, the name and the size, and the same remove control. Paste adds any clipboard file, and text paste is unchanged.

In history, `BotTranscript` renders image attachments as before and any other attachment as a chip button. Clicking it fetches the attachment and saves it through `saveDownload`, the host save from ADR-0130, so desktop and browser behave the same.

## Risks / Trade-offs

- A 5 MiB cap is small for some archives → the error names the limit, and the Files tab handles large uploads.
- Opaque files fill the 64 MiB per-bot store faster → the existing storage-exceeded error stands; deleting messages frees space.
- An image whose content does not match its claimed type (for example a renamed `.png`) is stored as an opaque file → it shows as a chip rather than a broken thumbnail.
