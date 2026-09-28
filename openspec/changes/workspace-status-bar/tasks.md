## 1. Setting and command

- [x] 1.1 Add `toggle-status-bar` to `TERMINAY_HOST_MENU_COMMANDS` (`packages/protocol/src/host.ts`), `appCommandMetadata` and `defaultKeyboardShortcuts` (unbound) in `src/keyboardShortcuts.ts`. Verify: `npm run typecheck` passes and the command appears in the shortcut settings list.
- [x] 1.2 Add device-local `showStatusBar: boolean` (default `true`) to `TerminalSettings`, `defaultTerminalSettings` and `normalizeTerminalSettings`, not in `SERVER_OWNED_TERMINAL_SETTING_KEYS`. Verify: a unit test asserts the default, the normalization fallback and the device-local classification.
- [x] 1.3 Handle `toggle-status-bar` in App by flipping `showStatusBar` through the terminal settings client, and add a Command Bar entry. Verify: invoking it from the Command Bar hides and shows the bar.

## 2. Menus

- [x] 2.1 Add **Show Status Bar** as a `type: 'checkbox'` View menu item in `createAppMenu` with `checked: settings.showStatusBar`, dispatching `toggle-status-bar`. Verify: a source test in `scripts/` asserts the checkbox item, and the menu reflects the setting after toggling in Desktop.
- [x] 2.2 Add a checked **Show Status Bar** item to the browser in-page View menu in `ConnectedWebRendererWorkspace.tsx`. Verify: the browser menu shows the item checked according to the setting.

## 3. Status bar model

- [x] 3.1 Create `src/workspace/workspaceStatusBarModel.ts`: path display segments (home to `~`, middle collapse), first differing segment index, containing worktree by longest path prefix, remote indicator state (tone, label, device count, accessible name) with red only for Desktop Local. Verify: `src/workspace/workspaceStatusBarModel.test.ts` covers each function and is wired into the `smoke` script.

## 4. Status bar UI

- [x] 4.1 Create `src/workspace/WorkspaceStatusBar.tsx` with the footer shell, the right-hand remote indicator (device icons, label, dot, opens the connection menu) and a left slot for the portal. Style it in `App.css`, tinted from `--project-color`, with `prefers-reduced-motion` handling. Verify: it renders in Desktop with each exposure state.
- [x] 4.2 Mount the footer in App after `.workspace-stack`. Hide it in compact chrome and when `showStatusBar` is false. Verify: the workspace reclaims the height when hidden.
- [x] 4.3 In `ProjectWorkspace`, while active, portal the focused-terminal segment into the slot: layout miniature from dockview group geometry (recomputed on layout and active-group change), terminal title, cwd breadcrumb with differing-segment animation, and branch chip from the containing worktree. Verify: splitting, switching tabs and switching projects update the bar, and only the differing path segments animate.
- [x] 4.4 Refresh the focused cwd on focus change, window focus and input settle (one-shot debounce after Enter and quiet output), discarding responses for a terminal that is no longer focused. No interval timer. Verify: a `cd` in the focused terminal updates the breadcrumb and branch, and no timer re-queries while idle.

## 5. Header control

- [x] 5.1 Remove the exposure play/stop icon and the connection-count pill from `RemoteAccessConnectionMenu`, keeping the label, chevron and the state-bearing accessible name. Verify: `scripts/compact-switcher-ui.test.mjs` and the other source tests that mention the menu pass, and `e2e/electron-connection-manager.spec.ts` still finds `Open connection menu, Offline`.

## 6. Verification

- [x] 6.1 Run `npm run typecheck`, `npm run lint` and the smoke/unit scripts. Verify: all pass.
- [x] 6.2 Run the affected e2e suites through `npm run test:e2e` (project-tabs, project-sidebar-layout, workspace-sidebar-resize, electron-connection-manager, keyboard-shortcuts). Verify: all pass, with any geometry assertions updated for the status bar height.
- [x] 6.3 Launch the Desktop app and check the bar visually against the chosen concept (06 Tinted + focus). Verify: screenshots of exposed/not exposed/connected states and of a split layout.
- [ ] 6.4 Run `openspec validate --all`. Verify: it passes.
