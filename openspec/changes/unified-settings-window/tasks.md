## 1. Settings shell and spacing

- [ ] 1.1 Add the layout tokens (`--settings-space-1…6`, `--settings-inset`, `--settings-header-height`, `--settings-nav-row`, `--settings-list-row`, `--settings-row-pad`) to `src/settings.css` and convert existing Settings rules to them. Verify: `npm run lint` passes and no literal px padding or margin remains in Settings rules (grep), apart from borders and radii.
- [x] 1.2 Extract `src/components/settings/SettingsShell.tsx`: the grouped sidebar (General, Terminal, Connections, Automation, Extensions, System, with empty groups omitted and counts for collections), the header band, and the optional list column. Make `SettingsWindow` register categories into it. Verify: a Vitest unit test covers group order, omission of an unavailable category or empty group, and the collection count.
- [x] 1.3 Add the collection category contract (sections, items, status line, add action, detail renderer) and remember the selected item for each category while Settings is open. Verify: a unit test shows that returning to a category restores its item.
- [x] 1.4 Add the `item` parameter to the `settings` route next to the initial category, so commands can open Settings at a category and item. Verify: a unit test of route parsing and an e2e test that opens Settings at Macros with a given macro selected.
- [x] 1.5 Implement the narrow presentation: one column at a time with back controls labelled by the previous column, used below the three-column minimum (about 920 px) and always on compact viewports, keeping the selection when widened again. Verify: `e2e/settings.spec.ts` scenarios "Narrow window" and "Widening again" pass through `npm run test:e2e`.
- [x] 1.6 Extend Settings search to collection items (saved server names; macro names, descriptions and script text; extension names). Choosing a result opens its category with the item selected. Verify: e2e scenarios "Finding a macro by its script" and "Finding a saved server".
- [x] 1.7 Raise the default Settings size to fit three columns where the viewport allows, clamped by the existing geometry model. Verify: an `e2e/in-page-windows.spec.ts` "First open" scenario checks the centred default size, and the shared header line and stable column positions are asserted from bounding boxes.

## 2. Remote Access category

- [x] 2.1 Build `settings/RemoteAccessCategory.tsx`. The list column has **This server** (named after the selected server, with exposure state and trusted count), **Saved servers** from the host connection list, and **Add server…** in the header. Reuse the exposure cards from `SharedConnectionsRouteBody`. Verify: e2e "Opening Remote Access" and "Empty saved-server list".
- [x] 2.2 Move the signalling options (expose on startup, PIN attempts, WebRTC domain, ICE servers) from the old `remote-access-host` section into the exposure detail, and remove the "Open Remote Control" page. Verify: e2e "Exposure options live with exposure". No Settings category other than Remote Access renders these fields (grep `remote-access-host`).
- [x] 2.3 Name trusted devices by device and browser, parsed from the user agent, with the full user agent revealable. Verify: a unit test of the parser with iPhone Safari, macOS Firefox, Linux Chrome and an unknown string, and e2e "Readable trusted devices".
- [x] 2.4 Saved-server detail (name, status, address, Rename, Forget, retry while offline) and the Add server… form in the detail pane. On framed sessions, list attached connections only. Verify: e2e "Adding a server", and that Saved servers is unchanged after switching the server selector ("Saved servers do not follow the selector").
- [x] 2.5 Point the connection menu manage control and the pending-approval notification at Settings › Remote Access (on the pending request). Make Create pairing link open the same Pair Device dialog over Settings. Verify: rewrite `e2e/remote-control-management.spec.ts` as `e2e/settings-remote-access.spec.ts` covering both entry points, approval from the notification, and Escape closing only the pairing dialog.

## 3. Macros category

- [x] 3.1 Split `MacrosWindow.tsx` into `settings/MacrosCategory.tsx`: the library with its filter, categories, drag, unsaved markers and **New macro** in the list column; the script editor and live preview in the detail. Verify: `e2e/macros.spec.ts` runs against Settings › Macros and its existing library, editor, preview and category scenarios pass.
- [x] 3.2 Keep the macro change set in a store that lives as long as Settings, with the Save/Discard bar and its keyboard shortcut in the detail. Verify: e2e "Leaving the category with pending edits" and "Saving several macros".
- [ ] 3.3 Confirm save, discard or keep editing when Settings closes, or the server selector changes, with pending macro edits, using the frame's refuse-dismissal path. Verify: e2e "Closing Settings with pending edits", including Escape and backdrop presses.
- [x] 3.4 Route Macros through the Settings server selector and pass the macro client explicitly for the selected server. Verify: e2e "Macros are not merged" with two attached servers, and a unit test that the category receives no client when the selected connection is unavailable.

