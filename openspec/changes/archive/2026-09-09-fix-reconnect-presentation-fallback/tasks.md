## 1. Steady recovery surface (`src/web/`)

- [x] 1.1 Decide `recovering` by whether the session has ever connected, keep the last attempt's error visible until an attempt succeeds, and make the loop's callbacks the only owner of phase and error (`main.tsx` no longer sets phase or clears the error inside `connect()`). Verified by unit tests in `scripts/web-session-recovery-retry.test.mjs`: after one connection, three consecutive failed attempts each report `recovering: true`; the error set by a failure is still present when the next attempt starts; a success clears it.
- [x] 1.2 Confirm the connection-state panel never renders the cold-connect heading once connected. Verified by the hosted intermittent-relay scenario (task 4.2) asserting the frame never shows "Connecting to Terminay…" after first connect while attempts fail for 30s.

## 2. Refused resume becomes a fresh presentation (`src/components/`)

- [x] 2.1 Add a pure classifier that turns a `presentation_unavailable` event received by a resume attach into a synthetic recoverable skip (`requestedFromPosition → outputPosition`, reason `attachment_closed`) and returns nothing for a fresh attach. Verified by unit tests in a new `scripts/terminal-presentation-refusal.test.mjs`: resume → skip with those bounds that `isRecoverableSkip` admits; fresh → `undefined`.
- [x] 2.2 Route the synthetic skip into `TerminalRecoveryController.noteEvent` from the attach's initial-events handling, record a `presentation-refused` terminal diagnostic, and leave the fresh-attach case on the error path. Verified by the Electron end-to-end suite (task 3.3) observing the diagnostic and a hydrated display.
- [x] 2.3 Make `presentation_unavailable` retryable: `isTerminalRetryActionable` returns true for it, and the retry action requests a fresh presentation from position zero when the previous attempt was refused. Verified by a unit test on `isTerminalRetryActionable` and by the Electron suite's fresh-unavailable case if the embedded server can be driven into it; otherwise by a unit test over the retry request shape.

## 3. Electron end-to-end proof (`electron/`, `e2e/`)

- [x] 3.1 Read `TERMINAY_TEST_TERMINAL_REPLAY_BYTES` in `electron/main.ts` only when `TERMINAY_TEST=1`, validated as a positive safe integer, and pass it as `maxReplayBytes` to the embedded terminal authority. Verified by a unit test in `scripts/` that the resolver returns the value under the marker, `undefined` without it, and `undefined` for a non-integer.
- [x] 3.2 Thread the override from `e2e/fixtures.ts` for the new spec file only, in the same shape as the persistence-fault knob. Verified by the new spec receiving a 16 KiB window (asserted through the spec reaching the refused-resume path).
- [x] 3.3 Add `e2e/terminal-recovery-beyond-replay-window.spec.ts`: seed a marker, start a sustained flood, fail the Local transport, and require the same terminal session to return as one panel, hydrated, with the `presentation-refused` diagnostic recorded and a new marker streaming after the flood is stopped; the pre-fault marker is not required to survive, since a fresh presentation legitimately starts at the head. Verified by `npm run test:e2e` passing this spec in Docker.

## 4. Hosted end-to-end proof (`terminay.com`, verification only)

- [x] 4.1 Extend the intermittent-relay scenario so the shell prints past the hosted 4 MiB window during the outage. Verified by the scenario failing against the previous client bundle with the dead-end error, and passing against this change.
- [x] 4.2 Assert in that scenario that the frame never shows "Connecting to Terminay…" after first connect. Verified by the scenario failing against the previous client bundle and passing against this change.
- [x] 4.3 Run all three hosted scenarios against this change's `dist-web`. Verified by 3/3 passing with the document and bundle intact and the terminal streaming after each fault.

## 5. Gates and the honest limit

- [x] 5.1 Run `openspec validate --all`, `npm run lint`, `npm run test:connection-menu`, and the new unit suites. Verified by all passing.
- [x] 5.2 Run the full Electron end-to-end suite through `npm run test:e2e` (Docker), not only the new spec. Verified by all shards passing.
- [x] 5.3 State in the PR exactly what was verified and that no phone ran it. Verified by the PR description carrying that sentence, and by the owner's on-device check being listed as the remaining step rather than claimed.
