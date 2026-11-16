## 1. Protocol and client

- [ ] 1.1 Add `fileBytes: 5 * 1024 * 1024` and `imageBytes` to `BOT_MESSAGE_UPLOAD_LIMITS` (keeping `bytes` as the image limit only if still referenced) and export the raster MIME list as `imageMimes`. Verify: `packages/protocol` type-checks.
- [ ] 1.2 `BotMessagesClient.upload` and `attachment` accept `application/octet-stream` results up to 5 MiB as well as raster images up to 2 MiB. Verify: new cases in `packages/client-core/test/bots.test.mjs` for an opaque upload and attachment read, and a refusal of an unknown MIME.

## 2. Server storage

- [ ] 2.1 Add `botAttachmentType(bytes)` in `images.ts`: sniffed raster MIME, else `application/octet-stream`. `putAttachment` uses it and bounds images to 2 MiB and other files to 5 MiB. Verify: `bot-messages.test.mjs` stores a zip with octet-stream type and exact bytes, and refuses a 2 MiB + 1 PNG and a 5 MiB + 1 opaque file without storing anything.
- [ ] 2.2 `BotService.uploadUserImage` becomes `uploadUserFile`, accepts any non-empty content within the per-kind limit, and `messageProtocol.ts`'s upload command and error texts say "file". Bot `chat_post` keeps requiring images. Verify: the protocol test uploads a zip claimed as `image/png` (stored as octet-stream), an empty body (refused), 5 MiB + 1 (refused) and to an unknown bot (refused).
- [ ] 2.3 The session record validator accepts `application/octet-stream` trigger attachments. Verify: a sessions test round-trips a record whose trigger attachment is octet-stream.

## 3. Delivery to the execution

- [ ] 3.1 `executionImagePath` becomes `executionAttachmentPath(executionId, index, mime, name)`: image extension from its type, otherwise the offered name's last extension if `[a-z0-9]{1,10}` after lower-casing, else `bin`. Verify: unit tests for `logs.zip`, `Report.PDF`, `notes.../../x y`, `archive.tar.gz`, `noext` and an image.
- [ ] 3.2 `writeExecutionImages` writes every attachment with the per-kind byte bound; the Python writer's cap is 5 MiB. The briefing lists every attachment with name, type, size and path. Verify: the fake-driver unit test writes an image and a zip, checks file names and exact bytes passed as input, and the briefing test lists both.
- [ ] 3.3 Native input gets images only: Claude Code content blocks and Codex `--image` skip non-image attachments, and the start failure text says "An attached file is no longer available; send it again." Verify: the `native.ts` / service tests check that a zip-plus-image message yields one image block / one `--image` argument.

## 4. Composer and history UI

- [ ] 4.1 Replace `acceptChatImages` with `acceptChatFiles` in `botsModel.ts` (raster types → 2 MiB, others → 5 MiB, four maximum, first refusal reported) plus `formatFileSize`. Verify: `botsModel.test.ts` cases for a zip, an empty-type file, an oversized image, an oversized file and a fifth file.
- [ ] 4.2 `BotChat` removes the picker's `accept` filter, adds any dropped or pasted file, and renders non-image pending files as chips (file icon, name, size, remove) while images keep thumbnails. Labels say "Attach files" / "Files to send". Verify: e2e (5.1).
- [ ] 4.3 `BotTranscript` renders a user message's non-image attachments as chip buttons that download via `saveDownload` from `BotMessagesClient.attachment`. Images render as before. Verify: e2e (5.1).
- [ ] 4.4 Style the file chips in `bots.css` to match the thumbnail strip in both themes. Verify: inspect the screenshots from 5.2.

## 5. Verification

- [ ] 5.1 Extend `e2e/bots.spec.ts`: attach a zip with the button (chip shown), drop a PDF, send a message with an image and a zip (thumbnail and chip in history), refuse a file over 5 MiB. Verify: `npm run test:e2e -- e2e/bots.spec.ts` passes.
- [ ] 5.2 Capture screenshots of the composer with an image thumbnail and a zip chip pending, and the sent message showing both. Verify: PNGs exist under the scratchpad `screenshots/` folder and each is opened and checked.
- [ ] 5.3 Run `npm run lint`, `npm run typecheck`, the affected unit tests and `openspec validate --all`. Verify: all exit 0, or any failure is shown to pre-exist on main.
