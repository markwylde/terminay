## Why

Retired hosted WebRTC generations stayed in the live peer set, so closed Werift
peers accumulated in the Electron process until it exited. After roughly twenty
minutes of reconnects the set held only dead peers alongside the live one.

## What Changes

- Drop a generation from the hosted generation set when its lifecycle fails,
  and close all generations when the host stops.
- Keep only the live generation across a reconnect storm.
- Set the device signaling refresh delay to twenty minutes after registration,
  so refresh does not accumulate closed peers.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: the hosted generation set retains only live generations, and
  device signaling refresh is bounded.

## Impact

- `HostedGenerationSet` lifecycle and host stop path.
- Device signaling refresh scheduling.
- `hosted-generation-set.test.mjs`.
