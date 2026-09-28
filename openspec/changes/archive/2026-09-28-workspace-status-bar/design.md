## Context

The header connections control (`RemoteAccessConnectionMenu`) shows a play/stop exposure icon, the server label and a blue connection-count pill. There is no place in the window for the focused terminal's directory or branch. The data the status bar needs already reaches the renderer:

- **Remote access:** `RemoteAccessStatus` (`isRunning`, `connections`) through the server application protocol, held in App as `remoteStatus` by `useRemoteAccessController`.
- **Working directory:** pull-only `terminal.cwd` query (`useProjectTerminalCwd` / `getServerTerminalCwd`), resolved on the server by walking the process table. That is a subprocess spawn per call, so it must not be polled on a timer (see the `reduce-idle-subprocess-spawns` change).
- **Git:** per-project `WorktreePanelStatus` from `useFileExplorerController` (branch, `entries`, `aheadOfMainCount`, worktree `path`), kept fresh by `git.status.changed`.
- **Focus and layout:** `ProjectWorkspace` owns the dockview API, `focusedSessionId` and the workspace inventory.
- **Menus:** `createAppMenu(settings)` in `electron/main.ts` is rebuilt whenever a device setting changes (`device.settings.update`). The browser in-page menu already supports `checked` items.

## Goals / Non-Goals

**Goals:**
- A window-wide, project-tinted status bar showing the focused terminal's layout, title, directory and branch on the left, and remote access state on the right.
- Update when focus moves and when the focused terminal changes directory, without timer polling.
- A device-local **Show Status Bar** setting, toggled from the View menu, Command Bar and shortcuts. Shown by default.
- Slim the header control to the label and chevron.

**Non-Goals:**
- Showing the foreground process name. The server knows it but does not expose it in activity snapshots; adding it is a protocol change for a later iteration.
- Upstream ahead/behind. We show ahead-of-default-branch, which the worktree status already carries.
- Branch detection for directories outside the project's known worktrees.
- A status bar in the compact (phone) chrome, where vertical space is scarce.
- Changing how exposure is started or stopped. That stays in the connection menu.

## Decisions

### One window-level bar, filled by the active project through a portal

App renders `<footer class="workspace-status-bar">` as a sibling after `.workspace-stack`. It owns the right-hand remote access indicator because App holds `remoteStatus`. The left-hand focused-terminal segment is rendered by the **active** `ProjectWorkspace` into a slot element in that footer with `createPortal`, because the workspace already owns the dockview API, focus, cwd client and git status.

*Alternatives:* a bar inside each `ProjectWorkspace` would leave Home without a bar and duplicate the remote indicator per project. Lifting focus, cwd, git and layout state up into App would add a wide new prop surface for data only the active workspace has.

### Working directory refreshes on events, never on a timer

The focused terminal's cwd is queried when focus changes, when the window regains focus, and after the focused terminal settles following user input. Settling means that Enter was sent and output has then gone quiet for a short debounce. Responses for a terminal that is no longer focused are discarded. An unobserved cwd (`source !== 'observed'`) hides the breadcrumb.

*Alternative:* a fixed interval poll would spawn a process-table walk every few seconds per window. ADR-0028 forbids that without owner approval. Querying on demand in response to events is its sanctioned fallback for state with no watch (decision 4). The input-settle debounce is a one-shot timeout after an observed event, not a poll.

### Branch comes from the project worktree that contains the directory

The worktree whose `path` is the longest prefix of the cwd supplies branch, uncommitted-change count (`entries.length`) and `aheadOfMainCount`. With no match, the bar shows no branch chip. It cannot say "not a repo", because the directory may be a repository the project does not track. This reuses the file explorer's already-subscribed worktree status, so the bar adds no Git queries of its own.

### Layout miniature from dockview group geometry

The miniature is built from each dockview group's bounding rectangle, normalized to the dockview container. It is recomputed on `onDidLayoutChange` and on active-group change. That reproduces any split arrangement, not only rows or columns.

### Pure model module

Path splitting (home to `~`, middle collapse), shared-prefix diffing for the animation, worktree matching, and the remote indicator state (dot tone, label, accessible name) live in a pure `workspaceStatusBarModel.ts` with `node:test` coverage. The React component only renders.

### Visibility is a device-local terminal setting

A new top-level `showStatusBar: boolean` (default `true`) in `TerminalSettings`. It is not in `SERVER_OWNED_TERMINAL_SETTING_KEYS`, so it rides the existing device-settings path. On Desktop that is `device.settings.update`, which persists to `terminal-settings.json` and rebuilds the menu; browser hosts use the localStorage fallback. `createAppMenu` renders **View → Show Status Bar** as `type: 'checkbox'` with `checked: settings.showStatusBar`. Its click dispatches the new `toggle-status-bar` command to the focused window like every other menu command, so the renderer stays the single writer of the setting.

*Alternative:* a localStorage-only preference (like touch text selection) cannot drive a native checkbox, because the main process cannot read it.

### Red dot only for the Desktop Local server

The dot is red only when the active tab's server is `desktop-local` on a native (Electron) host and is not exposed. Remote servers and browser hosts show grey or blue. In a browser host the unavailable remote-access client reports `isRunning: false`, which would otherwise read as an alarming red.

### Boundaries

This is renderer presentation plus one menu item. It reads existing server application queries and the existing device-settings host action. No new preload API, protocol message or IPC channel is added. It does not cross the project/window or terminal-session boundary: each workspace only renders its own focused terminal, and the cwd query is scoped to that project and session as today.

## Risks / Trade-offs

- [Cwd can go stale if a directory change happens with no input, such as a script that changes directory on its own] → It refreshes on the next focus or input settle. That is acceptable for an at-a-glance bar.
- [A bottom bar shrinks `.workspace-stack` by about 26px] → e2e geometry assertions that measure the workspace may shift. Run the affected suites and adjust them.
- [Removing the play/stop icon changes a visible control] → The accessible name keeps the `Exposed`/`Offline` state, so screen-reader users and existing e2e locators keep working.
- [Animation noise] → Only differing path segments animate, and `prefers-reduced-motion` disables it.

## Migration Plan

The setting is additive with a default of `true`, so no data migration is needed. Rollback is a revert.

## Open Questions

None.
