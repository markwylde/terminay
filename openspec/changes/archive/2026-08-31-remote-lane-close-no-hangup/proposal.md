## Why

A `control` or `assets` data-channel close was hanging up the whole WebRTC peer even
while ICE was still connected, tearing down a session that was otherwise healthy.

## What Changes

- A `control` or `assets` lane close while the ICE connection is connected no longer
  tears down the WebRTC peer: `laneCloseHangsUp` is false.
- A channel-state close is recorded as a warning naming the channel and `hangup: false`
  rather than as a peer teardown.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: lane-close handling and its diagnostics.

## Impact

Remote WebRTC session lane handling and its stream diagnostics. Verified by
`hosted-hydrated-checkpoint-silence.test.mjs` and the stream diagnostics tests.
