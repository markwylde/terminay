## Why

A remote session could connect, hydrate a terminal checkpoint, and then never
stream again while still reporting itself connected. The cause is
cross-connection teardown keyed on device identity: a reconnect creates a second
connection with the same `clientId`, the zombie connection is never closed, and
its eventual cleanup detaches every attachment for that device — including the
healthy replacement's. The stall-inference machinery built around the symptom
made the connection layer more configurable without making it correct.

## What Changes

- Scope connection teardown by connection, not by device: closing a connection
  releases only its own attachments, subscriptions, leases, and checkpoints.
  Device identity keeps governing authentication, permissions, revocation, and
  presentation-lease arbitration.
- **BREAKING** A successful pairing or `device-join` replaces the device's
  existing peer, closing and cleaning up the old connection before accepting the
  replacement. At most one live connection per device exists on the host.
- Replace all traffic-pattern stall inference with an explicit
  application-protocol heartbeat: a 10-second client ping, generation retirement
  after two consecutive misses, and server-side reaping of any connection with 60
  seconds of inbound silence.
- Restore required-lane close as a real generation failure, with the heartbeat as
  the backstop for half-open transports that never fire a close event.
- Make attachment detach observable: an explicit attachment-closed event on the
  control class whenever the server detaches for any reason other than the
  client's own detach request.
- Clear the `resyncPending` and `outputSuppressed` latches so congestion recovery
  works repeatedly on one connection.
- Delete the unreachable headless `node-datachannel` host wiring and the
  superseded stall/silence tests.
- Keep the Secure-Werift runtime and its supply-chain governance; the SCTP
  zero-window probe is fixed separately so an artifact change does not ride
  inside a behavioural change.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: one live connection per device, explicit generation liveness
  signals, heartbeat liveness, and live-stream integrity after hydration.
- `terminal-stream-congestion-and-recovery`: connection-scoped attachment
  lifetime, heartbeat-based liveness detection, explicit attachment closure, and
  the prohibition on silent latches.

## Impact

- `packages/server-core` connection and terminal-service lifecycle, outbound
  delivery, and the operation registry (`connection.ping`).
- `apps/terminay-server/src/remote` hosted pairing host and peer lifecycle.
- `electron/remote` exposure wiring.
- `src/web` and `src/remote` client recovery state machines.
- Deleted: headless `node-datachannel` host modules, `HostedGenerationSet`,
  stall-classification diagnostics, session silence watches, and their tests.
- Out of scope: pairing and enrollment flows, device revocation, signed transport
  transcripts, UI archive transfer, and the signaling room protocol.
