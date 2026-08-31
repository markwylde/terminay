# Remote stall does not hang up

## Goal

Five seconds of quiet PTY does not close the WebRTC peer. Stall is logged
only. The host hangs up only on user disconnect, required-lane loss, or
WebRTC `failed`/`closed`.

## Governing specifications

- [Remote access](../features/remote-access.md)

## Scope

- [x] `shouldFailHostedStall` is always false
- [x] Test: five seconds of outbound silence does not close the peer

## Definition of done

`hosted-hydrated-checkpoint-silence.test.mjs` passes.
