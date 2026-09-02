## 1. Contract

- [x] 1.1 Specify creator-bound initial ownership independent of attachment race
  order, verified by the written contract and the protocol tests below
- [x] 1.2 Specify conflict-only, full-width takeover presentation, verified by the
  renderer tests below
- [x] 1.3 Specify immediate viewport fitting after ownership changes, verified by
  the geometry coverage below
- [x] 1.4 Specify that a transient reconnect keeps the connected workspace
  mounted, verified by the browser recovery tests below

## 2. Server and renderer

- [x] 2.1 Acquire an unheld presentation atomically during a write-authorized
  attach, verified by first-owner protocol tests
- [x] 2.2 Keep later attachments read-only without stealing from the current
  holder, verified by observer protocol tests
- [x] 2.3 Hide presentation controls for the holder and for holderless observers,
  verified by renderer tests
- [x] 2.4 Render the exact full-width conflict bar for a competing holder,
  verified by renderer tests
- [x] 2.5 Keep the conflict bar opaque and in layout flow so it never covers
  terminal content, verified by renderer layout assertions
- [x] 2.6 Flush a fitted viewport when initial ownership or takeover succeeds,
  verified by geometry coverage
- [x] 2.7 Publish controller-owned canonical dimensions and apply them to every
  observer, verified by bidirectional post-takeover resize coverage
- [x] 2.8 Keep presentation conflicts out of transport-error recovery UI,
  verified by renderer tests
- [x] 2.9 Scope terminal journal decoding to the exact attachment before
  validation, verified by protocol tests
- [x] 2.10 Return one wire command envelope for acquire, takeover, and renewal
  while preserving the handler result wrapper required by revision-bearing
  presentation state, verified by protocol tests
- [x] 2.11 Treat queued-write ownership rejection as a read-only handoff rather
  than a transport failure, verified by protocol tests
- [x] 2.12 Pin the canonical PTY emulator environment instead of inheriting the
  host `TERM`, verified by terminal launch tests

## 3. Browser recovery

- [x] 3.1 Preserve the connected workspace during transient reconnect
  generations, verified by browser recovery tests
- [x] 3.2 Return to enrollment only for explicit exit or unrecoverable
  credentials, verified by browser recovery tests
- [x] 3.3 Prove repeated reconnect attempts cannot flash the connection modal,
  verified by repeated-attempt coverage

## 4. Verification and integration

- [x] 4.1 Add protocol tests for first-owner, observer, takeover, and detach
  handoff
- [x] 4.2 Add renderer tests for hidden local controls and the conflict bar
- [x] 4.3 Add geometry coverage for full-panel local sizing and bidirectional
  post-takeover resize
- [x] 4.4 Cover local clear while a browser observer remains attached
- [x] 4.5 Run the native tests and the Docker Electron E2E suite
- [x] 4.6 Push a reviewable pull request and keep PR and post-merge main CI green
