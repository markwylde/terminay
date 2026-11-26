## 1. Styles

- [x] 1.1 Make `.bots-msgs` and `.bots-thread__body` size query containers (`container-type: size; container-name: bots-transcript`). Do not touch `.bots-sdetail`. Verify: the E2E test in 2.x asserts both keep a non-zero height and scroll, and the screenshots show an unchanged layout.
- [x] 1.2 Change `.bots-inline-image` to `max-height: 40cqh`, keeping `max-width: 100%`, `width: auto`, `height: auto` and `object-fit: contain`. Verify: the E2E bounds checks in 2.x pass.

## 2. Tests

- [x] 2.1 Unit test (`src/workspace/bots/botMarkdown.test.ts`): `renderBotMarkdown` renders both a `bot-attachment:` image and a container `/tmp/` image with a loaded blob URL as `<img class="bots-inline-image">`. Verify: the test passes under the project's unit test runner.
- [x] 2.2 E2E (`e2e/bots.spec.ts`): a user sends one message with a tall image (300x1800), a wide image (2400x300) and a small image (120x80). For each, assert in Chat: height ≤ 40% of the transcript's content height (`clientHeight` minus vertical padding) + 1px; width ≤ content width + 1px; displayed ratio within 2% of natural ratio; the small image at its natural size. Assert the transcript has a non-zero height and scrolls (`scrollHeight > clientHeight`, and setting `scrollTop` moves it). Verify: passes under `npm run test:e2e`.
- [x] 2.3 E2E: a bot posts a tall PNG through the `post-file:` fixture. Assert the same bound on the bot message image. Verify: passes.
- [x] 2.4 E2E: shorten the window, then re-assert the bound against the new content height. Restore the window and re-assert. With the window size fixed, fill the composer with a multi-line draft, confirm the transcript got shorter, and re-assert. Take screenshots of the default, short-window and grown-composer states. Verify: passes and screenshots are saved.
- [x] 2.5 E2E: open the image message's thread panel and assert the bound against `.bots-thread__body`, plus a non-zero height. Verify: passes.

## 3. Checks

- [x] 3.1 Run `npx biome check` on the changed files. Run `openspec validate cap-bot-chat-image-thumbnails`, and `openspec validate --all` compared with the main-branch baseline. Verify: biome is clean, the change is valid, and there are no failures beyond the baseline.
