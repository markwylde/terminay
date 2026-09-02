## Context

The Desktop log from 2026-08-31 08:22 recorded the exact sequence: 185 outbound
frames, then a four-second outbound pause, then handshake inbound, then
`outbound-stalled`, generation closed, and reconnect. Dumping a checkpoint and
then pausing outbound while the handshake still exchanges inbound frames is
normal hydration behaviour, not a stall.

## Goals / Non-Goals

Goals:
- The recorded sequence must not fail the generation.
- A genuine stall must still fail, just later.
- Peer-closed reasons must be classified, not `other`.

Non-Goals:
- Changing the stall detector for non-hydrating generations beyond the grace
  window.

## Decisions

`outbound-stalled` is failed only when the first outbound frame is older than
the hydrate grace of 15 seconds. A four-second pause during handshake therefore
survives. Peer-closed `outbound-stalled` and required-lane close are given
explicit classifications so Desktop's `reasonClass` is not `other` for those
failures, which keeps the diagnostics honest about why a generation ended.

## Risks / Trade-offs

- A 15-second grace lengthens the time before a genuinely stalled outbound lane
  is detected. That is accepted in exchange for not closing healthy hydrating
  generations.