## 4. Extensions category

- [x] 4.1 Convert Extensions to a collection category: an **Install** item (npm and package-file forms) and the installed extensions with built-in or custom status and enabled state; the detail shows the toggle, permissions and contributed settings sections. Verify: the existing extensions e2e passes against the new layout, and a custom-install review still opens as a dialog over Settings.

## 5. Recordings in Home

- [x] 5.1 Add `recordings` to `HOME_SECTIONS` and its labels, and render the timeline from `RecordingsWindow` as the Recordings Home tab with the Automations-style server selector. Verify: unit tests in `homeSection` and e2e `home-sidebar.spec.ts` "Group order" (four sections) and "Home with no tabs open" (four sections offered).
- [x] 5.2 Open a replay as a Home tab keyed by recording id: a repeat open focuses the existing tab, and closing it deletes nothing. Verify: `e2e/recordings.spec.ts` rewritten for "Replaying from the timeline", "Replaying the same recording twice", "Closing a replay" and "Replay belongs to Recordings".
- [x] 5.3 Make the `open-recordings` command and its binding select Home and focus Recordings. Verify: e2e "Opening recordings" through both the Command Bar and the shortcut.

## 6. Commands, routes and menus

- [x] 6.1 Make `open-remote-control`, `open-macros` (default `CmdOrCtrl+;`) and `open-extensions` present the Settings route at their category. Rename the Command Bar labels to New Terminal Tab, New Project, Settings, Remote Access, Macros, Extensions and Recordings. Verify: `e2e/keyboard-shortcuts.spec.ts` covers ⌘; opening Settings › Macros, and a Command Bar search test finds each entry.
- [x] 6.2 Remove the `macros`, `recordings` and `remote-control` Desktop auxiliary kinds (`AUXILIARY_TITLES`, `canonicalAuxiliaryRequest`, window lifecycle), their entries in `src/shared/auxiliaryRoutes.tsx`, and their geometry ids. Verify: a unit test that a route request for each removed kind is refused, `e2e/shared-auxiliary-routes.spec.ts` updated, and `npm run typecheck` passes.
- [x] 6.3 Rebuild `createAppMenu`. On macOS, the Terminay menu gains Settings… (⌘,), New Terminal Tab and New Project, and there is no File menu. On Windows and Linux, the first menu is Terminay with New Terminal Tab, New Project, Settings… (Ctrl+,) and Quit. Verify: a unit test of the menu template for darwin and linux (labels, order, accelerators, no `File`), and the native-menu-bar policy tests still pass.
- [x] 6.4 Rename the browser in-page `file` menu to `terminay` (labelled "Terminay") with New Terminal Tab, New Project, Settings…, and Disconnect where the session can return to the manager. Apply the same to the compact grouped menu. Verify: `e2e/shared-responsive-shell.spec.ts` and the in-page menu tests assert Terminay, Edit, View and Help with no File, on wide and compact layouts.
- [x] 6.5 Update the remaining e2e and unit references to Remote Control, the File menu and the removed windows (`electron-connection-manager`, `desktop-loopback-standalone-pairing`, `canonical-runtime-convergence`, `server-upgrade`, `task20-browser-responsiveness`, `windowStack.test.ts`). Verify: `grep -rn "Remote Control\|'File'" e2e src electron` returns no live references, apart from historical changelog notes.

## 7. Cleanup, docs and verification

- [ ] 7.1 Delete the now-unused window components and their CSS (`RemoteControlWindow.css`, the leftover `MacrosWindow` and `RecordingsWindow` shells, duplicated Settings-family styles). Verify: `npm run lint` and `npm run typecheck` pass and there are no unused exports (knip or a grep for the old component names).
- [x] 7.2 Update `docs/product-overview.md` and any `docs/operations/` runbook that says "File → Remote Control" or describes the old windows. Verify: `grep -rn "Remote Control\|File →" docs` finds nothing stale.
- [ ] 7.3 Do a visual pass: screenshot Settings at Appearance, Remote Access, Macros and Extensions in dark and light themes at 1280 px and in narrow mode, and check them against the spacing tokens (aligned header line, one inset per column, equal row heights). Verify: screenshots attached to the PR description.
- [ ] 7.4 Run `openspec validate --all` and the full `npm run test:e2e`. Open the PR on Gitea (`tea`) and read back every commit status on the head SHA. Verify: validation passes and every status is `success` or `skipped`.
