## 1. Lock the complete regression

- [x] 1.1 Exercise real `TerminalService`, `TerminalActivityService`, event journal, server connection, subscription, and a deliberately stalled renderer, verified by the regression running against real composition rather than mocks.
- [x] 1.2 Emit more than 1,024 PTY callbacks before provider authority is claimed, verified by the callback count asserted in the test.
- [x] 1.3 Prove the pre-fix connection closes for the production queue-limit reason, verified by asserting the `connection outbound queue limit reached` close reason on the old path.
- [x] 1.4 Keep the regression deterministic and below five seconds, verified by its measured runtime in the normal unit gate.

## 2. Publish semantic activity

- [x] 2.1 Keep raw-output inactivity deadlines current without publishing one activity event per PTY callback, verified by counting published events under the regression workload.
- [x] 2.2 Publish status, attention, acknowledgement, authority, progress, and exit transitions exactly and preserve snapshot/delta convergence, verified by transition-level assertions.
- [x] 2.3 Cover raw fallback, structured signals, provider claim, acknowledgement, and timeout transitions, verified by the focused activity suite.

## 3. Isolate reconstructible state delivery

- [x] 3.1 Add a bounded keyed latest-value traffic class separate from reliable RPC control and terminal presentation lanes, verified by lane-isolation tests.
- [x] 3.2 Supersede pending state for the same feature/entity key without reordering unrelated keys or consuming reliable control capacity, verified by keyed-supersede tests.
- [x] 3.3 Convert projection congestion into scoped snapshot resynchronization that never closes the application connection, verified by an overflow test asserting `event_resync` and a live connection.
- [x] 3.4 Preserve one ordered transport writer and fair progress across reliable control, state projection, and terminal lanes, verified by ordering and fairness tests.

## 4. Verify the user-visible invariant

- [x] 4.1 While one terminal emits the regression workload, create another terminal and complete workspace queries and commands on the same connection, verified end to end in the regression.
- [x] 4.2 Prove activity converges to the latest authoritative snapshot, verified by post-workload convergence assertions.
- [x] 4.3 Pass focused server/client tests, lint, build, and Docker Electron coverage; projection, activity, and congestion suites remain in the normal build/lint/unit gate, verified by PR #50 and post-merge main run 6749 passing all five Docker Electron shards.

## 5. Close the agent projection gap

- [x] 5.1 Reproduce the production failure through real Codex journal ingestion, agent status, server composition, subscription delivery, and a stalled renderer, verified by proving the old path fails at exactly 1,024 queued frames.
- [x] 5.2 Route every non-terminal subscription event through bounded projection delivery without an event-name fallback to fatal reliable control, verified by the absence of any event-name allowlist in delivery and by generic subscription-pressure tests.
- [x] 5.3 Coalesce full agent snapshots by subscription and preserve ordered delta revisions until bounded resynchronization is required, verified by coalescing and ordering tests.
- [x] 5.4 Reload the authoritative agent snapshot when its subscription receives `event_resync`, verified by a client-side resync test.
- [x] 5.5 Prove the exact regression keeps the connection open and permits a new terminal command after the stalled renderer resumes, verified by the regression assertions.
- [x] 5.6 Cover generic subscription pressure so future feature events cannot silently re-enter the fatal control queue, verified by a feature-agnostic pressure test.
