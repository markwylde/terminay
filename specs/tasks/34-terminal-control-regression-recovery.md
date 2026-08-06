# Terminal control regression recovery

## Contract

- [x] Specify silent initial ownership for the first write-authorized attachment.
- [x] Specify conflict-only, full-width takeover presentation.
- [x] Specify immediate viewport fitting after ownership changes.
- [x] Specify that transient reconnect keeps the connected workspace mounted.

## Server and renderer

- [x] Acquire an unheld presentation atomically during write-authorized attach.
- [x] Keep later attachments read-only without stealing the current holder.
- [x] Hide presentation controls for the holder and holderless observers.
- [x] Render the exact full-width conflict bar for a competing holder.
- [x] Flush a fitted viewport when initial ownership or takeover succeeds.
- [x] Keep presentation conflicts out of transport-error recovery UI.

## Browser recovery

- [x] Preserve the connected workspace during transient reconnect generations.
- [x] Return to enrollment only for explicit exit or unrecoverable credentials.
- [x] Prove repeated reconnect attempts cannot flash the connection modal.

## Verification and integration

- [x] Add protocol tests for first-owner, observer, takeover, and detach handoff.
- [x] Add renderer tests for hidden local controls and the conflict bar.
- [x] Add geometry coverage for full-panel local sizing and post-takeover resize.
- [x] Run native tests and the Docker Electron E2E suite.
- [ ] Push a reviewable pull request and keep PR and post-merge main CI green.
