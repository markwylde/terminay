## Context

A terminal handles its paste shortcut in `TerminalPanel.tsx` through `shouldHandleTerminalPasteShortcut`. In Desktop it calls `preventDefault` on the keydown and reads the clipboard in the main process through the preload bridge (`readTerminalClipboardForUpload`, exposed to the renderer as `desktopClipboardUploadRoute`). It never waits for a `paste` event. Searches confirm this is the usual Electron fix. Renderer paste events and `execCommand('paste')` are unreliable in Electron, and integrations read the clipboard over IPC instead, as Hermes Desktop does for its noVNC screen.

The bot desktop instead relied on Electron raising a native `paste`, first on the layer and then, through a focused catcher, on the document. Both failed on macOS.

## Goals / Non-Goals

**Goals:**
- Cmd+V and Ctrl+V into a focused control-mode bot desktop paste host text in Desktop on every platform, by the route that already works for terminals.

**Non-Goals:**
- Changing the browser path.
- Changing limits, the chord, or bot-to-host copying.
- Adding a host capability.

## Decisions

- **Optional `readHostText` in `DesktopClipboardEnvironment`.**
  - When it is set, the keydown capture listener cancels the shortcut (`preventDefault` and `stopPropagation`) and marks the key as diverted, so its keyup does not reach noVNC.
  - It then reads the text and sends it with the same `send` routine as the native path: size check, `clipboardPasteFrom`, then the chord.
  - Auto-repeat keydowns do not read again.
- **The chord uses the modifiers held when the text arrives.** The read is asynchronous. A modifier released in the meantime has already been released in the bot through noVNC, so the chord neither releases it nor presses it again.
- **Text only.** `BotDesktopView` maps the bridge's result to text and ignores the `files`, `folder` and `image` kinds. Local paths and file bytes never go to the bot.
- **Native path kept.** It remains for browsers, and for Edit › Paste chosen from the menu while the desktop has focus.

## Risks / Trade-offs

- **A failed or empty read sends nothing and gives no feedback.** This matches a terminal's paste.
- **The bridge also snapshots copied file paths.** It does this when the clipboard holds files, under a token the bot desktop never uses. The snapshot is replaced on the next read, as it is for terminals.
