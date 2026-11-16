## Context

The bot message log (ADR-0093) already supports durable raster attachments, but only for bot posts. `chat_post` reads images out of the container, `BotMessages.putAttachment` stores them content-addressed under the bot's server-owned `attachments/` directory (2 MiB each, 64 MiB per bot, at most four per message), and `bots.messages.attachment` serves them. `BotChat` turns each attachment into a `bot-attachment:<id>` image that `BotTranscript` renders. User messages always arrive with `attachments: []`.

The native drivers (ADR-0096) build their CLI arguments at launch in `nativeArguments`. Claude Code reads a stream-json `user` message whose `content` is currently a plain string. Codex reads the prompt from stdin after `codex exec … -` and supports `--image <FILE>` for the initial prompt. The first prompt of an execution is assembled in `BotService` from the bot context and `runtime.briefing(id)`.

The protocol body limit is just under 8 MiB per frame (`limits.ts`), so four 2 MiB images cannot travel in one post.

## Goals / Non-Goals

**Goals:**
- Attach images in Bots chat with a button, by dropping them, and by pasting them, with removable pending thumbnails.
- Store user images in the same durable, bounded server storage as bot images and render them inline.
- Make the triggered execution actually see the images, not just a path.

**Non-Goals:**
- Attaching non-image files, or raising the 2 MiB/4-image/64 MiB bounds.
- Adding attachments when editing a message. Edit stays text-only and keeps the existing attachments.
- Giving later executions image bytes. They get metadata and can use the container copy if it still exists.
- Changing app-window attachments (ADR-0046).

## Decisions

### 1. Upload each image, then post IDs

New command `bots.messages.upload` (`commandWithBody`, payload `{ botId, name }`, body = image bytes ≤ 2 MiB) returns `{ token, attachment: { name, mime, size } }`. The token is 24 random hex characters, so it is separate from the content-addressed blob ID and identical bytes with two names stay two attachments. `bots.messages.post` accepts an optional `uploads: string[]` of tokens (≤ 4, distinct). The idempotency hash covers the tokens.

The post runs in three steps:

1. The idempotency lookup runs first, so a retried post returns the original message even after its tokens have been consumed.
2. Every token is validated: it must be known, unexpired, bound to this bot and not repeated. Any failure refuses the whole post.
3. The row is saved, and only then are the tokens removed from staging.

All three steps run inside the bot's existing `serialize` section, so two concurrent posts cannot both consume the same token. The client keeps one idempotency key per send attempt, along with the tokens it has already obtained, until the post succeeds or is definitively refused. A retry after a lost response therefore replays rather than duplicates.

*Alternative:* one post carrying every image in its body. That would exceed the frame limit with four 2 MiB images and turn post retries into large re-uploads. Rejected.

**Boundary:** client-to-server. The renderer is untrusted. The server sniffs the type with `botImageMime` and ignores the client's MIME. It bounds the size before writing, redacts the offered name and treats it as display text only. The bot ID is checked through `assertBotAuthority`, the same as other message operations.

### 2. Staging is a server-side record, not a new directory

`putAttachment` already writes content-addressed files into `attachments/`. An upload reuses it and records `token → { blob attachment, offered name, expiresAt }` in an in-memory per-bot staging map with a 15-minute expiry. `pruneAttachments` keeps blobs referenced by valid tokens.

Expiry is lazy, as the spec states. Expired entries are dropped, and their blobs pruned, on the bot's next upload, post, prune or message-store load. Load happens after a restart, which loses the in-memory map, so the orphaned blobs are pruned then. No timer runs, consistent with ADR-0028. `clearMessages` and bot deletion empty the bot's staging map before their existing directory removal. The 64 MiB bound counts staged blobs because they sit in the same directory.

*Alternative:* a separate `staged/` directory with a rename on post. It means more file-system moves and two size accounts for no gain. Rejected.

### 3. Images go to the triggered execution in native form

