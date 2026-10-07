## 1. Suspend-tolerant liveness deadlines

- [x] 1.1 Server: in `packages/server-core/src/connection.ts`, record the wall-clock arm time in `noteInboundFrame`; when the timer fires with an overshoot above the tolerance (`min(5 s, deadline / 2)`, overridable beside `heartbeatTimeoutMs`), re-arm one full deadline instead of failing the connection. Verified by new cases in `packages/server-core/test/connection-scoped-lifecycle.test.mjs` that drive a late timer with an injected clock: the connection survives the late fire, survives when the client then pings, and is reaped when the fresh deadline elapses on time.
- [x] 1.2 Server: confirm the existing "goes silent is reaped; never promised is not" and "heartbeat keeps an idle connection alive" cases still pass unchanged. Verified by `npm run test --workspace @terminay/server-core`.
- [x] 1.3 Client: in `src/web/sessionConnectAttempt.ts`, record the arm time of the probe deadline in `createSessionHeartbeat`; a probe whose deadline fired late is not counted as a miss and the next probe is sent immediately. Verified by new cases in `scripts/web-session-heartbeat-reconnect.test.mjs` using its hand-driven clock: a frozen document with an answering peer is never reported lost; a frozen document with a dead peer is reported lost after the miss limit of on-time probes.
- [x] 1.4 Run the connection test group. Verified by `npm run test:connection-menu` passing.

## 2. Desktop byte endpoint close reaches the window

- [x] 2.1 Add a Desktop E2E case to `e2e/local-application-connection-recovery.spec.ts` that makes the embedded server close the window's connection and asserts the window's connection leaves `ready` and returns to it in well under one heartbeat interval. Run it before any fix and record in this file which hop drops the close (Chromium port close, preload hand-off, or `ServerScopedMessagePort`). Verified by the case failing for the recorded reason under `npm run test:e2e`.
  - Finding (2026-10-07): the preload hand-off drops it. `electron/serverUiPreload.ts` wired `onmessage` and `onmessageerror` on the byte port and no `close` listener, so the page's byte bridge was never told the endpoint ended. Before the fix the case observed no loss within 30 s; Chromium does deliver `close` across the process boundary, so design decision 2 option 1 applies and no host-bridge message is needed.
- [x] 2.2 Fix the hop identified in 2.1 following design decision 2: wire the port `close` through, or, only if Chromium does not deliver it, have the Desktop host report the closed endpoint over the existing host bridge. Verified by the 2.1 case passing under `npm run test:e2e`.
- [x] 2.3 Add unit coverage that a `ServerPortTransport` whose far end closes leaves `open`, rejects pending reads, and rejects a later `send`. Verified by a new case in `scripts/server-port-transport.test.mjs`.

## 3. Interrupted project creation resolves itself

- [x] 3.1 Add a pure resolver beside `src/workspace/projectTabModel.ts` that, given the error from a creation step and the resynchronised snapshot, returns continue, resend, or fail, with the attempt bound from design decision 3. Verified by a new `src/workspace/projectCreationRecovery.test.ts` covering: committed, not committed, refused by the server, attempts exhausted, connection unreachable.
- [x] 3.2 Use the resolver in `createServerProject` in `src/App.tsx`: on a lost connection keep the pending tab loading, wait for the owning connection's registry entry to be ready and its workspace store to resynchronise, then continue or resend with the same `projectId`; apply the same rule to the terminal-launch step. Verified by 3.4.
- [x] 3.3 Replace the raw outcome-unknown text with the plain message from design decision 3 when recovery gives up. Verified by a resolver test asserting the message contains no command or session identifier.
- [x] 3.4 Invert `scripts/wake-reaped-renderer-connection.test.mjs`: with task 1.1 in place the server no longer reaps across the simulated sleep and the creation succeeds on the original connection; add a second case that force-closes the connection mid-command and asserts the resolver path yields exactly one project in both commit orderings. Verified by `node --test --experimental-strip-types scripts/wake-reaped-renderer-connection.test.mjs`, and by adding that file to the `test:connection-menu` script so CI runs it.

## 4. A failed pending tab does not hold the window

- [x] 4.1 In `src/App.tsx`, stop `isPendingProjectFailure` from overriding `activeProject` and `displayedActiveProjectId`; make the failed pending tab a selectable tab that is selected on failure and renders its error only while selected. Verified by 4.4.
- [x] 4.2 Enable `+` and the new-project commands while a creation has failed (disabled only while one is in flight); starting a creation replaces the failed pending tab. Verified by 4.4.
- [x] 4.3 Add Retry and Dismiss actions to the failed pending tab's body; Retry re-runs the creation in place. Verified by 4.4.
- [x] 4.4 Add cases to `e2e/project-tabs.spec.ts` for a creation the server refuses: another project tab can be selected and used; `+` starts a new creation that replaces the failed tab; Retry returns the tab to loading; Dismiss removes it. Verified by `npm run test:e2e` with the existing project-tab cases still passing.

## 5. Close out

- [x] 5.1 Run `npm run lint`, the type check, and `npm run test:ci`. Verified by all three exiting zero.
- [x] 5.2 Run `openspec validate --all`. Verified by it reporting no errors.
- [x] 5.3 Open the pull request on `origin` with `tea` and read back every commit status on the head SHA. Verified by each status being `success` or `skipped`.
