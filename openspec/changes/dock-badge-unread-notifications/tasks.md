## 1. Protocol

- [x] 1.1 Add the `badge.count.set` host action with an integer `count` in `0..9999` to `packages/protocol/src/host.ts`, including its parser branch and its place in the action classification. Verified by new cases in `packages/protocol/test/host.test.mjs` accepting 0, 3, and 9999 and rejecting negative, fractional, non-numeric, missing, and over-bound counts and unknown extra fields.

## 2. Desktop host

- [x] 2.1 Add `electron/appBadge.ts`: a tracker with `set(windowId, count)`, `clear(windowId)`, and `total()` that calls an injected `setBadgeCount` only when the total changes. Verified by a Node test in `scripts/` covering one window, two windows summing, clearing one of two, clearing to zero, and no native call on an unchanged total.
- [x] 2.2 Handle `badge.count.set` in `onHostAction` in `electron/main.ts`, attributing the count to the bound window's web contents and wiring the tracker to `app.setBadgeCount`. Verified by `npm run typecheck` passing with the action switch handling the new type.
- [x] 2.3 Clear a window's contribution on `closed`, on main-frame navigation or reload, and on `render-process-gone`, and set the badge to zero during quit. Verified by a test seam under `TERMINAY_TEST` exposing the last badge total, asserted in an e2e scenario that closes a window holding a notification.
- [x] 2.4 Confirm the packaged Linux build's desktop entry name matches the one Electron uses for the launcher signal, setting it explicitly if it does not. Verified by comparing the built `.desktop` file name against the desktop name Electron resolves and recording the result in this change.
  - Result: they did not match. With no `desktopName`, Electron 42 announces `Terminay.desktop` (from `productName`) while electron-builder installs `terminay.desktop` (from `executableName`). `package.json` now pins `"desktopName": "terminay.desktop"`, which Electron uses for the launcher signal and electron-builder uses for the entry's file name and `StartupWMClass`. Read from `app-builder-lib`'s `LinuxTargetHelper`; no Linux package was built or run on a desktop here.

## 3. Renderer

- [x] 3.1 Add `setApplicationBadgeCount(count)` to `src/host/nativeActions.ts`: a no-op without the Desktop bridge and tolerant of a host that rejects the action. Verified by a unit test for the no-bridge and rejecting-host cases.
- [x] 3.2 Report `terminalActivityItems.notificationCount` from `src/App.tsx` in an effect on mount and on change. Verified by an e2e scenario: a terminal finishing unviewed raises the host's badge total to 1, and dismissing it returns the total to 0, with the header number matching at each step.

## 4. Validation

- [x] 4.1 Run lint, typecheck, and the unit suites. Verified by each command exiting zero.
- [x] 4.2 Run `npm run test:e2e` for the affected suites. Verified by them passing.
- [ ] 4.3 Check the macOS Dock by eye in a development run: the badge appears with a notification, tracks dismissal, and disappears at zero and on quit. Verified by a screenshot of the Dock tile showing the count.
- [x] 4.4 Run `openspec validate --all`. Verified by it reporting no errors.
- [ ] 4.5 Open the pull request on `origin` with `tea` and read back every commit status. Verified by every status being `success` or `skipped`.
