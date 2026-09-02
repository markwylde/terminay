## Why

A hosted remote session treated five seconds of quiet PTY output as a stall and
hung up the WebRTC peer, so an idle terminal lost its connection for no reason.

## What Changes

- `shouldFailHostedStall` is always false: an outbound-silence stall is logged as
  a diagnostic only and never retires a generation.
- The host hangs up only on an explicit signal: user disconnect, loss of a
  required lane, or a WebRTC `failed`/`closed` state.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: outbound silence is removed from the set of generation
  liveness signals.

## Impact

The hosted remote host's stall detection path and the
`hosted-hydrated-checkpoint-silence` regression test.
