## Why

A phone on the same VPN overlay as the exposing host could not reach it over
WebRTC: the host advertised ICE host candidates for only one network interface,
so overlay-only routes were never offered and the connection either fell back to
TURN or failed outright.

## What Changes

- The exposing host collects every usable local address from the operating
  system's network interface list and advertises them all as ICE host
  candidates.
- Those addresses are passed as `iceAdditionalHostAddresses` whenever signaling
  is not loopback, so ICE is no longer bound to a single interface.
- Loopback signaling keeps its single-address pin.
- Link-local addresses are omitted, and candidate addresses are never logged.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: the ICE candidate policy covers every usable local address,
  including VPN overlay addresses.

## Impact

The hosted peer lifecycle in the exposing server's WebRTC host, and its
signaling configuration. No protocol, persistence, or client change.
