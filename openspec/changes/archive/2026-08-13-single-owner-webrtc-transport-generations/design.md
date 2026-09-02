## Context

See proposal.md. The reproduced root cause is a split ownership model, not a missing callback:
initial enrollment and the mounted application used separate global bridge surfaces, exposing raw
`RTCDataChannel` objects to the server bundle and splitting signaling, credential, transport, and
renderer-generation ownership. Adding another callback or retry path would preserve the
contradiction.

The native Linux proof closes each required lane while the Chromium peer stays connected. Before
the change the next key produced `client is not connected`, Retry reused retired authority, and
later input never reached the PTY. The permanent matrix now proves a fresh single-owner generation
and exact ordered post-recovery input.

The server bundle and host contracts work consumes this change's opaque endpoint and owns its
bundle compatibility declaration; it does not own WebRTC generation recovery.

## Goals / Non-Goals

Goals: the exact session-origin host is the sole authority for browser WebRTC signaling, peers,
required data channels, authentication, and generation replacement. A mounted server-bundled
workspace receives a fresh opaque byte endpoint after any terminal transport failure and never
owns or reuses raw WebRTC channels.

Non-Goals: bundle compatibility declaration, and any Desktop transport change.

## Decisions

- **One session transport host contract.** It covers initial pairing, saved reconnect, current
  generation state, opaque application byte endpoint acquisition, replacement, cancellation, and
  terminal failure. It is bound to one exact session origin, server identity, profile id, device
  credential compartment, and browser view, and rejects another origin, source, profile, server,
  or retired generation.
- **Nothing WebRTC crosses the boundary.** Signaling sockets, reconnect credentials, application
  tickets, `RTCPeerConnection`, ICE, and every `RTCDataChannel` stay private to the session host.
- **Generations, not channels, are the unit of health.** Each complete peer and channel set has one
  monotonic generation identity that every endpoint and lifecycle event names. Close or error of
  any required lane is terminal failure of that generation even if the peer remains connected.
- **The grace period is only for recoverable peer/ICE `disconnected` state.** It is cancelled when
  the complete generation becomes healthy, and replacement is immediate for explicit failed or
  closed state or required-lane loss.
- **Replacement is coalesced and idempotent.** Concurrent peer, ICE, channel, application-send,
  online/offline, and renderer signals fold into one replacement attempt; cleanup and publication
  happen exactly once per generation. Manual Retry calls the same controller, cancels its pending
  backoff, and starts one immediate attempt without reloading the document or creating a parallel
  signaling room.
- **State is reset before replacement lanes are acquired.** Peer, signaling, channel map,
  authentication promise, listeners, timers, and attempt-local state are cleared, and a closed lane
  from the retired generation is never awaited or consulted.
- **Legacy lanes are attempt-scoped.** Bootstrap `api` and singular `asset` lanes exist only for
  enrollment and bundle install, and are closed and deleted at the authenticated canonical-lane
  handoff rather than kept as six permanent lanes to preserve the old bridge.
- **The split bridge is deleted, not aliased.** Compatibility globals, fallback shims, and old
  source-shape tests are removed in the same change; an incompatible host contract fails explicitly.

## Risks / Trade-offs

Removing compatibility aliases in the same change means a mismatched hosted bootstrap and server
bundle fail explicitly rather than degrading. That was chosen deliberately over carrying a legacy
bridge whose whole defect was ambiguous ownership.

Coordinating two repositories in one contract change requires separate worktrees and focused
hosted plus Terminay contract tests passing together before either side ships.
