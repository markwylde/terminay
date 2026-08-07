# WebRTC transient disconnect recovery

## Goal

Keep an authenticated browser workspace live across recoverable WebRTC ICE
interruptions and close it exactly once only when recovery becomes terminal.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)

## Current gap

The privileged WebRTC host independently treats peer and ICE `disconnected`
events as permanent failures. Either callback immediately detaches the
canonical application and terminal channels even though WebRTC may return to
`connected`. The server-owned workspace and PTY remain current, so refreshing
the browser creates a new connection and catches up before the next transient
disconnect freezes live delivery again.

## Implementation slices

### Lifecycle authority

- [x] Introduce one connection-scoped authority that evaluates combined peer
  and ICE state.
- [x] Start one bounded recovery grace period for recoverable `disconnected`
  state and cancel it when transport health returns.
- [x] Close immediately for explicit `failed` or `closed` state and close once
  when the grace period expires.
- [x] Cancel pending recovery during normal host cleanup without publishing a
  second close.

### Verification

- [x] Reproduce an authenticated session entering ICE `disconnected`, returning
  to `connected`, and continuing on its original application and terminal
  channels.
- [x] Prove a disconnect that outlasts the grace period closes once.
- [x] Preserve immediate permanent-failure and revocation behavior.
- [x] Run the focused host tests and Docker-isolated Electron E2E suite.

## Acceptance checks

- A transient ICE disconnect does not detach application or terminal traffic.
- Recovery uses the existing authenticated peer and does not recreate a PTY or
  application session.
- A permanent failure or expired recovery grace period closes the affected
  connection exactly once.
- Local Desktop and other remote clients remain unaffected.

## Definition of done

The lifecycle authority, regression coverage, focused host suite, and relevant
Docker Electron E2E coverage pass, and this task is moved to
`tasks_completed/`.
