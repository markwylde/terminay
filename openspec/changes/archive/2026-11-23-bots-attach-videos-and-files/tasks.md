## 1. Attachment types and policy

- [x] 1.1 Add bounded MP4 and WebM detection, `BOT_ATTACHMENT_TYPE_BYTES`, `BOT_VIDEO_MIMES` and `isBotVideoMime` to `packages/protocol/src/botMessages.ts`. Verify: a test covers allowlisted brands, HEIC, AVIF, Matroska, truncated and malformed heads, and that a 64-byte head and the full content get the same type.
- [x] 1.2 Accept video types in `client-core` responses, and keep execution snapshots opaque for video with the briefing reading the real type from the message. Verify: tests read a video attachment, reload a session holding a video snapshot, and show the unchanged `sessions.ts` validator accepts it.
- [x] 1.3 Add `media-src 'self' blob:` to the workspace policy and its script copies, accepting earlier policies. Verify: `ui-bundle.test.mjs` asserts the exact policy, that both earlier policies map to it, and that any other policy is refused.
- [x] 1.4 Add ADR-0139 to the ADR index. Verify: the index row links to the file and `openspec validate --all` passes.

## 2. Bot attachments

- [x] 2.1 Add `readBotAttachment` with safe traversal, bounded read and specific refusals, leaving `readBotImage` image-only. Verify: tests cover MP4, a 3 MiB zip, a GIF over 2 MiB, a 6 MiB file, an empty file, final and intermediate symlinks, traversal, a directory, a pipe, a foreign or stopped container, growth during reading, cancellation and malformed reader output.
- [x] 2.2 Use it in `chat_post`, and update the tool description and briefing line. Verify: runtime tests post an MP4, assert the refusal text and briefing wording, prove a mixed valid and invalid post creates no message, and prove revocation during capture creates no message.
- [x] 2.3 Make the text-free notification excerpt name an image, video or file. Verify: `bot-notifications.test.mjs` covers each kind and a mixed post.
- [x] 2.4 Confirm video never becomes model image input. Verify: a test starts an execution from a message with an MP4 and asserts a file path and no image input.

## 3. Chat

- [x] 3.1 Extend `attachmentView` with `video`, and render bot and user attachments through one shared attachment list, including in threads. Verify: a unit test covers each view, and a text file named `clip.mp4` is a chip.
- [x] 3.2 Add the lazy inline player with kept download chip, far-viewport release, abort on unmount and failure fallback. Verify: tests cover no request before the viewport, release and reload, a late result discarded, a non-video response refused, and load or decode failure showing the chip.

## 4. End to end

- [x] 4.1 Extend `e2e/bots.spec.ts` with bot and user WebM messages, a video in a thread, an undecodable MP4 falling back to its chip, exact downloaded bytes, and a screenshot of the inline player. Verify: `npm run test:e2e` passes for the spec and the screenshot shows the player.
- [x] 4.2 Run the affected package tests and `openspec validate --all`. Verify: the tests pass, this change validates strictly, and the only `--all` failures are the eight unrelated changes that fail the same way on `main`.

## Review verification — 2026-11-23

- Fixed acceptance of truncated MP4 headers and malformed/truncated WebM header tails; added regression coverage while keeping detection bounded to 64 bytes.
- Reader output now rejects null/array headers, inconsistent oversize markers and type heads longer than 64 bytes with a controlled refusal.
- Added `scripts/bot-video.test.mjs` to `npm run test:bots-ui` for viewport loading, URL release/reload, cancellation, discarded late results, non-video responses, read failures and decode failures.
- Server Bots tests: 525 passed, 17 skipped. Final attachment, UI-bundle and client Bots checks: 42 passed. UI checks: 68 passed. Models: 26 passed. Shared builds, TypeScript and changed-file Biome checks passed.
- Docker full Bots E2E: 37 passed, 2 flaky (the existing trigger-session filter and image-composer tests timed out once and passed on retry). The video test passed in that run and separately after adding an explicit playback-progress assertion. Inspected its screenshot: the player and download chip are visible.
- This change passes `openspec validate bots-attach-videos-and-files --strict`. Repository-wide validation reports 125 passed / 8 failed; including archives reports 306 passed / 8 failed. A temporary copy of `main` reproduces the same eight failures: `add-terminay-bots`, `daemon-restart-keeps-terminals-usable`, `linked-folders`, `one-window-one-server`, `outbound-bot-triggers`, `phone-review-fixes`, `server-notification-manager`, and `unified-settings-window`. Task 4.2 records that exception, and the global validation claim in 1.4 is subject to it.
