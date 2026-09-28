## Why

Remote access is Terminay's whole point, yet the header gives it a play/stop button and a count pill that shout about something the user rarely changes, while the facts they glance at constantly — where the focused terminal is, which branch it is on, whether a phone is connected — have no home at all. A single, quiet status bar along the bottom of the window gives those facts a place and lets the header control shrink to just the server name.

## What Changes

- Add a workspace status bar along the bottom of the window, tinted with the active project colour.
- The left side follows the focused terminal: a tab segment with a miniature of the split layout that highlights the focused group and the terminal's title, the terminal's working directory as a breadcrumb, and a branch chip with uncommitted-change and ahead-of-default-branch counts when the directory is inside one of the project's worktrees. When focus moves, only the path segments that differ animate in.
- The right side shows remote access state for the active tab's server: device icons and a connection count when devices are connected, and a status dot — red when a Desktop Local server is not exposed, grey when exposed with no connections, blue when devices are connected. It does not repeat the server name; activating it opens the existing connection menu.
- Add a **Show Status Bar** toggle in the View menu (native checkbox on Desktop, checked item in the browser in-page menu), the Command Bar and the shortcut settings. The status bar is shown by default and the choice is a device-local setting.
- **BREAKING (presentation):** the header connections control drops the exposure play/stop icon and the connection-count pill. It shows only the server label and chevron; exposure is still started and stopped from the connection menu.
- The status bar is not shown in the compact (phone) chrome.

## Capabilities

### New Capabilities

- `workspace-status-bar`: the bottom status bar — what it shows for the focused terminal, how it follows focus, the remote access indicator, and its visibility preference.

### Modified Capabilities

- `connections-and-client-hosts`: "Header server control presentation" no longer shows the exposure icon or the connection-count pill.
- `settings-shortcuts-and-desktop-integration`: adds the **Show Status Bar** command and its device-local visibility setting.

## Impact

- `src/App.tsx` / `src/App.css`: status bar slot below `.workspace-stack`; the active `ProjectWorkspace` supplies the focused-terminal side.
- New `src/workspace/WorkspaceStatusBar.tsx` (+ pure model module and `node:test` unit test).
- `src/workspace/RemoteAccessConnectionMenu.tsx`: remove the play/stop icon and count pill.
- `packages/protocol/src/host.ts`, `src/keyboardShortcuts.ts`, `src/types/settings.ts`, `src/terminalSettings.ts`: `toggle-status-bar` command and `showStatusBar` device setting.
- `electron/main.ts`: View menu checkbox item. `src/web/ConnectedWebRendererWorkspace.tsx`: browser in-page View item.
- Reads existing APIs only: `terminal.cwd`, git worktree status, `remote-access.status`. No server, protocol-message or security-boundary changes.
