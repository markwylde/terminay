## Why

On Windows and Linux, the Settings window shows the full File / Terminal / Edit / View / Window / Help menu bar, and so does every other secondary window. That bar belongs to the project workspace. In a settings, macros, recordings or edit window it wastes vertical space, looks broken, and offers commands that act on some other window.

The cause is Electron's default: `Menu.setApplicationMenu()` attaches the application menu to every `BrowserWindow` on Windows and Linux. Terminay also calls it again whenever settings change, which puts the menu back on any window that had it removed.

## What Changes

- On Windows and Linux, only project-host (main workspace) windows carry the native application menu bar.
- Every other Desktop window has no menu bar, including when the menu is rebuilt after a settings or shortcut change. That covers auxiliary settings, macros, recordings and edit-tab windows, terminal pop-outs opened through `window.open`, the tab-drag ghost window, and any window created later. Menu-less is the default, so a new window type is covered without extra code.
- Configured application shortcuts keep working in menu-less windows, because they are already dispatched through `before-input-event`. The terminal copy accelerator (`Ctrl+Shift+C`) is currently delivered only by the Edit menu, so it gets the same input-level path in menu-less windows.
- macOS is unchanged. It has one global menu bar and no per-window menus.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: adds a requirement that on Windows and Linux only project-host windows show the native menu bar, while secondary windows show none and keep their keyboard shortcuts.

## Impact

- `electron/main.ts`: `createAppMenu` (re-applies the menu), `createWindow` (project-host and auxiliary windows), the `window.open` pop-out handler, the tab ghost window, and the app-level `browser-window-created` / `web-contents-created` hooks.
- A new small Electron module for the per-window menu policy, plus a `node --test` unit test.
- No renderer, protocol, server or settings-schema changes. No security boundary moves: windows keep the same preload, sandbox and session settings.
