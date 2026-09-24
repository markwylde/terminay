## 1. Menu policy module

- [x] 1.1 Add `electron/windowMenuPolicy.ts` with `applyWindowMenu` and `applyWindowMenus` (project-host windows get `setMenu(menu)`, all others get `removeMenu()`, no-op on macOS). Verified by 1.2.
- [x] 1.2 Add `scripts/window-menu-policy.test.mjs` (`node --test`, fake windows recording `setMenu`/`removeMenu`) covering: project window gets the menu, auxiliary window gets none, a rebuild leaves auxiliary windows menu-less, and darwin is a no-op. Register it as an `npm run test:window-menu-policy` script and add it to the relevant CI test aggregate. Verified by the test passing.

## 2. Wire the policy into Electron

- [x] 2.1 In `electron/main.ts`, add `app.on('browser-window-created')` that removes the menu from every new window on Windows and Linux. Verified by 4.2 (pop-out and settings windows open without a bar).
- [x] 2.2 In `createWindow`, opt project-host (`!isAuxiliary`) windows into the application menu through `applyWindowMenu`. Verified by 4.2 (main window still has its bar).
- [x] 2.3 In `createAppMenu`, after `Menu.setApplicationMenu(menu)`, run `applyWindowMenus` over all windows using `appWindows` membership. Verified by 1.2 and 4.3.
- [x] 2.4 Remove the now-dead `shouldAutoHideMenuBar()` and the pop-out's `autoHideMenuBar` option. Verified by `npm run lint` and typecheck passing.

## 3. Shortcuts in menu-less windows

- [x] 3.1 Extend the `before-input-event` binding so `Ctrl+Shift+C` keyDown in a non-project window on Windows and Linux calls `sendCopyRequestToFocusedWindow` and prevents default. Project windows keep the menu accelerator. Verified by 4.4.

## 4. Verification

- [x] 4.1 `npm run lint`, typecheck, and `npm run test:window-menu-policy` pass. Verified by command output.
- [ ] 4.2 Manual check on Windows or Linux: the main window shows the menu bar, and Settings, Macros, Recordings, the edit-tab window and a terminal pop-out show none. Verified by screenshots.
- [ ] 4.3 Manual check: change a keyboard shortcut in Settings while it is open. Settings still has no bar and the main window's menu shows the new accelerator. Verified by screenshot.
- [ ] 4.4 Manual check: in a terminal pop-out, `Ctrl+Shift+C` copies the selection, and `Ctrl+,` or another configured shortcut still works in a secondary window. Verified by pasting the copied text elsewhere.
- [ ] 4.5 `openspec validate menu-bar-main-window-only` passes, then the Gitea PR's commit statuses are all `success` or `skipped`. Verified by `tea` / API status readback.
