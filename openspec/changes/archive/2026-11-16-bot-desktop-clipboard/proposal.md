## Why

A user controlling a bot's desktop cannot move text between it and their own machine. Text copied in the bot's browser or terminal never reaches the host clipboard. Pasting on the desktop pastes whatever the bot last copied, not what the user just copied on their own machine. Users retype URLs, commands and error messages by hand (issue #543).

Most of the pieces exist already. The bot's Xvnc owns the X clipboard and sends its changes, and noVNC decodes them, but the viewer never hands them to the host. Nothing ever sends the host clipboard to the bot. The relay also strips noVNC's extended-clipboard encoding, so even a wired-up exchange would fall back to Latin-1 and turn curly quotes, most accents and emoji into `?`.

## What Changes

- **Copy from the bot.** In Control mode, a change to the bot's clipboard is written to the host clipboard through the host's existing clipboard-write route: the Desktop bridge's `clipboard.write`, or the browser Clipboard API. This happens only while the desktop holds keyboard focus in a focused, visible window. Text over 1 MiB, empty text, and text with control characters other than tab, LF and CR are not written.
- **Paste into the bot.** In Control mode, the host's paste shortcut on the focused desktop pastes the host clipboard into the focused bot application. The shortcut is Ctrl+V, Ctrl+Shift+V or Shift+Insert, or Cmd+V and Cmd+Shift+V on macOS. The viewer takes the text from the native paste event that the shortcut raises and sends it to the bot's clipboard. It then presses the matching Linux chord in the bot (Ctrl+V, Ctrl+Shift+V or Shift+Insert), built explicitly from the host modifiers it tracks. A paste with no text, or with text over the bot's 1 MiB limit, sends nothing, and the viewer says why.
- **View-only and the thumbnail never share.** A view-only stream neither reads nor writes either clipboard. The server already discards client clipboard messages in view-only mode.
- **Unicode.** The relay forwards noVNC's extended-clipboard pseudo-encoding and its UTF-8 `ClientCutText` messages, with the payload still bounded at 1 MiB. Text keeps characters outside Latin-1 when viewer and server are both current. Otherwise it falls back to Latin-1.
- **Selections do not leak.** The bot's Xvnc does not send its PRIMARY selection, so highlighting text in the bot does not replace the user's clipboard. New containers start Xvnc this way. The server also applies it to an already running Xvnc whenever it opens a control-mode stream, so containers created before this change are covered too. New containers also accept 1 MiB of incoming clipboard text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: the Desktop requirement gains two-way clipboard sharing in control mode only, gated on the user's focus, through the host's paste shortcut and semantic clipboard write. Its allowlist admits UTF-8 extended-clipboard messages within the same 1 MiB bound.

## Impact

- `src/workspace/bots/BotDesktopView.tsx`, new `src/workspace/bots/desktopClipboard.ts` (+ test), `src/workspace/bots/novnc.d.ts`: viewer clipboard wiring, paste-chord handling, limits.
- `packages/server-core/src/botService/rfb.ts`: ExtendedClipboard pseudo-encoding and the extended `ClientCutText` form. It also runs `vncconfig -set SendPrimary=0` before it opens a control-mode stream.
- `docker/terminay-bot/bin/terminay-init`: Xvnc gains `-SendPrimary=0 -MaxCutText=1048576`.
- Tests: `packages/server-core/test/bot-rfb.test.mjs`, `bot-init.test.mjs`, the new renderer unit test, and a recorded protocol check against real Xvnc 1.15.
- There are no protocol schema, bridge, IPC or permission changes. No host capability is added, and nothing reads the clipboard programmatically.
