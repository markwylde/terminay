# Remote lane close does not hang up

## Goal

A `control` or `assets` datachannel close while ICE is connected does not
tear down the WebRTC peer. Diagnostics name the channel and `hangup: false`.

## Governing specifications

- [Remote access](../features/remote-access.md)

## Scope

- [x] `laneCloseHangsUp` is false
- [x] channel-state close is a warning with channel + hangup
- [x] Tests for control/assets/application close

## Definition of done

`hosted-hydrated-checkpoint-silence.test.mjs` and stream diagnostics tests pass.
