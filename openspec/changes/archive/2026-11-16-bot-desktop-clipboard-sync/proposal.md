## Why

Copying text on the Mac leaves Paste disabled in the bot's browser context menu. The current implementation uploads text only when the Mac paste shortcut is pressed; the user requires the clipboards to stay synchronized so the bot's own paste actions work.

## What Changes

- Synchronize clipboard text in both directions while a connected bot desktop is open in control mode, including when the user copies in another Mac application.
- Seed the bot clipboard from the host when sharing starts. Subsequent changes propagate without pressing a paste shortcut and without synthesizing a paste key.
- Give the most recently selected control desktop exclusive ownership of this device's clipboard sharing, across windows. Stop sharing when that desktop closes, disconnects, is hidden by another view, or becomes view-only.
- Suppress echoes, serialize asynchronous updates, and prevent work from a retired sharing session from changing either clipboard.
- Keep text bounds, Unicode, PRIMARY isolation, and view-only enforcement. Leave files and images outside this change.
- Add a narrow Electron host clipboard subscription; do not grant ambient browser clipboard permission. Browser clients retain native paste where continuous clipboard monitoring is unavailable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: Desktop clipboard sharing occurs independently of a paste shortcut and supports the bot's own context-menu and keyboard paste actions.
- `connections-and-client-hosts`: A bound Desktop document can participate in a lifecycle-owned, text-only clipboard sharing session.

## Impact

Electron host binding/preload and clipboard service; protocol host capabilities/actions/events if used by the chosen bridge; renderer host helpers, BotDesktopView, desktopClipboard; focused lifecycle/concurrency tests and real macOS/Xvnc verification. Supersede the clipboard-sharing restrictions of ADR-0129 and ADR-0132 with a new ADR; preserve their accepted files. A 500 ms main-process clipboard monitor is proposed only if a usable background event source cannot be established, and requires the owner's specific approval under ADR-0028 before implementation.
