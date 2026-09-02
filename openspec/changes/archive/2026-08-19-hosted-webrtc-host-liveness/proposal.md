## Why

The production hosted pairing host created peers with an empty ICE server list,
had no peer or ICE state machine, and ran signaling handlers concurrently
against one handshake peer. Live peers were closed only when the application
data channel fired `close`, so ICE `disconnected` with channels still `open`
left the server-side connection running while the browser stopped receiving
events.

## What Changes

- Apply the same STUN and TURN list to the host that the browser receives for
  that exposure. An empty host ICE set with client-only STUN and TURN is no
  longer a production path.
- Evaluate peer and ICE state on each connected peer, start one bounded grace
  period for a recoverable `disconnected`, and replace or close that peer once
  on `failed`, `closed`, or grace expiry without affecting other live clients
  or PTYs.
- Serialize `client-join` and `device-join` for one signaling socket: a second
  join retires an incomplete handshake only, an already authenticated connected
  peer stays up, and answers and ICE candidates apply only to the current
  handshake generation.
- Keep application-protocol reader completion as failure of that peer
  generation, and cover the case where ICE goes `disconnected` while the
  application lane stays `open`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: ICE candidate policy on the exposing host, handshake
  serialization, and peer generation liveness.

## Impact

`apps/terminay-server/src/remote/hostedPairingHost.ts` — the production Werift
`startHostedPairingHost` path used by both Desktop expose and
`terminay-server`. Focused host tests cover ICE grace, ICE-server wiring, and
join serialization.
