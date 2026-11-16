# ADR-0132: Desktop pastes into a bot desktop through the terminal paste bridge

Status: accepted, supersedes 0129 in part (decision 2)
Date: 2026-11-16

## Context

ADR-0129 decision 2 lets host text reach a bot's desktop only through the browser's native `paste` event. The paste shortcut was left uncancelled so that the browser, or Electron's Edit › Paste menu, would raise that event.

Users of the macOS Desktop app could not paste into the bot. They tried twice: once with the event heard on the desktop layer, and once with it heard on the document after focus had moved to an editable catcher. Copying from the bot worked both times. The two shipped integrations behave differently. Whether, and where, Electron raises a native `paste` for a key on a canvas that is not editable depends on the platform, the menu accelerator and the page's selection. The Linux checks passed, and they did not predict macOS.

Desktop already has a narrow, user-gesture clipboard read for exactly this job. A terminal's paste shortcut cancels the key in the renderer and reads the clipboard in the main process through the preload bridge (`readTerminalClipboardForUpload`). It does not wait for a `paste` event. That route is what makes Cmd+V into a terminal work on macOS.

## Decision

1. **Desktop reads through the terminal paste bridge.** When the host offers that bridge, the paste shortcut on a focused, control-mode desktop is cancelled before noVNC sees it. The client then reads the clipboard through the bridge and takes only its text. Copied files and images are not sent. The text is sent to the bot with the same chord, limits and control-mode gate as ADR-0129.
2. **Browsers keep the native paste.** Where the bridge is absent, the native `paste` path from ADR-0129 is unchanged.
3. **No new capability.** The bridge, its IPC channel and its main-process read already exist for terminal paste. The bot desktop is a second caller of that bridge, reached the same way: a keydown of the user's paste shortcut on focused content in a Terminay window.

All other decisions of ADR-0129 stand.

## Rejected alternatives

- **Keep fixing the native paste path.** Two attempts each passed Linux checks and failed on macOS. The bridge does not depend on how Electron routes paste events.
- **`navigator.clipboard.readText()` in the renderer.** ADR-0005 denies ambient clipboard-read in Desktop.
- **`webContents.paste()` from the main process on Cmd+V.** It still depends on a `paste` event reaching the right element. It would also need main-process key routing for one renderer view.

## Consequences

- **Paste uses the terminal's route.** Cmd+V into a bot desktop behaves like Cmd+V into a terminal, on every Desktop platform.
- **Reads stay tied to the gesture.** Desktop reads the clipboard only when the user presses the paste shortcut on a focused control-mode desktop, as it already does for a focused terminal.
- **Edit › Paste from the menu still goes through the native event.** In Desktop that path is best effort.