At dispatch, the session records the trigger message's attachment metadata (`origin.attachments`). This snapshot is what the execution delivers. When the execution starts, the server reads each snapshotted blob from durable storage. If one is gone, for example because the chat was cleared while the execution was queued, the execution fails with "An attached image is no longer available; send it again." It never runs without the image. The message stays as posted.

- **Container copy:** a bounded exec, run as user `bot` in the owning container only, uses a Python helper modelled on `readBotImage`. It creates `/tmp/terminay-attachments/<executionId>/` with `O_NOFOLLOW`/`dir_fd` traversal, writes each image to `<n>.<ext>` via a temporary file plus `os.replace`, and refuses existing symlinks. The path never contains the offered name. The briefing's `triggerMessage` gains `attachments: [{ name, mime, size, path }]`. When the execution ends (completed, failed, stopped or replaced), a best-effort exec removes the directory. Copies are bounded by four images per execution and the execution concurrency limit. Same-bot executions share a UID, so this protects integrity against accidents, not isolation between siblings.
- **Claude Code:** the first `user` stream-json message becomes `content: [{type:'text', text}, ...{type:'image', source:{type:'base64', media_type, data}}]`. Four 2 MiB images, base64-encoded, fit under the 16 MiB native frame limit. The diagnostic transcript already omits large `data` fields.
- **Codex:** `nativeArguments` takes an optional `images: string[]` of container paths and emits `--image <path>` for each, before `-`.

*Alternative:* only write files and tell the agent the paths. The model then has to choose to open them, and Codex cannot view an image without native input. Rejected as the only mechanism, but kept alongside native input so the bot can also use the files, for example to commit them.

**Boundary:** server-to-container. Bytes go only into the bot's own container through the existing owned-resource check (`ownedResource`), never to host paths. The agent receives only images from the message that triggered it.

### 4. Composer UI is local state in `BotChat`

`BotChat` holds `pending: { key, file, url }[]` (object URLs, revoked on remove and unmount). The attach button is a hidden `<input type=file accept="image/png,image/jpeg,image/gif,image/webp" multiple>`. `onDrop`/`onDragOver` on the composer form and `onPaste` on the textarea take `image/*` items and leave text paste alone. The client checks the type and size up front for an immediate inline message, and the server checks again. On send, the client uploads any pending image that has no token yet, one at a time, then posts with `uploads` and the attempt's idempotency key. Tokens and the key are kept on each pending item and attempt until the post succeeds or is definitively refused. A refusal for an invalid token drops the tokens so the next send re-uploads, and that send uses a new key. On failure, pending images and draft text are kept. The renderer goes only through the preload/server transport, with no file-system access.

## Risks / Trade-offs

- [The server restarts between upload and post, so the tokens are unknown] → The post is refused as an invalid upload. The client drops the tokens, keeps the pending images, and re-uploads them with a new key on the next send.
- [Fake-agent tests cannot prove that the real CLIs see images] → Unit tests pin the argument and stream-json shapes. A manual smoke run against the pinned Codex and Claude Code CLIs, sending one image of each format and a four-image message, is recorded as evidence before archive.
- [Clipboard images arrive as `image.png` with no name] → Generate `pasted-<n>.png`. The name is only displayed.
- [A Codex CLI version without `--image`] → The pinned CLI supports it (checked with `codex exec --help`). A conformance unit test covers the argument shape.
- [Large base64 payloads in Claude's stdin] → Bounded by the four-image and 2 MiB limits, and under the 16 MiB native frame limit.
- [The container is not running when copying] → The execution start already requires the container. A failed copy fails the dispatch with the existing actionable error.

## Migration Plan

Additive. Old clients never send `attachmentIds`. Existing messages and stored attachments are unchanged. Rollback removes the feature, and stored user attachments stay readable as ordinary attachments.

## Open Questions

None. The in-force ADR-0093 (durable attachments) and ADR-0096 (native drivers, container-only execution) already cover this. It extends them without revisiting either.
