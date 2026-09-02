## 1. Interactive presentation lease

- [x] 1.1 Define a server-owned lease for exact `{serverId, projectId, sessionId, clientId, attachmentId}` identity with bounded expiry, renewal, release, disconnect cleanup, revocation, and an observable revision, verified by lease protocol tests.
- [x] 1.2 Require explicit user intent to acquire or take over control so attachment, focus, output receipt, reconnect, and background rendering do not silently steal it, verified by silent-steal coverage.
- [x] 1.3 Gate the complete xterm `onData` stream and viewport changes by that lease so non-holders render read-only and send no automatic terminal responses, verified by unauthorized-input tests.
- [x] 1.4 Present controller/read-only state and an accessible takeover action in wide and narrow clients, resolve simultaneous takeover requests deterministically, and audit metadata without recording terminal content, verified by concurrent-takeover tests.
- [x] 1.5 Keep macro, dictation, and MCP writes on their separately authorized ordered server input paths without granting presentation ownership, verified by non-interactive source tests.

## 2. Valid presentation recovery

- [x] 2.1 Select and document a bounded canonical presentation mechanism tied to an exact raw-output position, verified by the recorded presentation contract.
- [x] 2.2 Hydrate a fresh client from a valid checkpoint and deliver subsequent raw output exactly once with no snapshot/live handoff gap, verified by hydration continuity tests.
- [x] 2.3 Never start replay at an arbitrary byte suffix, returning an explicit resync/unavailable presentation state when no valid checkpoint is retained, verified by missing-checkpoint tests.
- [x] 2.4 Bound checkpoint memory, serialization size, generation work, frequency, and per-client hydration queues while treating PTY output as untrusted, verified by bounds tests.
- [x] 2.5 Remove the stale 64-KiB migration assertion and reconcile it with the chosen presentation contract, verified by its absence rather than a changed constant.

## 3. Verification

- [x] 3.1 Add PTY fixtures that query colours, device attributes, status/cursor, window state, focus, and mouse modes with two xterm clients attached, and assert only one response reaches the PTY for each query.
- [x] 3.2 Test lease acquire, renewal, explicit takeover, concurrent takeover, disconnect, expiry, revocation, reconnect, and unauthorized input.
- [x] 3.3 Test checkpoints at every byte boundary around CSI, OSC, DCS, UTF-8, alternate-screen, bracketed-paste, cursor/style, and synchronized-output sequences.
- [x] 3.4 Add Docker-isolated Electron/browser E2E proving both displays remain identical during shell and TUI activity, read-only input is rejected, takeover works, and no control-sequence garbage reaches the shell, run only through `npm run test:e2e`.
