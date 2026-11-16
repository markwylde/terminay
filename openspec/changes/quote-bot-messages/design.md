## Context

`BotChat` (`src/workspace/bots/BotChat.tsx`) renders the shared message log through `BotTranscript`. User messages and bot text parts both call `onMessageMenu(key, text, x, y)` on `contextmenu`; `BotChat` ignores the text argument, looks the message up by key and opens the shared `ContextMenu` with Edit message and Delete message, using `message.text` for Edit. The menu does not use `ContextMenu`'s opt-in keyboard mode today. The composer is a controlled `<textarea>` whose value is the `draft` prop, changed through `onDraftChange`. A parallel change (#596) makes that textarea grow with its content, so this change must not depend on the textarea's height or rows.

Everything here is in the shared server-bundled workspace UI. A quote only edits the local draft; sending is the existing post path. No privilege, project/window or terminal-session boundary is crossed, and the renderer gains no new host or server capability.

## Goals / Non-Goals

**Goals:** Quote any message with text from its existing menu, by pointer or keyboard; append to, never rewrite, the draft; leave the caret ready for the reply; handle multi-line and long messages without breaking Markdown.

**Non-Goals:** structured reply metadata (a link from the new message to the quoted one), quote rendering in the user's own bubbles, composer sizing.

## Decisions

- **Quote is a context-menu item.** It is added first in the existing message menu so it sits with Edit and Delete. Alternative: a hover button on each message. Rejected; the issue asks for consistency with the existing actions and no other message has inline buttons.
- **The message menu uses `ContextMenu`'s keyboard mode.** It always passes `keyboard` (menu roles, arrow/Home/End movement) with `autoFocus` true only when the menu was opened from the keyboard, and `label="Message actions"`. A `contextmenu` event is keyboard-originated when its `button` is not 2 or its client coordinates are both 0 (context-menu key, Shift+F10), the same rule as the Files row menu; it then opens at the message element's bottom-left. After the menu unmounts, if focus is on `body` or a disconnected node, `BotChat` focuses the message element (by `data-terminay-message-key`), so Escape returns focus there; Quote moves focus to the composer and Edit to its dialog first, so neither is overridden.
- **A separate quote payload.** `onMessageMenu` gains a fifth argument, `selection: string | undefined`, captured before the menu takes focus: for a pointer-opened menu when the right button goes down (macOS selects the word under a right-click before `contextmenu` fires), and for a keyboard-opened menu in the `contextmenu` handler. It is the selection's text when the selection is non-collapsed and both its anchor and focus nodes are inside the message's body element; otherwise `undefined`. `BotChat` stores it as `menu.quote`, separate from `menu.text`, which stays `message.text` for Edit. The quote source is `menu.quote ?? message.text`.
- **Quote the Markdown source.** The whole-message quote uses the stored text, so code fences, lists and links survive. A selection is the rendered text the user chose.
- **Pure formatting in `src/workspace/bots/quoteMessage.ts`:**
  - `quoteMessage(text): string` — CRLF/CR to LF; remove leading and trailing blank (whitespace-only) lines; return `''` if nothing is left. Lines keep their own trailing spaces (they can be Markdown hard breaks). Apply the bound, prefix each line with `> ` (empty line → `>`), join with `\n`, and append `\n\n`.
  - Bound: `Array.from(text)` counts code points. Over 2,000, take the first 2,000 code points; if the last `\n` in that slice is at index ≥ 1,000, cut there. Track fences in the kept text (a line of three or more backticks or tildes opens one; it is closed only by the same character, at least as long, with nothing after it); if one is left open, append its marker at the opening line's indentation as a closing line, so a fence inside a list stays inside it. Then append an empty line and `…`, giving `>` and `> …` after prefixing.
  - `appendQuote(draft, quote): string` — `''` → quote; ends with `\n\n` → draft + quote; ends with `\n` → draft + `\n` + quote; else draft + `\n\n` + quote. The draft is never trimmed or rewritten.
- **Quote only when there is something to quote.** The menu shows Quote when `quoteMessage(source)` is non-empty.
- **Focus and caret after render.** `BotChat` keeps a ref to the textarea and a pending-caret flag. After `onDraftChange(appendQuote(draftRef.current, quote))`, a layout effect on `draft` focuses the textarea, sets the selection to the end and scrolls it to its end, then clears the flag. Pending files and send state are untouched.
- **Unit tests run in CI.** `src/workspace/bots/quoteMessage.test.ts` is added to the root `test:workspace-models` script, which already runs `node --test --test-force-exit --test-timeout=120000 --experimental-strip-types` over the other bots model tests.

## Risks / Trade-offs

- [The draft is lifted state; another change (#596) edits the same textarea] → This change only adds a `ref` and a layout effect; it does not touch sizing or rows. Expect a small merge in `BotChat.tsx`.
- [A selection quote uses rendered text, losing Markdown] → Acceptable: the user chose that text; the whole-message path keeps the source.
- [Bot text with image references quotes them as `![…](bot-attachment:…)`] → It is the message's real text; the bot can read it.
- [Keyboard mode now applies to the message menu for pointer use too] → It only adds roles and arrow movement; autofocus stays off for pointer opens, so pointer behaviour is unchanged.
