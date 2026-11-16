## 1. Protocol and client

- [x] 1.1 Add `fileBytes: 5 * 1024 * 1024` and `imageBytes` to `BOT_MESSAGE_UPLOAD_LIMITS` (keeping `bytes` as the image limit only if still referenced) and export the raster MIME list as `imageMimes`. Verify: `packages/protocol` type-checks.
- [x] 1.2 `BotMessagesClient.upload` and `attachment` accept `application/octet-stream` results up to 5 MiB as well as raster images up to 2 MiB. Verify: new cases in `packages/client-core/test/bots.test.mjs` for an opaque upload and attachment read, and a refusal of an unknown MIME.

## 2. Server storage

- [x] 2.1 Add shared `botAttachmentType(bytes)` in `packages/protocol/src/botMessages.ts`: sniffed raster MIME, else `application/octet-stream`. `putAttachment` uses it and bounds images to 2 MiB and other files to 5 MiB. Verify: `bot-messages.test.mjs` stores a zip with octet-stream type and exact bytes, and refuses a 2 MiB + 1 PNG and a 5 MiB + 1 opaque file without storing anything.
- [x] 2.1a `BotMessages.attachment()` reads any stored attachment within its per-kind bound and returns its stored type (sniffed again for images, `application/octet-stream` otherwise). Verify: `bot-messages.test.mjs` reads back exact bytes of an opaque file of 1 KiB and of 3 MiB, and an image as before.
- [x] 2.2 `BotService.uploadUserImage` becomes `uploadUserFile`, accepts any non-empty content within the per-kind limit, and `messageProtocol.ts`'s upload command and error texts say "file". Bot `chat_post` keeps requiring images. Verify: the protocol test uploads a zip claimed as `image/png` (stored as octet-stream), an empty body (refused), 5 MiB + 1 (refused) and to an unknown bot (refused).
- [x] 2.3 The session record validator accepts `application/octet-stream` trigger attachments. Verify: a sessions test round-trips a record whose trigger attachment is octet-stream.

## 3. Delivery to the execution

- [x] 3.1 `executionImagePath` becomes `executionAttachmentPath(executionId, index, mime, name)`: image extension from its type, otherwise the offered name's last extension if `[a-z0-9]{1,10}` after lower-casing, else `bin`. Verify: unit tests for `logs.zip`, `Report.PDF`, `notes.../../x y`, `archive.tar.gz`, `noext` and an image.
- [x] 3.2 `writeExecutionImages` writes every attachment with the per-kind byte bound; the Python writer's cap is 5 MiB. The briefing lists every attachment with name, type, size and path. Verify: the fake-driver unit test writes an image and a zip, checks file names and exact bytes passed as input, and the briefing test lists both.
- [x] 3.2a A copy failure fails the execution saying the files could not be copied and removes the execution's attachment directory, including files already copied; a queued zip whose attachment is cleared fails with "An attached file is no longer available; send it again." Verify: service tests with a fake driver failing the second write of an image+zip message (cleanup exec observed, agent not started), and the cleared-zip case.
- [x] 3.3 Native input gets images only: Claude Code content blocks and Codex `--image` skip non-image attachments, and the start failure text says "An attached file is no longer available; send it again." Verify: the `native.ts` / service tests check that a zip-plus-image message yields one image block / one `--image` argument.

## 4. Composer and history UI

- [x] 4.1 Replace `acceptChatImages` with `acceptChatFiles` in `botsModel.ts`: classify by magic bytes (`chatFileKind(head)`, shared rules with the server), raster → 2 MiB, others → 5 MiB, four maximum, first refusal reported; plus `formatFileSize`. Verify: `botsModel.test.ts` cases for a zip, a zip claiming `image/png`, a PNG with an empty type, an oversized image, an oversized file and a fifth file.
- [x] 4.2 `BotChat` removes the picker's `accept` filter, adds any dropped or pasted file, and renders non-image pending files as chips (file icon, name, size, remove) while images keep thumbnails. Labels say "Attach files" / "Files to send". Verify: e2e (5.1).
- [x] 4.3 `BotTranscript` renders a user message's non-image attachments as chip buttons that download via `saveDownload` from `BotMessagesClient.attachment`; only the four raster types reach the image renderer; a failed read or save shows an inline error on the chip. Images render as before. Verify: a unit test of the attachment-to-render-kind mapping (HTML/SVG/unknown types → chip), plus e2e (5.1).
- [x] 4.4 Style the file chips in `botPanels.css` to match the thumbnail strip in both themes. Verify: inspect the screenshots from 5.2.

## 5. Verification

- [x] 5.1 Extend `e2e/bots.spec.ts`: attach a zip with the button (chip shown), drop a PDF, attach a zip named `x.png` (chip, not thumbnail), send a message with an image and a zip (thumbnail and chip in history), activate the sent zip chip and check the saved bytes equal the original, refuse a file over 5 MiB. Verify: `npm run test:e2e -- e2e/bots.spec.ts` passes.
- [x] 5.2 Capture screenshots of the composer with an image thumbnail and a zip chip pending, and the sent message showing both. Verify: PNGs exist under the scratchpad `screenshots/` folder and each is opened and checked.
- [x] 5.3 Run `npm run lint`, `npm run typecheck:workspaces`, `npx tsc --noEmit`, the affected unit tests and `openspec validate --all`. Verify: all exit 0, or any failure is shown to pre-exist on main.
