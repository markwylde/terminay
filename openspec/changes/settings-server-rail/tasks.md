## 0. Ordering

- [ ] 0.1 Before archiving this change, archive `unified-settings-window` and `server-import-export`, which this change's deltas build on. Verify: `ls openspec/changes/archive | grep -E 'unified-settings-window|server-import-export'` lists both, and `openspec validate --all --archived` passes after this change's archive.

## 1. Place model

- [x] 1.1 Add `src/components/settings/settingsPlaces.ts` with `placeOfSettingKey`, the category-to-place table for non-field categories, and `categoriesForPlace(place, host, capabilities)`. Keep a category only when the place has fields, a collection or a status page for it on that host. Verify: unit tests in `src/components/settings/settingsPlaces.test.ts` list the exact categories for device on Desktop, device in a browser (no Updates, Diagnostics or Import & Export), and server in a browser (Updates present).
- [x] 1.2 Add the `placementCategoryId` section map for `activityIndicators.*` (server Interaction) and `sidebar.*` (device Appearance), and route field deep links through it. Verify: unit tests resolve tab indicators to server › Interaction, sidebar defaults to device › Appearance, and the tab-indicators deep link to the active server's Interaction.
- [x] 1.3 Add a contract test: for every top-level `TerminalSettings` key, membership of `SERVER_OWNED_TERMINAL_SETTING_KEYS` matches `SETTING_AUTHORITY === 'server'`, excluding keys outside `TerminalSettings` (`macros`, `shellProfiles`, `homeDashboard`). Each path in `DEVICE_OVERRIDE_PATHS` places on the device, and an unknown key is not shown. Verify: the test fails when one list gains a key the other lacks, then passes.
- [x] 1.4 Add `placeForCategory` and the last-place memory: named server-only categories open the active tab's server or the first attached connection; no category reopens the last attached place and category, else the active server, else the device. Verify: unit tests cover Macros from Home, reopening at This Mac › Cursor, and a remembered place that has detached.

## 2. Place-scoped settings writes

- [x] 2.1 Add `updateDevice`, `updateServer` and `resetPlace` to the terminal-settings hook, keeping the merged `update` for other callers. Device pages read the connection-host store directly. Verify: unit tests with a fake `SettingsClient` show that a device update and a device reset make no server call, a server reset leaves the device store unchanged, and a device update succeeds while the client rejects.

## 3. Rail and window

- [x] 3.1 Replace `renderServerSelector` with `places`, `selectedPlaceId` and `onSelectPlace` on `SettingsWindow`. Draw the rail (device tile, divider, server tiles with initial, colour and online mark, Connect a server) and the place header with name, subtitle and search. Verify: `npm run typecheck` passes; an E2E test sees the tiles in order with one selected.
- [x] 3.2 Build the places in `ConnectedWebRendererWorkspace` from the window's attached connections. Wrap every tile change in the pending-macro-edit guard. Verify: E2E "Leaving a server with pending macro edits" asks before switching.
- [x] 3.3 Name the device tile This Mac, This PC or This device by host. Verify: unit test of the naming function for macOS, Windows, Linux and browser.
- [x] 3.4 Place-change behaviour: keep the category when the new place has it, else show the first; key collection selection by place; drop async results for a place no longer selected; select the device when the selected server detaches; keep other tiles usable while one is offline. Verify: unit tests for category retention and for `leavesServerPlace` (the selected server detaching moves to This Mac, another server detaching does not); each async load drops its result when its place is no longer selected.
- [x] 3.5 Filter categories and fields by place, and add the scope line to every page, including the Servers and Import & Export wording. Verify: E2E opens Interaction under This Mac and under a server, finds no field label in both, and reads each page's scope line.
- [x] 3.6 Move the saved servers into a This device › Servers collection with Add server…, and make the server's Remote Access a plain exposure page. Point Connect a server and every Add server entry point at Servers. Verify: E2E opens Servers from the Connect a server tile with the form open, and opens Remote Access with no list column.
- [x] 3.7 Move Import & Export under This device (Desktop only), keeping its menu and Command Bar commands. Verify: the existing Import & Export E2E passes through the new place, and a unit test shows it absent in the browser.
- [x] 3.8 Restrict search to the selected place, including its collections, and keep the query across place changes. Verify: E2E searches "Tab indicators" under This Mac (no result) and under the server (one result), and "pop" under This Mac finds the saved server.
- [x] 3.9 Narrow layout: show the rail as a row above the category list. Verify: E2E at 600 px sees the rail row and the one-column back-navigation still working.
- [x] 3.10 Delete the `ServerSelector` component and its CSS, keeping the `useSelectedServerConnection` hook in `src/shared/ServerSelector.tsx`. Verify: `npm run lint` passes and a grep finds no imports.

## 4. Updates pages

- [x] 4.1 Device Updates: keep the channel, and add the line that it updates Terminay Desktop and its Local server and no other server. Verify: E2E reads the line on Desktop.
- [x] 4.2 Device versions: show Running and Latest on <track> from `AppUpdateStatus` with the check time, covering update available, Up to date, Not checked yet, failed check, and development build. Verify: a component test renders each state with exact version strings.
- [x] 4.3 Server Updates: show the track label, Running and Latest on <track> verbatim (Up to date when nothing newer, no published latest for Source), and the Upgrade action through `ServerUpgradeDialog`. Verify: component tests render a canary status with and without `available` and check both strings verbatim.
- [x] 4.4 Track commands: list `terminay daemon upgrade latest|main|canary` for the other tracks with copy buttons and the `sudo`, `--system`/`--user`, `--allow-downgrade` and container notes. Verify: a component test lists only the other two tracks, and a unit test checks each ref with the CLI's `resolveRef` classification (`latest` → tag, `main` and `canary` → rolling).
- [x] 4.5 Local server and servers without status: identify the Local server with `isLocalConnection`, and show its version, the follow-Desktop line and the link. A remote server without `channel` gets the Source wording, and one without the capability gets the no-track line. Verify: component tests for Local, a remote checkout without `channel`, and a connection without `server.upgrade`.

## 5. Tests, docs and checks

- [x] 5.1 Add an `openSettingsAt(place, category)` helper to `e2e/fixtures.ts` and move the existing Settings, Remote Access, Macros and Import & Export E2E specs onto it. Verify: `npm run test:e2e` passes in Docker.
- [x] 5.2 Update `e2e/settings-visual.spec.ts` screenshots for This Mac › Appearance, This Mac › Updates, a server › Interaction, and a server › Updates, and save copies to the scratchpad for the PR. Verify: the visual spec passes and the screenshots exist.
- [x] 5.3 Update `docs/product-overview.md` and any operations docs that describe the Settings server selector or saved servers under Remote Access. Verify: a grep for "server selector" in `docs/` finds nothing stale.
- [x] 5.4 Run `npm run lint`, `npm run typecheck`, the bounded node tests and `openspec validate --all`. Verify: all pass, apart from failures in other changes that already existed.
