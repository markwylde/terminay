# WebRTC host ICE addresses

## Goal

The exposing host advertises ICE host candidates for every usable local
address, including VPN overlay addresses, without binding ICE to one NIC.

## Governing specifications

- [Remote access](../features/remote-access.md)

## Scope

- [x] Collect usable addresses from `os.networkInterfaces()`
- [x] Pass them as `iceAdditionalHostAddresses` when signaling is not loopback
- [x] Omit link-local; do not log candidate addresses

## Definition of done

`hosted-peer-lifecycle.test.mjs` covers LAN, Tailscale CGNAT, and loopback pin.
