## 1. Windows application menu

- [x] 1.1 Add a pure `windowsMenuAnchor` / `bareAltTracker` module in `electron/` (arm on a lone Alt keyDown, clear on any other key, fire on Alt keyUp; clamp an anchor to the content bounds). Verified by a new `scripts/*.test.mjs` unit test covering a bare Alt, Alt+B, Alt held then Escape, and out-of-range anchors.
- [x] 1.2 In `electron/main.ts`, handle a new `menu.popup` host action (protocol: bounded point, no command, under `nativeMenus`) for win32 project-host windows only. It pops up `Menu.getApplicationMenu()` at the clamped anchor and ignores the request from any other window. Wire the bare-Alt tracker into `bindAppShortcuts` for win32 project windows. Verified by `packages/protocol/test/host.test.mjs`, the platform-gate unit test, and in the Windows VM.
- [x] 1.3 Add `openApplicationMenu(point)` to `src/host/nativeActions.ts`, and set `hostPresentation.openApplicationMenu` only for a native-menu host whose window draws its own title bar (Windows). Verified by `tsc` and `scripts/application-menu-button-ui.test.mjs`.
- [x] 1.4 Draw the menu button at the left of `.project-tabbar` when `hostPresentation.openApplicationMenu` is present. It passes its bottom-left as the anchor and has an accessible name ("Application menu"). Verified by a renderer unit test and an E2E check that no button exists on the Linux Desktop host.

## 2. Platform switcher chord

- [x] 2.1 Make `getTerminalSwitcherDirection` take the chord (`ctrl` or `alt`), and add `terminalSwitcherChord(host)`, which returns ctrl for a native-menu host off macOS and alt otherwise. Verified by extending `scripts/terminal-switcher-interaction.test.mjs` to cover Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Alt+Tab (not claimed) and the macOS and browser alt cases.
- [x] 2.2 Use the chord in `TerminalPanel`'s key handler and in `useTerminalSwitcherController`, committing on that modifier's keyup. Verified by the unit tests and by an E2E test on the Linux Desktop host: Ctrl+Tab with a terminal focused opens the switcher, and releasing Ctrl switches.
- [x] 2.3 Make the switcher heading name the chord and release key ("Ctrl+Tab" / "Release Ctrl to switch"). Verified by that E2E test reading the heading.

## 3. One scrollbar style

- [x] 3.1 In the Windows VM, find the element that draws the stray arrow at the terminal's bottom right. Verified by a DevTools note in the PR. Found: `.xterm .xterm-viewport`, whose `overflow-y: scroll` drew Chromium's native bar beside xterm's own; it is hidden with `::-webkit-scrollbar { display: none }`.
- [x] 3.2 Add the global thin, arrowless `::-webkit-scrollbar` rule, remove `settings.css`'s standard `scrollbar-width` and `scrollbar-color`, and fold the per-pane rules into it. Verified by `npm run lint` and a VM screenshot of a scrolled terminal and the settings page with no arrows.

## 4. Native frame for Windows secondary windows

- [x] 4.1 Give auxiliary windows and About the ordinary frame on win32 (`titleBarOverlay` only on project windows), and make the renderer reserve a caption band only when `navigator.windowControlsOverlay.visible` reports one. Verified by `tsc` and a VM screenshot of Settings with the Windows title bar and no empty band.

## 5. Focus does not read as activity

- [x] 5.1 Make `TerminalService.resize` skip the PTY when the requested size equals the session's size. Verified by `packages/server-core/test/terminal-service.test.mjs` ("a resize to the session's current size does not reach the PTY") and, in the Windows VM, by clicking between two idle PowerShell terminals with neither tab turning amber.

## 6. Verification

- [x] 6.1 `npm run build`, `npm run lint`, the smoke unit tests, and `npm run test:e2e` for the switcher and menu specs. Verified by their output.
- [x] 6.2 In the Windows VM, run a built Terminay. Check that the menu button opens the full menu, bare Alt opens it, Alt+B reaches PowerShell, Ctrl+Tab switches terminals, and no scrollbar shows arrows. Verified by screenshots.
- [ ] 6.3 Open the PR on Gitea and read back every status as success or skipped. Verified by the status list.
