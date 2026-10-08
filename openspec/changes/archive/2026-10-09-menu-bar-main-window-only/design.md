## Context

On Windows and Linux, Electron attaches whatever `Menu.setApplicationMenu()` was given to every `BrowserWindow`: windows that exist when it is called, and windows created afterwards. Terminay calls `createAppMenu()` at startup and again whenever settings change (`electron/main.ts`, the `createAppMenu(settings)` calls in the settings-change handlers). As a result, every native window ends up with the full menu bar:

- project-host workspace windows (`createWindow`, tracked in `appWindows`), which should have it;
- auxiliary settings, macros, recordings and edit windows (`createWindow` with `auxiliary`, tracked in `auxiliaryWindowsByPresentation`);
- terminal pop-outs opened through `setWindowOpenHandler` / `did-create-window`, which currently only get `autoHideMenuBar` on Windows;
- the frameless tab-drag ghost window, and the unused-in-production `createServerUiWindow` path.

Keyboard shortcuts do not depend on the menu. `bindAppShortcuts` runs on every `webContents` through `web-contents-created` and dispatches configured `AppCommand`s from `before-input-event`. The exception is the Edit menu's custom **Copy** item: its `CmdOrCtrl+Shift+C` accelerator (Windows and Linux) is what calls `sendCopyRequestToFocusedWindow`. The native roles (cut, paste, undo, redo, select all) are Chromium editing keys that work without a menu.

The in-force ADR-0018 (which supersedes ADR-0008) keeps the rule that Desktop presents its native application menu rather than the in-page menu. This change narrows which native windows carry that menu. It does not change which presentation is chosen.

## Goals / Non-Goals

**Goals:**
- Only project-host windows show the native menu bar on Windows and Linux.
- Secondary windows stay menu-less through menu rebuilds, and window types added in future are menu-less by default.
- Shortcuts, including terminal copy, behave the same in menu-less windows.

**Non-Goals:**
- macOS menu behaviour.
- The in-page browser menu bar and host capability negotiation.
- Changing which commands the menu offers, or adding a custom title-bar menu to secondary windows.

## Decisions

### 1. Default-deny menu policy, with project-host windows opted in

Add `electron/windowMenuPolicy.ts`, which owns the rule. It exposes:
- `applyWindowMenu(window, { isProjectHost, menu })`: `setMenu(menu)` for project-host windows and `removeMenu()` for all others; a no-op on macOS.
- `applyWindowMenus(windows, isProjectHost, menu)`: re-applies the rule to every open window.

Wiring:
- `app.on('browser-window-created')` calls `removeMenu()` on every new window on Windows and Linux. A window is menu-less from creation unless something opts it in.
- `createWindow` opts in only when `!isAuxiliary`, which is exactly the windows it adds to `appWindows`.
- `createAppMenu` keeps calling `Menu.setApplicationMenu(menu)`. macOS needs it, and it remains the menu project windows get. Straight after that call, on Windows and Linux, it runs `applyWindowMenus(BrowserWindow.getAllWindows(), w => appWindows.has(w), menu)` so a rebuild cannot put the bar back on a secondary window.

*Alternative: stop calling `setApplicationMenu` on Windows and Linux and call `setMenu` per project window.* Rejected. Electron still attaches the stale application menu to windows created later, and role menus on Windows and Linux assume an application menu exists. Removing the menu after the global call keeps one code path across platforms.

*Alternative: call `removeMenu()` at each creation site.* Rejected. It misses windows created later and is undone by every settings-driven `setApplicationMenu`. That rebuild is the part that is easy to miss.

*Alternative: `autoHideMenuBar`.* Rejected. The bar still appears when the user presses Alt, and Linux does not honour it today (`shouldAutoHideMenuBar` returns false there). `shouldAutoHideMenuBar` and the pop-out's `autoHideMenuBar` option become dead and are removed.

### 2. Terminal copy accelerator at the input layer for menu-less windows

Extend the existing `before-input-event` binding: on Windows and Linux, when the owning window is not a project-host window and the input is `Ctrl+Shift+C` keyDown, call `sendCopyRequestToFocusedWindow(window)` and `preventDefault()`. Project-host windows keep delivering copy through their menu accelerator, so copy is never dispatched twice.

This touches no security boundary. The handler runs in the privileged main process on input the window already receives, and sends the existing `terminal:copy-requested` event to that same window's `webContents`. Preload, sandbox, session partition and window-open policy (`securePrimaryWindow`) are unchanged.

## Risks / Trade-offs

- [Electron re-attaches a menu on some path not covered here, such as a future `setApplicationMenu` call] → The policy module is the single rule, `createAppMenu` is the only caller of `setApplicationMenu`, and the unit test asserts that a rebuild leaves non-project windows menu-less.
- [A secondary window loses some menu-only affordance] → The only menu-only accelerator was terminal copy, which Decision 2 covers. Every other command already dispatches through `before-input-event`.
- [It is hard to prove visually in CI because the E2E container is Linux under Xvfb without a native menu inspection API] → Cover the policy with a unit test using fake windows, and verify manually on Windows and Linux.

## Migration Plan

This is a presentation-only change and needs no data migration. To roll back, revert the commit.

## Open Questions

None.
