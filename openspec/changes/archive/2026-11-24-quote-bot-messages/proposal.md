## Why

In a bot's Chat there is no way to point at an earlier message when replying. The user has to retype or copy and paste it by hand, and the bot then has to guess which message is meant (issue #597). Quoting a message, the user's own or the bot's, into the composer makes the reference explicit for both of them.

## What Changes

- Every chat message with text, from the user or the bot, offers **Quote** in its existing message context menu (right-click, or the context-menu key / Shift+F10 on a focused message), first, above Edit message and Delete message.
- Choosing Quote inserts the message as a Markdown blockquote into the composer: every line prefixed with `> ` (blank lines become `>`), followed by a blank line. The caret is placed after it and the composer is focused, ready to type the reply.
- The whole-message quote uses the message's Markdown source, so code blocks and lists survive; line endings are normalised and blank lines at the start and end dropped.
- The quote is appended to any existing draft, separated from it by a blank line; the existing draft text is never changed. Pending attachments are untouched.
- If the user has selected text inside that message when opening the menu, only the selection is quoted. Edit message still edits the whole message.
- A quote longer than 2,000 characters (code points) is cut at that bound, at the last line break in the second half when there is one, closes any code fence it cut open, and ends with a `> …` line, so a long reply does not swamp the composer.
- Messages with no text (attachments only) do not offer Quote.
- The message menu becomes keyboard operable: opened from the keyboard it appears at the message with its first item focused, arrows move between items, and Escape returns focus to the message.

Out of scope: composer height (issue #596), rendering quotes differently in user messages, and any server or protocol change — a quote is ordinary message text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: adds the requirements "Quote in the message menu", "Quote text" and "Quote into the composer".

## Impact

- `src/workspace/bots/BotChat.tsx`: the Quote menu item, inserting into the draft, focus and caret.
- `src/workspace/bots/BotTranscript.tsx`: pass the selected text (if inside the message) and a keyboard-aware menu position.
- `src/workspace/bots/quoteMessage.ts` (new): pure quote formatting; `quoteMessage.test.ts` added to `test:workspace-models`.
- `package.json`: the new unit test in `test:workspace-models`.
- `e2e/bots.spec.ts`: Quote coverage and screenshots.
- No server, protocol, or privilege change.
