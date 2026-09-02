## Context

See proposal.md. This is the production Werift path, distinct from earlier work
that added ICE grace in the Chromium test host and that established
single-owner transport generations. Those established the model; this change
applies it to the host that Desktop expose and the standalone server actually
run.

## Goals / Non-Goals

Goals:
- A browser that hydrates and then goes silent must not keep an authenticated
  application connection that can no longer send.
- Host and browser share the configured ICE servers on a production-like
  exposure.

Non-Goals:
- Changing the browser-side transport generation model.

## Decisions

### Host ICE matches browser ICE

The host applies the same STUN and TURN list the browser receives for that
exposure. Empty host ICE combined with client-only STUN and TURN was
producing routes that only appeared to work.

### Liveness is a property of the generation

Werift peer and ICE state is evaluated on each connected peer. A recoverable
`disconnected` starts one bounded grace period. On `failed`, `closed`, or grace
expiry, that peer is replaced or closed exactly once. Other live clients and
their PTYs are untouched. Application-protocol reader completion remains a
failure of that peer generation, so the data channel is not the only signal.

### One handshake at a time

`client-join` and `device-join` are serialized for one signaling socket. A
second join retires an incomplete handshake only; an already authenticated
connected peer stays up. Answers and ICE candidates apply only to the current
handshake generation, so an answer cannot attach to a retired peer.

## Risks / Trade-offs

- A bounded grace period trades a short window of apparent liveness for
  tolerance of genuinely recoverable ICE `disconnected` transitions. Too short
  and recoverable blips close connections; the grace is therefore bounded but
  not zero.
