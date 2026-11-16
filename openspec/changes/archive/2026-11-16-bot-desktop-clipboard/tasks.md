## 1. Relay

- [x] 1.1 In `packages/server-core/src/botService/rfb.ts`, add the ExtendedClipboard pseudo-encoding (-1063131698) to `relayedEncodings`, and update the comment that explains why it needs no reply the filter blocks. Verify with a `bot-rfb.test.mjs` case showing that `SetEncodings` keeps it.
- [x] 1.2 Make `BotRfbClientFilter` read the `ClientCutText` length as signed. An extended message must have a magnitude of at least 4 and at most `BOT_DESKTOP_CLIPBOARD_BYTES`. Forward it in control mode and discard it in view-only mode. Verify with `bot-rfb.test.mjs` cases: extended passed in control, dropped in view-only, rejected over 1 MiB, rejected under 4 bytes, and reassembled across every split point. The existing legacy cases must still pass.
- [x] 1.3 Before the tunnel of a control-mode stream, `BotDesktopService.open` runs `vncconfig -display :1 -set SendPrimary=0` and then `-get SendPrimary` as root. If the second does not print `off`, the open fails. View-only and thumbnail opens skip both commands. Verify with `bot-rfb.test.mjs` cases using a fake driver: the commands run in that order for control, they never run for view-only, and the open is rejected when `-get` prints `on`.

## 2. Bot desktop

- [x] 2.1 In `docker/terminay-bot/bin/terminay-init`, start Xvnc with `-SendPrimary=0 -MaxCutText=1048576`. Verify with a `bot-init.test.mjs` assertion on the Xvnc argv and with `python3 -m py_compile`.

## 3. Viewer

- [x] 3.1 Add `src/workspace/bots/desktopClipboard.ts` with pure helpers, and test them in `desktopClipboard.test.ts`, which is added to `test:workspace-models`. Verify with `node --test --test-force-exit --test-timeout=120000 --experimental-strip-types src/workspace/bots/desktopClipboard.test.ts`, which covers each helper:
  - `pasteShortcut(event, isMac)` returns the Linux chord for a host paste shortcut, or null. Tests cover every shortcut, non-paste keys, and the Cmd versus Ctrl difference on each platform.
  - `pasteChordKeys(chord, heldCodes, isMac)` returns the ordered `sendKey` sequence. Tests cover both Cmd keys, left and right Ctrl, Shift held, Shift+Insert, a repeated paste, and the re-press of released modifiers.
  - `pasteTextFits(text)` applies the CRLF and NUL 1 MiB bound. Tests cover multibyte text, newline expansion, and the exact boundary.
  - `clipboardTextForHost(text)` returns the text, or `undefined` for empty text, text over 1 MiB, or text with a disallowed control character. Tests also cover tab, LF and CR.
  - `mayWriteHostClipboard({ mode, focusedInside, documentFocused, visible })` is the gate. Tests cover every combination.
- [x] 3.2 Declare `sendKey`, `clipboardPasteFrom` and the `clipboard` event in `src/workspace/bots/novnc.d.ts`. Verify with the repo typecheck.
- [x] 3.3 Wire `BotDesktopCanvas` for a control-mode, non-thumbnail stream:
  - add a capture-phase key listener that tracks modifiers and diverts the paste shortcut;
  - add a `paste` handler that checks `pasteTextFits`, then calls `clipboardPasteFrom` and sends the `pasteChordKeys` sequence;
  - add a `clipboard` listener behind `mayWriteHostClipboard` and `clipboardTextForHost`, which calls `writeClipboardText`;
  - report an oversized paste to `BotDesktopView`, which shows "Too large to paste into the bot." in the bar.

  Remove all listeners when the layer retires. Verify with typecheck, Biome, and a fake-RFB controller test in `desktopClipboard.test.ts`. That test dispatches synthetic key, paste and clipboard events through a plain `EventTarget`, and asserts the calls made on the fake RFB and on the clipboard writer.

## 4. Real-protocol check

- [x] 4.1 Run a throwaway Debian trixie container with Xvnc 1.15, `tigervnc-tools` and `xclip`, started with this change's flags. Drive it with a Node RFB client through `BotRfbClientFilter('control')`. Check five things:
  - an extended Notify→Request→Provide of `café ✓` lands in CLIPBOARD (`xclip -o`);
  - `xclip -i -selection clipboard` produces a server cut message;
  - setting PRIMARY alone produces no server cut message once `SendPrimary=0`;
  - the runtime `vncconfig -set SendPrimary=0` works on an Xvnc started without the flag;
  - a legacy Latin-1 `ClientCutText` still works.

  Record the commands and output in `openspec/changes/bot-desktop-clipboard/verification.md`.

## 5. Specs and validation

- [x] 5.1 Run `openspec validate --all`. Fix every failure in this change. Note failures that already exist in other changes, unrelated to this one, in `verification.md`. Verify that this change validates clean.
- [x] 5.2 Run the affected suites and confirm they all pass:
  - the server-core `bot-rfb` and `bot-init` tests, after `npx turbo run build --filter=@terminay/server-core...`, with bounded `node --test --test-force-exit --test-timeout=120000`;
  - `desktopClipboard.test.ts`;
  - Biome;
  - typecheck.
