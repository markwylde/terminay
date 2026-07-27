# Full WebRTC server connections

## Goal

Extend the existing secure WebRTC pairing/reconnect and asset delivery system
from terminal-only remote control to the complete Terminay application protocol
hosted by standalone or Embedded Terminay Server.

## Governing specifications

- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Remote access](../features/remote-access.md)

## Why this is active

The current remote service lives in Electron, delegates peer connections to a
hidden BrowserWindow, and exposes only list/attach/write/resize terminal
messages. The hosted `terminay.com` service already provides origin isolation,
signed signaling, reconnect, and verified server-supplied assets that should be
preserved rather than replaced.

## Dependencies

- [Server architecture decision spikes](./3-server-architecture-decision-spikes.md)
- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)
- [Shared responsive server UI](./16-shared-responsive-server-ui.md)

## Work slices

### Node WebRTC host

- [ ] Implement the selected headless WebRTC runtime behind a server transport
  adapter.
- [ ] Port initial pairing, room rotation, reconnect availability/challenge,
  signed offer/answer/ICE, STUN/TURN configuration, cleanup, and observability.
- [ ] Remove the hidden Electron WebRTC host dependency after parity.
- [ ] Bound peers, channels, queued signaling, transfer sizes, and timeouts.

### Full application transport

- [ ] Carry connection/control, application commands/events, terminal streams,
  and assets/binary content on isolated channels with backpressure.
- [ ] Complete application handshake/auth only after device key and PIN/approval
  verification.
- [ ] Resume workspace revision and terminal positions on reconnect.
- [ ] Reject commands received before auth, after revoke, with stale connection
  identity, or from another server/session origin.
- [ ] Preserve local transport semantics through the shared conformance suite.

### Exposure lifecycle

- [ ] Move start/stop, pairing-room rotation, device/grant stores, audit,
  connections, and status into Terminay Server.
- [ ] Keep Embedded Local loopback-only until explicit **Expose this server…**.
- [ ] Let standalone CLI generate/rotate pairing material and report status.
- [ ] Ensure stopping exposure does not stop Local/standalone server work or
  existing local clients.
- [ ] Define reconnect availability while exposed and accurate offline state
  when not advertising.

### Server bundle delivery

- [ ] Deliver the complete responsive bundle manifest/assets with current
  hash/path/size verification and versioned cache paths.
- [ ] Launch direct and embedded server UI modes on the exact isolated session
  origin.
- [ ] Preserve old compatible bundles until a new install commits; never launch
  a partial update.

### Hosted-service coordination

- [ ] Update the sibling hosted service for any new channel/control and
  `web.terminay.com` host-shell requirements without adding application-data
  visibility.
- [ ] Preserve manager/session host separation and reject signaling upgrades on
  manager-only hosts.
- [ ] Add TURN credential integration only with short-lived unrelated secrets.
- [ ] Update redaction, rate limits, metrics, cleanup, and deployment tests.

### Security and reliability tests

- [ ] Extend real pairing/reconnect E2E to full workspace snapshot, create
  terminal, file read/conflict save, agent event, settings, reconnect/resume,
  revoke, and exposure stop.
- [ ] Test replay/cross-origin/cross-server frames, invalid bundles, slow asset
  channels, disconnect storms, background mobile reconnect, and TURN-required
  networks.
- [ ] Verify hosted storage/logs never contain application data or auth secrets.

## Acceptance checks

- A displayless standalone server pairs and reconnects through production-like
  signaling and runs the full server-bundled UI.
- Remote and Local clients pass the same application protocol behaviour suite.
- Remote reconnect restores workspace revision and terminal output positions.
- Revocation immediately closes all device channels and rejects future proof.
- Hosted infrastructure can inspect neither terminal/project/file data nor
  device/PIN/reconnect secrets.

## Definition of done

Remote access is a full Terminay Server connection rather than a special
terminal viewer, with existing origin isolation and data-blind signaling
security preserved.
