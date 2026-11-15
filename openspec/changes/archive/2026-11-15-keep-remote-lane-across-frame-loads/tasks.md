## 1. Fix

- [x] 1.1 In `electron/serverUiDocumentEndpoint.ts`, ignore `did-start-loading` unless `sender.isLoadingMainFrame()`. Verified by task 3.1.

## 2. Diagnostics

- [x] 2.1 Add `onLaneReplaced(reason)` to the remote binding, called with `document-reload`, `transport-ended`, `transport-failed` or `reconnect-retry` wherever it replaces a lane. Verified by type-check.
- [x] 2.2 In `electron/main.ts`, record `remote.document-lane.replaced` with the reason and window id; add the event to `electron/diagnostics/core.ts`. Verified by type-check.
- [x] 2.3 In `apps/terminay-server/src/remote/hostedDiagnosticLog.ts`, share one line writer and add `createServerConnectionLogger(logSink, route)`, logging only `failure` and `closed`. Verified by task 3.2.
- [x] 2.4 Wire it into hosted `acceptApplication` in `cli.ts` and, through a new `onConnectionDiagnostic` option, into `createLocalUiServer`. Verified by type-check.

## 3. Tests

- [x] 3.1 `scripts/remote-endpoint-reconnect-retry.test.mjs`: a frame load keeps the lane (failed before 1.1); a document reload gets a fresh lane. Verified by the tests passing.
- [x] 3.2 `apps/terminay-server/test/hosted-stream-diagnostics.test.mjs`: the connection logger records endings by route and nothing else. Verified by the test passing.
- [x] 3.3 `e2e/desktop-remote-large-app-windows.spec.ts`: Desktop on a standalone server opens four large app windows, then switches away and back, reloads and relaunches, with a working terminal each time (failed 3/3 before 1.1). Verified by `npm run test:e2e`.

## 4. Checks

- [x] 4.1 `openspec validate --all`, type-checks of `tsconfig.node.json` and `apps/terminay-server`, and `npx biome check` on the changed files. Verified by no new errors.
