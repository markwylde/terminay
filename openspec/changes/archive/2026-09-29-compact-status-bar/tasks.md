## 1. Settings

- [x] 1.1 Add the device-local `showStatusBarCompact` setting, default `false`, normalised like `showStatusBar`. Verified by `terminalSettings.statusBar.test.ts`.

## 2. Workspace

- [x] 2.1 Derive visibility from the preference for the layout in effect, toggle that preference from **Show Status Bar**, and publish the effective visibility to the browser host's View menu. Verified by `e2e/compact-status-bar.spec.ts`.

## 3. Verification

- [x] 3.1 `npm run lint`, typecheck, unit tests and `openspec validate --all` pass. Verified by command output.
