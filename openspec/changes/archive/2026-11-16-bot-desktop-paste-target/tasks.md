## 1. Viewer

- [x] 1.1 In `src/workspace/bots/desktopClipboard.ts`, listen for `paste` on the document in the capture phase. Handle it only when the desktop has just seen the shortcut, or while the desktop holds focus. Verify with two `desktopClipboard.test.ts` cases: a paste raised outside the layer reaches the bot, and a paste elsewhere while the desktop is unfocused is left alone.
- [x] 1.2 When the shortcut is pressed, focus a hidden textarea inside the layer. Return focus to the desktop after the paste, or after one second if no paste arrives. Keep the held modifiers while focus moves. If a modifier is lifted while the textarea has focus, release it in the bot. Verify with `desktopClipboard.test.ts` cases for the focus round trip, the timeout and the modifier release.
- [x] 1.3 In `BotDesktopView.tsx`, create the textarea for control-mode streams that are not thumbnails, and style it in `botPanels.css`. Verify with the repo typecheck and Biome.

## 2. Verification

- [x] 2.1 Run the real module in the e2e base image's Chromium, with a text selection left elsewhere on the page. The previous wiring sends nothing. The new wiring sends the text and Ctrl+V, and the desktop keeps focus. The run is recorded in `evidence/chromium-stale-selection-paste-check.mjs` and `verification.md`.
