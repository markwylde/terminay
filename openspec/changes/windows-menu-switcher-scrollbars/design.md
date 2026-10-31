## Context

On Windows, Desktop project windows use `titleBarStyle: 'hidden'` with a `titleBarOverlay` (`electron/main.ts`). The renderer draws the tab bar into the title bar, and `.app-shell--windows .project-tabbar` keeps clear of the caption buttons. `applyWindowMenus` still attaches the application menu to project windows, and `autoHideMenuBar` is on. But a window with a hidden title bar has no menu row, so the menu is unreachable on Windows. Its accelerators still work, because main dispatches them in `before-input-event`. Linux keeps the default frame, and its menu bar shows on Alt as usual.

The workspace UI is served by the connected server, and Desktop is a protocol-blind host (ADR-0008). Anything the shared renderer draws comes from the server's bundle. What the host offers reaches that bundle through `hostPresentation` (`nativeMenus`, `nativeWindowControls`, `renderCompactApplicationMenu`). So a Windows Desktop window connected to an older server runs that server's renderer.

The keyboard switcher chord lives in two places. `getTerminalSwitcherDirection` in `src/components/terminalSwitcherInteraction.ts` is used by `TerminalPanel`'s xterm key handler, which dispatches `terminay-open-terminal-switcher`. `useTerminalSwitcherController` handles the window-level keydown, commits on Alt keyup and closes on Escape. Both hard-code Alt+Tab, and the heading in `App.tsx` reads "Alt+Tab / Release Alt to switch". Windows and most Linux desktops take Alt+Tab, so the renderer never sees it.

Scrollbars: a few panes set `::-webkit-scrollbar` rules of their own, `settings.css` uses `scrollbar-width: thin`, and everything else gets Chromium's default, which on Windows has arrow buttons. xterm 6 draws its own arrowless DOM scrollbar. The lone down arrow at the terminal's bottom right comes from a native scrollbar on an element behind or beside it, and that element is found during implementation.

## Goals / Non-Goals

**Goals:**
- Every command in the application menu is reachable on Windows by mouse (a title-bar button) and by keyboard (bare Alt).
- The switcher opens on Windows and Linux Desktop, with the platform's conventional chord.
- One arrowless scrollbar style everywhere.

**Non-Goals:**
- An in-page File/Edit/View bar on Windows. The browser host's in-page menu stays browser-only.
- F10 or Alt+letter mnemonics into specific menus.
- Changing the browser host's switcher chord. In a browser, Ctrl+Tab belongs to the browser.
- Linux title bars, which keep their native frame and menu bar.

## Decisions

### Main pops up its own menu; the renderer asks with no command

The renderer asks through the existing host bridge with a new host action, `menu.popup { x, y }`. It is classed under the `nativeMenus` capability, carries the button's bottom-left in CSS pixels, and is parsed to two bounded, finite, non-negative numbers, with no other key allowed. Main honours it only for a win32 project-host window (`appWindows`). It scales the point by the window's zoom, clamps it to the content bounds, and calls `Menu.getApplicationMenu()?.popup({ window, x, y })`. The renderer never sends a command id, so the trust boundary between renderer and privileged main is unchanged. The only new capability is "show the menu main already has", and native-only commands run through their usual menu click handlers.

*Alternative:* render the browser host's in-page menu bar on Windows. Rejected because it lacks native-only commands, and the spec selects exactly one menu presentation per host.

*Alternative:* `win.setMenuBarVisibility(true)`. Rejected because a hidden-title-bar window has nowhere to draw it.

### The host offers the button through hostPresentation

`hostPresentation` gains `openApplicationMenu?: (point) => Promise<boolean>`. The bundle's Desktop composition sets it when the host offers native menus and the window draws its own title bar, which today means Windows. The shared renderer draws the menu button at the left of `.project-tabbar` (and in the compact row) only when it is present. Browser hosts, macOS, Linux and auxiliary windows draw nothing.

The `nativeMenus` capability version is not bumped. Bundles declare it as an optional range of exactly 1, so a host reporting 2 would lose native menus with every older server's bundle. Instead, a Windows Desktop built before this change refuses the unknown action, and the button hides itself on that refusal. With an older server's bundle there is no button at all, but the Alt path below still works, because it lives entirely in main.

### Bare Alt is detected in main's before-input-event

