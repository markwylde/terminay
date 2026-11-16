## Why

Pasting from a Mac into a bot's desktop in the Desktop app still does nothing, even after #625. Both fixes so far relied on Electron raising a native `paste` event for the paste shortcut on noVNC's canvas, which is not editable. That behaviour depends on the platform and on how Electron routes the key, and it fails on macOS. Terminay's terminals do not have this problem. Their Cmd+V cancels the key and reads the clipboard through Desktop's terminal paste bridge.

## What Changes

- **Desktop reads the clipboard through the terminal paste bridge.** In Desktop, the paste shortcut on a focused control-mode desktop is cancelled, as it is in a terminal. The text is read through the bridge, and only text is taken. It reaches the bot with the same chord and limits as before.
- **Browsers keep the native paste.** Browser hosts, which have no bridge, keep the native paste path.
- **The decision is recorded in ADR-0132,** which supersedes decision 2 of ADR-0129.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: in the Desktop requirement, Desktop reads paste text through the terminal paste bridge, and browsers use the native paste.

## Impact

- `src/workspace/bots/desktopClipboard.ts` and its test.
- `src/workspace/bots/BotDesktopView.tsx`, which uses `desktopClipboardUploadRoute` from `src/host/nativeActions.ts`.
- `openspec/adr/0132-…` and the ADR README.
- No change to the server, relay, preload or main process.
