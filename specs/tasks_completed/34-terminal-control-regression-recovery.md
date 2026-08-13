# Terminal control regression recovery

## Contract

- [x] Specify creator-bound initial ownership independent of attachment race order.
- [x] Specify conflict-only, full-width takeover presentation.
- [x] Specify immediate viewport fitting after ownership changes.
- [x] Specify that transient reconnect keeps the connected workspace mounted.

## Server and renderer

- [x] Acquire an unheld presentation atomically during write-authorized attach.
- [x] Keep later attachments read-only without stealing the current holder.
- [x] Hide presentation controls for the holder and holderless observers.
- [x] Render the exact full-width conflict bar for a competing holder.
- [x] Keep the conflict bar opaque and in layout flow so it never covers terminal content.
- [x] Flush a fitted viewport when initial ownership or takeover succeeds.
- [x] Publish controller-owned canonical dimensions and apply them to every observer.
- [x] Keep presentation conflicts out of transport-error recovery UI.
- [x] Scope terminal journal decoding to the exact attachment before validation.
- [x] Return one wire command envelope for acquire, takeover, and renewal while preserving the handler result wrapper required by revision-bearing presentation state.
- [x] Treat queued-write ownership rejection as read-only handoff, not transport failure.
- [x] Pin the canonical PTY emulator environment instead of inheriting host TERM.

## Browser recovery

- [x] Preserve the connected workspace during transient reconnect generations.
- [x] Return to enrollment only for explicit exit or unrecoverable credentials.
- [x] Prove repeated reconnect attempts cannot flash the connection modal.

## Verification and integration

- [x] Add protocol tests for first-owner, observer, takeover, and detach handoff.
- [x] Add renderer tests for hidden local controls and the conflict bar.
- [x] Add geometry coverage for full-panel local sizing and bidirectional post-takeover resize.
- [x] Cover local clear while a browser observer remains attached.
- [x] Run native tests and the Docker Electron E2E suite.
- [x] Push a reviewable pull request and keep PR and post-merge main CI green.
