## 1. Separate projection reads from live observation

- [x] 1.1 Make `activity.snapshot` and `activity.delta` return committed activity projection state without starting or awaiting host foreground-process inspection, verified by a server-core test with a deliberately slow resolver
- [x] 1.2 Preserve exact project filtering, ordered activity events, and snapshot resynchronization semantics, verified by the existing activity protocol suites
- [x] 1.3 Extend the canonical activity projection with exact-session foreground observation `available`/`limited` state, verified without deriving idle or busy from raw output

## 2. Bound and coalesce foreground-process observation

- [x] 2.1 Give each exact terminal session one running foreground sample and at most one replaceable latest pending sample, verified by scheduler tests
- [x] 2.2 Ensure continued PTY output supersedes obsolete pending sampling work and cannot require complete output silence before the current sample settles, verified with a continuously emitting producer
- [x] 2.3 Apply a named bounded deadline and cancellation path to close-time target observation while retaining privileged process inspection in the owning environment/host boundary, verified by deadline tests
- [x] 2.4 Contain a slow, failed, or unsupported observation to its own session and publish only safe metadata/state, verified by asserting unrelated sessions are unaffected

## 3. Scope destructive close protection

- [x] 3.1 Replace the global activity refresh in terminal-panel close with an exact `{serverId, projectId, sessionId}` close preflight or equivalent server-owned command result, verified by the close path issuing no global refresh
- [x] 3.2 Keep project close aggregation limited to the project's canonical sessions and verify terminal close checks are not widened to siblings, views, or the full server
- [x] 3.3 Present a clear limited-state close confirmation defaulting to **Keep Running** when target observation reaches its deadline or is unavailable, verified by asserting the control never waits indefinitely and never assumes idle from stale data
- [x] 3.4 Preserve canonical workspace panel removal, PTY termination, and confirmation behaviour after the target decision completes, verified by the existing close suites

## 4. Lock the regressions

- [x] 4.1 Add a deterministic server-core test with a deliberately slow foreground-process resolver and continuing output, proving observation work is bounded and latest-wins and settles without stopping the producer
- [x] 4.2 Prove an activity snapshot and an unrelated terminal close do not await that session's slow observation
- [x] 4.3 Add Docker Electron coverage with two terminal tabs, one continuously emitting while the other closes through its tab X, proving the close completes within the bounded control deadline and the noisy terminal remains live
- [x] 4.4 Cover target busy, target idle, target observation timeout, project-close aggregation, and provider capability-limited cases
