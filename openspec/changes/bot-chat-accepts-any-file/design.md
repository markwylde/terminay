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

`BOT_MESSAGE_UPLOAD_LIMITS` gains `fileBytes`. Every server path that holds attachment bytes uses the per-kind bound: `putAttachment`, `BotMessages.attachment()` (which today refuses anything over 2 MiB or not an image, and so would break downloads and execution start), the execution writer helper, and the client's `attachment()` result check. The container *reader* used by bot `chat_post` keeps the image-only 2 MiB rule.

*Alternative:* one 5 MiB limit for everything. Images over 2 MiB would then reach the model as native input that agents may reject. Rejected.

### 3. Every attachment is copied; only images go in natively

At start, the server copies every snapshotted attachment into `/tmp/terminay-attachments/<executionId>/` with the existing symlink-refusing, temp-then-rename helper. The file name is `<n>.<ext>`:

- Images use their sniffed type's extension, as before.
- Other files use the offered name's last extension when it matches `[a-z0-9]{1,10}` after lower-casing, otherwise `bin`.

The extension is the only part of the offered name that can reach the container path, and it cannot contain a separator or dot. Claude Code receives image content blocks for images only. Codex receives `--image` for images only. The briefing's `triggerMessage.attachments` lists every attachment with name, type, size and path, so the bot finds files the same way it finds images.

If any copy fails, the execution fails with the reason "The attached files could not be copied into the bot container." (ADR-0109: the failure is reported as a fact) and the directory is removed, including files already copied. Same-bot executions share a container and UID (ADR-0127), so "only the triggering execution" means only its briefing and prompt name the files; a sibling could still find them in `/tmp` while they exist. That is accepted, as for images.

*Alternative:* deliver non-images only as a path to the durable store. The store is on the server, not in the container, so the bot could not read it. Rejected.

**Boundary:** server-to-container. Bytes go only into the owning container through the `ownedResource` check, never to host paths, as before.

### 4. Composer and history

`acceptChatFiles` replaces `acceptChatImages`. It classifies each file by the same magic bytes the server uses, read from the first 12 bytes of the file, never by `File.type` or the name. So a zip named `x.png` or claiming `image/png` is a 5 MiB file shown as a chip, and a PNG with an empty type is a 2 MiB image shown as a thumbnail. The composer and the server therefore always agree on the kind and limit. It applies the matching size limit and the four-file limit, and reports the first refusal.

*Alternative:* trust `File.type` and let the server correct it. The composer would then show thumbnails for files the server stores as opaque, and refuse files the server would accept. Rejected. Pending images keep their thumbnail. Other pending files show a chip with a file icon, the name and the size, and the same remove control. Paste adds any clipboard file, and text paste is unchanged.

In history, `BotTranscript` renders image attachments as before and any other attachment as a chip button. Only the four raster types go to the image renderer; every other type, including any future or unexpected one, takes the chip path. Clicking a chip fetches the attachment and saves it through `saveDownload`, the host save from ADR-0130, so desktop and browser behave the same. A failed read or save shows an inline error on the chip.

*Alternative:* open text-like files in the file viewer. That puts untrusted bytes into a renderer path and is a separate feature. Rejected for this change.

## Risks / Trade-offs

- A 5 MiB cap is small for some archives → the error names the limit, and the Files tab handles large uploads.
- Opaque files fill the 64 MiB per-bot store faster → the existing storage-exceeded error stands; deleting messages frees space.
- An image whose content does not match its claimed type (for example a renamed `.png`) is stored as an opaque file → it shows as a chip rather than a broken thumbnail.
