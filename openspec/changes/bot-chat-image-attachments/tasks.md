## 1. Protocol and client

- [x] 1.1 Add `upload: 'bots.messages.upload'` to `BOT_MESSAGE_OPERATIONS` in `packages/protocol/src/botMessages.ts`, and add a `BotMessageUpload` result type (`token`, `attachment`). Verify: `packages/protocol` type-checks.
- [x] 1.2 Add `BotMessagesClient.upload(botId, name, bytes)` (commandWithBody, validates the returned shape) and an optional `uploads` token list on `post`. Verify: new cases in `packages/client-core/test/bots.test.mjs` pass.

## 2. Server staging and post

- [x] 2.1 In `BotMessages`, add a per-bot staging map `token → {blob, name, expiresAt}` (15 minutes), with `stage()` (wrapping `putAttachment`) and `consume()`. Expiry is lazy: entries are dropped on upload, post, prune or load. `pruneAttachments` keeps blobs referenced by live tokens. Clear and bot deletion empty the map. Verify: `bot-messages.test.mjs` covers staging, lazy expiry with an injected clock, prune keeping live tokens, clear discarding staging, and the quota counting staged blobs.
- [x] 2.2 Register the `bots.messages.upload` command in `messageProtocol.ts`. It enforces bot authority, a body of at most 2 MiB, a content-sniffed type and a redacted name. Verify: a test uploads a PNG (accepted), plain text (refused), 2 MiB + 1 byte (refused) and to an unknown bot (refused), with nothing stored on refusal.
- [x] 2.3 Extend `bots.messages.post` and `BotService.postUserMessage` with `uploads` (≤ 4, distinct). Inside `serialize`, run the idempotency replay first, then validate every token, then persist, then consume. Allow empty text when tokens are present. Verify: tests for the success path, a foreign, expired or duplicate token refusing the post while other tokens stay usable, more than four refused, a retry after success returning the same message with one execution, identical bytes under two names giving two attachments, and a failed persist leaving tokens usable.

## 3. Delivery to the execution

- [x] 3.1 Snapshot the trigger message's attachment metadata on the session origin at dispatch. At start, read the blobs, and if one is missing fail the execution with "An attached image is no longer available; send it again." Verify: a test in which clearing the chat while the execution is queued causes that explicit failure, with the posted message preserved until the clear.
- [x] 3.2 Copy the images into `/tmp/terminay-attachments/<executionId>/<n>.<ext>` with a Python helper (O_NOFOLLOW/dir_fd traversal, temporary file plus `os.replace`, user `bot`, owned-container check, deadline and size bounds). Remove the directory when the execution ends. Verify: a unit test with a fake driver checks the exec command, user, container, file names that never contain the offered name, and the cleanup exec on completion, failure and stop.
- [x] 3.3 Add `attachments: [{name, mime, size, path}]` to the briefing's `triggerMessage` for that execution only. Verify: a briefing test shows paths for the triggering execution and metadata only for a schedule execution.
- [x] 3.4 Claude Code: send the first user turn as text plus base64 image content blocks. Verify: a `native.ts` unit test checks the stream-json message shape and that the diagnostic transcript omits the image data.
- [x] 3.5 Codex: `nativeArguments` accepts image paths and emits `--image <path>` before `-`. Thread the paths through `BotAgentProcess`. Verify: a `nativeArguments` unit test checks argument order with zero, one and four images.

## 4. Composer UI

- [x] 4.1 Add pending-image state, a paperclip attach button with a hidden image file input, a drop handler on the composer and a paste handler on the textarea that leaves text paste alone. Verify: e2e (5.1).
- [x] 4.2 Add a pure validation helper (type, 2 MiB, four maximum) in `botsModel.ts`, and render removable thumbnails whose object URLs are revoked on remove and unmount. Enable Send for image-only messages. Verify: `botsModel.test.ts` cases for each rule, plus e2e (5.1).
- [x] 4.3 On send, upload images that have no token yet, then post with `uploads` and a per-attempt key that is kept until the outcome is known. Clear on success. On failure, keep the draft and images, dropping tokens only on an invalid-token refusal. Verify: e2e (5.1) for failure retention, plus a unit test of the retry key and token reuse logic.
- [x] 4.4 Style the attach button and thumbnail strip in `bots.css` to match the composer. Verify: inspect the screenshots from 5.2 visually.

## 5. Verification

- [x] 5.1 Extend `e2e/bots.spec.ts` to cover these cases. Verify: `npm run test:e2e -- e2e/bots.spec.ts` passes.
  - attach with the button
  - paste and drop
  - remove a thumbnail
  - a fifth image refused
  - a non-image and an oversized image refused
  - an image-only send shown inline in the user message
  - a failed send keeping the draft and images
- [x] 5.2 Capture screenshots of the composer with pending thumbnails, the inline refusal message, and the sent image inline. Verify: the PNG files exist under the scratchpad `screenshots/` folder, and each is opened and checked visually.
- [x] 5.3 Smoke-test manually against the pinned Codex and Claude Code CLIs. Send one PNG, JPEG, GIF and WebP image, then a four-image message, confirm that each bot describes the images, and record the result in `openspec/adr/evidence/bot-chat-image-attachments-smoke.md`. Verify: the evidence file names CLI versions and outcomes, or states which runs were not possible and why.
- [x] 5.4 Run `npm run lint`, `npm run typecheck`, the unit tests and `openspec validate bot-chat-image-attachments --type change`. Verify: all exit 0. `openspec validate --all` already had 4 failures in other changes (linked-folders, one-window-one-server, outbound-bot-triggers, server-notification-manager), and none may be added.
