## 1. Open first, connect second

- [x] 1.1 Give `createWindow` a `remoteProfile` that it connects inside its launch, after loading the loading document, binding the window id and profile before the connection starts. Verify with the Desktop TypeScript check and the E2E test in 2.1.
- [x] 1.2 Abort each launch attempt's connection when its window closes, passing the signal to `openDesktopRemoteLanes`, and close any transport whose result arrives after the window closed or whose mount fails. Verify by reading the launch path's every await for a destroyed-window check, and with the Desktop TypeScript check.
- [x] 1.3 Keep the requested route per auxiliary window in main; a repeat request for a window still on its loading document replaces the route and focuses it, and the mount reads the route. Verify with the E2E test in 2.1.
- [x] 1.4 Close the window and record a diagnostic when the packaged workspace bundle cannot be prepared; show launch recovery with Retry for connection and mount failures. Verify by reading the error paths and with the Desktop TypeScript check.
- [x] 1.5 Create the auxiliary window before connecting in `presentCanonicalAuxiliaryRoute`. Verify with the E2E test in 2.1.

## 2. Prove it

- [x] 2.1 Make the E2E child-window helpers wait past the loading document, and add an E2E test that Settings is visible on the loading document before its workspace document starts loading, that a second request during loading for the Extensions section yields one window that opens at Extensions, and that Settings then shows. Verify by running it through `npm run test:e2e`.
- [x] 2.2 Run the new test and the Settings-opening E2E specs through `npm run test:e2e`, the Desktop TypeScript check, the source-shape tests that read the auxiliary path, and `openspec validate --all`. Verify each passes, or fails only as it does on `main`, and record the results.
  Results (2026-11-24): `npm run test:e2e` for `auxiliary-window-loading`, `settings-update-channel`, `app` and `mcp-install-targets`: 21 passed. Desktop `tsc --noEmit`: no errors in `electron/` or `e2e/`. The four source-shape suites that read the auxiliary path: 10 pass, 8 fail, the same 8 and for the same reasons as on `main`. `openspec validate` for this change with `--strict`: valid; `--all` fails only in other in-flight changes, as on `main`.
- [x] 2.3 Open Settings from a Desktop window paired with a real standalone server. Verify with the E2E test in `e2e/desktop-loopback-standalone-pairing.spec.ts` that the window is visible on the loading document before its workspace document loads, that Settings then shows, and that the project window stays on the server. Result (2026-11-24): passed through `npm run test:e2e`.
- [ ] 2.4 Open Settings from a window on a remote server in a packaged macOS build. Verify the window appears at once with the loading dots, then the Settings page.

Review follow-up (2026-11-24): fixed remote partition/profile selection,
first-paint ordering, before/after-commit route races, failed-mount endpoint
cleanup, unsafe-bundle closure when diagnostics fail, and cancellable identity
discovery with Retry. Made the repeat-request E2E deterministic and excluded
`about:blank` in child-window helpers. Focused Node suites: 40 passed, including
11 launch/partition/queue cases. Docker E2E: 41 passed across
`auxiliary-window-loading`, `app`, `settings-update-channel`, `mcp-install-targets`,
`settings` and `performance-log-window`. The final remote-only identity-discovery
fix was checked by the subsequent Node run and Desktop TypeScript check.
Change validation with `--strict` passed. Full validation has the same 13 failing
changes as a temporary export of `main`; the four source-shape suites have the
same eight failing tests and expected expressions as `main`. Task 2.3 is still
unverified. See `verification.md` for findings and verification limits.
