## 1. Quote formatting

- [x] 1.1 Add `src/workspace/bots/quoteMessage.ts` with `quoteMessage(text)` and `appendQuote(draft, quote)` as in design.md. Verify: `src/workspace/bots/quoteMessage.test.ts` covers empty and whitespace-only text, single-line, multi-line with blank lines, CRLF and CR, leading/trailing blank lines, kept trailing spaces, nested `>` lines, a code fence and list, text of exactly 2,000 code points (no cut), a cut with a line break in the second half, a cut with none (hard cut), a non-BMP character at the cut, a cut inside a code fence (closed), and appending to empty, whitespace-only, plain, `\n`-ending and `\n\n`-ending drafts and two quotes in a row.
- [x] 1.2 Add the test to the root `test:workspace-models` script (keeping `--test-force-exit --test-timeout=120000`). Verify: `npm run test:workspace-models` runs it and passes; `grep quoteMessage.test package.json` shows it.

## 2. Chat UI

- [x] 2.1 In `BotTranscript.tsx`, extend `onMessageMenu` with the selection captured in the `contextmenu` handler (only when anchor and focus are inside that message's body) and, for a keyboard-originated event (button not 2, or client coordinates 0, 0), the message's bottom-left as the position plus a keyboard flag. Verify: e2e quotes a selection; e2e quotes a message while text in another message is selected and gets the whole message; e2e opens the menu with Shift+F10 and sees it below the message.
- [x] 2.2 In `BotChat.tsx`, store `quote` separately from `text` in menu state; render `ContextMenu` with `keyboard={{ autoFocus }}` and `label="Message actions"`; add Quote first when `quoteMessage(source)` is non-empty; on choose, `onDraftChange(appendQuote(draftRef.current, quote))` and focus the composer with the caret at the end in a layout effect; return focus to the message when the menu closes leaving focus on `body`. Verify: e2e quotes a bot message into an empty composer and a user message after a draft and asserts the exact draft, focus, caret at end, pending file still pending and no new message sent; e2e opens Edit message after a selection quote and sees the full text; e2e sees no Quote for an attachment-only message; e2e presses Shift+F10, Enter (Quote focused) and Escape on a reopened menu and sees focus back on the message.

## 3. End to end and checks

- [x] 3.1 Add the Quote test to `e2e/bots.spec.ts` covering 2.1 and 2.2 and capture screenshots of the open menu with Quote and the composer holding a quote. Verify: `npm run test:e2e` for the bots suite passes in Docker.
- [x] 3.2 Run the typecheck, Biome, `openspec validate quote-bot-messages` and `openspec validate --all`. Verify: all pass, except failures that already exist on `main` in other changes, which are listed as unrelated.