`bindAppShortcuts` already sees every key in every window before the renderer. On win32 project windows it tracks one flag. An Alt keyDown with no other modifier arms the flag. Any other keyDown clears it. An Alt keyUp while armed pops the menu at the button's anchor, a fixed point below the title bar's left end that matches the button's place. Alt keyUp is not otherwise delivered to the page, so a terminal never sees a bare Alt. Alt chords are untouched, because the flag clears on the second key. While the menu is open Windows runs its own menu loop, so Alt and Escape close it natively.

*Alternative:* detect bare Alt in the renderer. Rejected because it would need the current server's bundle and would fight xterm's key handler.

### One switcher chord per platform, chosen in the renderer

`getTerminalSwitcherDirection(event, chord)` takes the chord as an argument: `{ modifier: 'ctrl' | 'alt' }`. A small `terminalSwitcherChord(host)` returns `ctrl` when the host has native menus and the platform is not macOS, and `alt` otherwise (macOS Desktop and browser hosts). The controller commits on the keyup of that modifier, and the heading reads `Ctrl+Tab` / `Release Ctrl to switch` or the Alt form. A chord is claimed only when its modifier is the only one held besides Shift, as today. Main's `before-input-event` does not claim Ctrl+Tab, and no built-in shortcut binds it today. If a user binds Ctrl+Tab to a command, main dispatches that command first, and the switcher yields as it already does for a prevented event.

### Scrollbars are styled once, globally, with the webkit pseudo-elements

A single rule in the renderer's base stylesheet sets `::-webkit-scrollbar` (8px), a transparent track, a rounded thumb using the theme's scrollbar colours, `::-webkit-scrollbar-button { display: none }` and a transparent `::-webkit-scrollbar-corner`. In Chromium, the standard `scrollbar-width` and `scrollbar-color` properties switch the webkit pseudo-elements off for that element, so the `settings.css` declarations are removed rather than layered on. Per-pane `::-webkit-scrollbar` rules that differ only in width or colour are folded into the global one. The element behind the stray arrow is identified in the Windows VM and covered by the same rule. A rule there that hides the native scrollbar outright (`scrollbar-width: none` or `display: none`) is kept if xterm's own bar already covers that element.

### A same-size resize stops at the terminal service

A terminal panel re-sends its size whenever it becomes the presentation that controls the terminal, which happens on focus. On macOS and Linux that is harmless: the kernel ignores a `TIOCSWINSZ` that does not change the size, so the shell gets no `SIGWINCH` and prints nothing. Windows ConPTY repaints the whole screen for every resize, even one that changes nothing (measured in the VM with node-pty: one full-screen repaint per call). That repaint arrives more than a second after the last keystroke, so the raw-output tier counts it as work, and the tab goes amber and then green. `TerminalService.resize` now authorizes the request as before but returns without touching the PTY or the presentation checkpoint when the size equals the session's recorded size. That gives every platform the POSIX behaviour.

*Alternative:* treat output just after a resize like output just after input. Rejected because a real resize of a busy terminal would then hide real work, and the bug is the needless resize, not the repaint.

## Risks / Trade-offs

- **Bare Alt opening a menu surprises a shell user who taps Alt** → This is the Windows convention, and tapping Alt does nothing useful in a terminal. Only a clean press and release triggers it, never a chord.
- **Ctrl+Tab is a key some TUIs read** → Few terminal programs see Ctrl+Tab at all, since most terminals send it as plain Tab. Windows Terminal and VS Code also claim it for tab switching.
- **The popup's anchor drifts from the button at non-100% zoom or DPI** → The button passes its own rect from `getBoundingClientRect()`, scaled by `webContents.getZoomFactor()` in main. The Alt path uses the same anchor the button last reported, falling back to the fixed point.
- **Hiding scrollbar buttons removes a click target some users rely on** → Windows 11's own overlay scrollbars hide their arrows until hover. Keyboard and wheel scrolling are unchanged.

## Migration Plan

No data or settings move. A server built before this change, serving a Windows Desktop window, shows no button, but bare Alt still opens the menu. Rollback is a revert.

## Open Questions

- None. The four product choices were made in planning: Ctrl+Tab on Windows, Ctrl+Tab on Linux, a title-bar menu button plus bare Alt, and arrowless scrollbars everywhere.
