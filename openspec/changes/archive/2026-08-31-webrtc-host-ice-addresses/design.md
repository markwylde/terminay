## Context

See proposal.md for the problem. The exposing host builds its peer connection
from the same STUN/TURN configuration it advertises to browsers. Without an
explicit address list the WebRTC runtime gathers host candidates from a single
bound interface, which excludes VPN overlay interfaces such as Tailscale's CGNAT
range even though those are frequently the only mutually reachable route
between a phone and a workstation.

## Goals / Non-Goals

Goals:
- Offer a host candidate for every usable local address so overlay-only and
  LAN-only routes succeed without TURN.
- Keep the loopback case narrow.

Non-Goals:
- Changing STUN/TURN configuration, relay selection, or candidate priority.
- Exposing network topology to clients or diagnostics.

## Decisions

- Addresses are collected from `os.networkInterfaces()` at peer setup and passed
  to the runtime as `iceAdditionalHostAddresses`, rather than binding ICE to one
  chosen NIC. Enumerating and offering is cheaper than trying to guess the
  correct interface, and ICE already handles selecting the working pair.
- The additional addresses are supplied only when signaling is not loopback.
  When signaling itself is loopback the host stays pinned to 127.0.0.1, so a
  purely local exposure does not start advertising machine addresses.
- Link-local addresses are excluded: they add candidate churn without adding a
  route that the peer could use.

## Risks / Trade-offs

- More host candidates means a longer candidate list per offer. This is bounded
  by the number of local interfaces and is accepted in exchange for connecting
  without TURN.
- Local addresses appear in SDP, which is the existing design of ICE. The
  mitigation kept here is that candidate addresses are never written to logs or
  diagnostics, so the metadata-only diagnostics boundary is unchanged.
