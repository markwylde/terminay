## 1. Pin the reproduction

- [x] 1.1 Land the reproduction suite in `terminay.com` (`specs/e2e/session-reconnect.test.mjs`, `specs/e2e/support/sessionFaults.mjs`, and the match-code pairing the harness in `specs/e2e/support/terminayServer.mjs` now needs). Verified by running the suite against an unmodified stack: all three scenarios fail on "Session transport closed during connect." and the shell's phase trace shows the replacement generation stalled at `authenticating`.
- [x] 1.2 Record that trace as the change's evidence under `openspec/adr/evidence/`. Verified by the file existing and naming the generation that reached `connected/connected` with four open lanes and was never claimed.

## 2. Session-origin reconnect hand-off (`terminay.com`)

- [x] 2.1 Make endpoint state part of generation usability in `app/src/sessionTransportHost.js`: a generation whose application endpoint is closed or failed is not usable. Verified by a unit test in `specs/` that seeds a current, unretired generation with a closed endpoint and asserts the usability check rejects it.
- [x] 2.2 Make `connect()` replace an unusable generation and resolve with the replacement's endpoint, joining an in-flight replacement rather than starting a second one. Verified by a unit test where `connect()` is called against a current generation with a closed endpoint and resolves with an open endpoint from a new generation, and by a second test where two concurrent calls produce exactly one replacement.
- [x] 2.3 Confirm the workspace client is never handed a closed transport, whichever side detects the loss first. Verified by the dropped-lanes scenario of the reproduction suite passing.

## 3. Persistent workspace recovery (`src/web/`)

- [x] 3.1 Add bounded backoff scheduling to the connect gate in `src/web/sessionConnectAttempt.ts`, with the delay sequence and its clock injectable the way the existing attempt deadline is. Verified by unit tests over the schedule: growth, ceiling, jitter bounds, and cancellation when a newer generation supersedes an attempt.
- [x] 3.2 Schedule a further attempt when a recovery attempt fails or times out in `src/web/main.tsx`, instead of clearing the connection and waiting for a person. Verified by a unit test that fails the first attempt and asserts a second one is scheduled without any user action.
- [x] 3.3 Keep the reconnecting state visible across retries, showing the last attempt's error, and keep **Retry connection** as "attempt now". Verified by a unit test asserting the phase stays `reconnecting` across two failed attempts and that the retry action starts an attempt immediately rather than waiting out the backoff.
- [x] 3.4 Stop retrying for failures a retry cannot fix — missing or revoked device identity, host-key mismatch — and keep their existing terminal presentation. Verified by a unit test per failure class asserting no further attempt is scheduled.
- [x] 3.5 Pause attempts while the document is hidden and resume on becoming visible. Verified by a unit test that no attempt is scheduled while hidden and one runs immediately on becoming visible.

## 4. Immediate liveness on foreground (`src/web/`)

- [x] 4.1 Probe liveness as soon as the document becomes visible rather than waiting for the next heartbeat interval, entering recovery when the probe fails. Verified by a unit test where a dead transport plus a visibility change starts recovery without advancing the heartbeat interval, and a second test where an answered probe changes nothing.

## 5. Prove it end to end

- [x] 5.1 Run the reproduction suite against both halves. Verified by all three scenarios passing: the workspace reconnects, the document and installed bundle survive, and the terminal streams new output after each fault.
- [x] 5.2 Confirm no duplicate state after recovery. Verified by the reconnected session holding one terminal panel per session with the pre-fault output intact, as the suite asserts.
- [x] 5.3 Run `openspec validate --all`, `npm run lint`, and the workspace unit suites. Verified by all three passing.
