# Production WebRTC host liveness

## Goal

Make the exposing Terminay host treat ICE/peer liveness, one handshake, and
the advertised STUN/TURN set as part of a live generation. A browser that
hydrates then goes silent must not keep an authenticated application
connection that can no longer send.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)
- Hosted contract: `terminay.com` `specs/remote.md`

Related history: Task 39 (ICE grace in the Chromium test host) and Task 41
(single-owner generations). This task is the production Werift
`startHostedPairingHost` path used by Desktop expose and `terminay-server`.

## Current gap

`apps/terminay-server/src/remote/hostedPairingHost.ts` creates peers with
`iceServers: []`, has no peer/ICE state machine, and runs signaling handlers
concurrently against one `handshakePeer`. Live peers are closed only when the
application data channel fires `close`. ICE `disconnected` with channels still
`open` leaves the server-side `ServerConnection` running while the browser
stops receiving events.

## Implementation slices

- [x] Apply the same STUN/TURN list the browser receives for that exposure.
      Empty host ICE plus client-only STUN/TURN is not a production path.
- [x] Evaluate Werift peer and ICE state on each connected peer. Start one
      bounded grace period for recoverable `disconnected`. Replace/close that
      peer once on `failed`, `closed`, or grace expiry. Do not close other
      live clients or PTYs.
- [x] Serialize `client-join` / `device-join` for one signaling socket. A
      second join retires an incomplete handshake only. An already
      authenticated connected peer stays up. Answers and ICE candidates apply
      only to the current handshake generation.
- [x] Keep application-protocol reader completion as failure of that peer
      generation (already required by Task 43). Add a host test where ICE
      goes `disconnected` while the application lane stays `open`.

## Acceptance checks

- Host and browser share the configured ICE servers on a production-like
  exposure.
- ICE `disconnected` either recovers inside grace or closes that one
  application connection once.
- Two overlapping `device-join` messages create at most one live handshake
  and do not attach an answer to a retired peer.
- Local Desktop and other remote clients remain unaffected.

## Definition of done

Focused host tests cover ICE grace, ICE-server wiring, and join serialization.
This file moves to `tasks_completed/`.
