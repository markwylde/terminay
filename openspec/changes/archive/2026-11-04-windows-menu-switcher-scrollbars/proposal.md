## Why

On Windows, Terminay draws its own title bar, so the window has no menu row: Terminay, Edit, View, Window and Help cannot be opened at all, by mouse or by Alt. The terminal switcher is bound to Alt+Tab, which Windows (and most Linux desktops) take for switching windows, so it never opens there. And scrollbars mix styles: most use the platform's default, which on Windows draws arrow buttons, while the terminal uses a thin arrowless bar, so a stray down arrow shows at the terminal's bottom right with none at the top.

## What Changes

- On Windows, a menu button at the left of the title bar opens the full native application menu as a dropdown. Pressing and releasing Alt on its own opens the same menu, as Alt opens a menu bar in other Windows apps.
- On Windows and Linux Desktop, the terminal switcher opens with Ctrl+Tab and goes back with Ctrl+Shift+Tab; releasing Ctrl switches. macOS keeps Option+Tab. The switcher's heading names the chord the platform uses.
- Every scrollbar in the Desktop and browser renderer uses one thin style with no arrow buttons.
- On Windows, Settings, Macros, editors and About use the ordinary Windows frame; only project windows draw their own title bar, so secondary windows lose the empty band reserved for caption buttons.
- Focusing or leaving a terminal no longer turns its tab amber on Windows. The panel re-sends its current size when it takes focus, and ConPTY repaints the whole screen for any resize, so the server now drops a resize to the size the PTY already has.
- The Windows-only gap in "Native menu bar only on project windows" is closed: a project window on Windows reaches the menu through the button rather than a menu row.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: the project window's menu on Windows is reached from a title-bar button and bare Alt; every scrollbar has one arrowless style.
- `terminal-activity-signals`: a resize to a terminal's current size reaches no PTY, so focusing a terminal never reads as activity.
- `workspace-and-project-tabs`: the keyboard terminal switcher's chord follows the platform: Ctrl+Tab on Windows and Linux Desktop, Option+Tab on macOS.

## Impact

- `electron/main.ts`: a privileged IPC that pops up the application menu in the asking project window; bare-Alt detection on Windows.
- `electron/preload` and the Desktop host presentation: expose the popup request.
- `src/App.tsx` and `src/App.css`: the menu button in the Windows title bar, and the switcher heading.
- `src/components/terminalSwitcherInteraction.ts`, `src/workspace/useTerminalSwitcherController.ts`, `src/components/TerminalPanel.tsx`: the platform chord and its release key.
- Global renderer CSS: one scrollbar style.
- Browser hosts keep their in-page menu bar and their Alt+Tab switcher.
- `packages/server-core/src/terminalService/service.ts`: `resize` returns early when the size is unchanged.
