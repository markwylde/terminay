## Why

Copying from a bot's desktop to the device works, but in the shipped app pasting from the device into the desktop does nothing. The viewer listened for the native `paste` event only on the desktop layer. Chromium raises that event at the page's current text selection. noVNC cancels `mousedown`, so clicking into the desktop never moves a selection the user left elsewhere in Terminay. The paste therefore lands outside the layer and nothing hears it. On macOS, Edit › Paste (Cmd+V) also needs an editable element to have focus, and noVNC's canvas is not editable.

## What Changes

- **The paste shortcut gets an editable target.** When the desktop sees the paste shortcut, it moves keyboard focus to a hidden, empty textarea inside the desktop. The native paste then targets that textarea, wherever the page's selection was. Focus returns to the desktop as soon as the paste is handled, or after one second if no paste arrives.
- **The paste is heard on the whole document.** The viewer handles `paste` at the document, but only when the desktop has just seen the shortcut or holds focus. A paste anywhere else in Terminay is left alone.
- **Modifiers stay consistent.** If the user releases a modifier while focus is on the textarea, the viewer releases it in the bot as well. Moving focus to the textarea does not count as leaving the desktop.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: in the Desktop requirement, device-to-bot paste works whatever else is selected in Terminay, and the desktop keeps keyboard focus.

## Impact

- `src/workspace/bots/desktopClipboard.ts`, `desktopClipboard.test.ts`, `BotDesktopView.tsx`, `botPanels.css`.
- No change to the server, relay, protocol or bot image.
