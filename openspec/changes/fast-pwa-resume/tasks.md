## 1. Reproduction

- [x] 1.1 Add a `silenceLanes` fault to `terminay.com/specs/e2e/support/sessionFaults.mjs` that stops lane delivery without closing anything, and a test in `session-reconnect.test.mjs` that silences, suspends, resumes, and requires a live replacement generation within 3 seconds. Verified: with only the resume probe in place it missed the original 5 second deadline (6.85 s: loss declared 1.5 s after resume, then 5.0 s between the server's `client-join` and ICE checking). The `main` checkout has no web build to run it against, so that comparison is the recorded baseline
- [x] 1.2 Fake-clock unit tests for the resume probe in `scripts/web-session-heartbeat-reconnect.test.mjs`. They call `probeNow`, which the old heartbeat does not have, so they cannot pass against it

## 2. Detection and handshake

- [x] 2.1 `probeNow({ deadlineMs, decisive })` in `createSessionHeartbeat`, superseding any probe in flight. Verified by 1.2 and the existing heartbeat tests (14 pass)
- [x] 2.2 `ConnectionEntry.resume()` sends the decisive 1.5 second probe and tracks hidden time through `suspend()`. Verified by `scripts/connection-registry-resume.test.mjs` (3 pass) and `scripts/connection-registry.test.mjs`
- [x] 2.3 `startPeer` in `hostedPairingHost.ts` returns once the offer is in place (`have-local-offer`) instead of after werift's candidate gather, which waits 5 seconds for each address that cannot reach STUN. Verified by 6.2 and the `@terminay/server` tests (561 pass)

## 3. Timings

- [ ] 3.1 Optional `connectTimings` on the session host contract, validated in `getSessionTransportHost` and `isHostedBrowserSessionAuthority`. Typechecks and is exercised by 6.2; no contract unit test yet
- [x] 3.2 The registry marks detection, attempt start, transport open, hello and ready, builds a sample, and sends `connection.metrics.record` when the hello advertises `connection.metrics.v1`. Verified by `scripts/connection-registry-resume.test.mjs` with a fake client
- [x] 3.3 `terminay.com` session host records signaling, ICE, lane, device and application authentication durations per generation and exposes `connectTimings`. Verified by `specs/sessionTransportHost.test.mjs` (243 pass in `specs/`)

## 4. Server store

- [x] 4.1 `packages/server-core/src/connectionMetrics/`: sample validation, bounded JSON-lines store, summary, and the `connection.metrics.record`, `.summary` and `.clear` operations, gated on `remoteAccess.connectionMetrics`. Verified by `packages/server-core/test/connection-metrics.test.mjs`
- [x] 4.2 Compose it in the standalone server and Desktop's embedded server with a data-root file, and advertise `connection.metrics.v1`. Verified by `typecheck:workspaces` and the composition test in 4.1
- [ ] 4.3 `remoteAccess.connectionMetrics` server default, client settings definition and normalisation. Typechecks; no dedicated settings test yet

## 5. Surfaces

- [ ] 5.1 Settings > Remote shows the summary under the setting, with Clear. No component test or e2e yet
- [x] 5.2 `get_connection_metrics` MCP tool in Read Settings with workspace reach, in the server MCP and Desktop's MCP. Verified by the MCP permission, app-control and stdio tests

## 6. Verification

- [x] 6.1 `openspec validate --all`, typecheck, lint, and the unit suites pass
- [x] 6.2 The hosted reproduction from 1.1 passes against this worktree, along with the other three tests in `session-reconnect.test.mjs`. Three runs: live again 1771, 1785 and 1768 ms after resume; host steps signal ≈ 20 ms, ICE ≈ 75 ms, lanes ≈ 15 ms, device auth ≈ 88 ms, application auth ≈ 1 ms. The remaining ≈ 1.5 s is the resume probe deadline
- [ ] 6.3 Pull request checks green on both repositories
