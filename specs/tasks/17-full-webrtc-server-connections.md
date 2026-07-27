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

- [Server architecture decision spikes](../tasks_completed/3-server-architecture-decision-spikes.md)
- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)
- [Shared responsive server UI](./16-shared-responsive-server-ui.md)

## Work slices

### Node WebRTC host

- [x] Provide a privileged standalone-server loader/factory for the optional
  `node-datachannel` runtime and map its established binary channels into the
  server-core transport contract.
- [ ] Complete peer creation/signaling and production runtime integration for
  the selected headless WebRTC implementation.
- [x] Keep initial pairing, room rotation, and reconnect challenge/proof
  material server-owned, origin-bound, single-use, expiring, and revocable.
- [ ] Port signed offer/answer/ICE, STUN/TURN configuration, cleanup, and
  production observability through the selected runtime adapter.
- [ ] Remove the hidden Electron WebRTC host dependency after parity.
- [x] Bound peers, channels, queued signaling, transfer sizes, and timeouts.

### Full application transport

- [x] Carry connection/control, application commands/events, terminal streams,
  and assets/binary content on isolated channels with backpressure.
- [x] Complete application handshake/auth only after device key and PIN/approval
  verification.
- [x] Resume workspace revision and terminal positions on reconnect.
- [x] Reject commands received before auth, after revoke, with stale connection
  identity, or from another server/session origin.
- [x] Preserve the transport-neutral four-channel, limit, cleanup, and
  admission contract across every injected headless runtime label through the
  shared server-core conformance suite.
- [x] Compare remote handshake/resume responses with canonical server-owned
  workspace revisions, stale-window snapshots, and project-scoped terminal
  positions in the server-core conformance suite.
- [ ] Compare Local and remote clients through one end-to-end protocol suite.

### Exposure lifecycle

- [ ] Move start/stop, pairing-room rotation, device/grant stores, audit,
  connections, and status into Terminay Server.
- [ ] Keep Embedded Local loopback-only until explicit **Expose this server…**.
- [x] Let standalone CLI generate/rotate pairing material and report status.
- [x] Ensure stopping exposure does not stop Local/standalone server work or
  existing local clients.
- [ ] Define reconnect availability while exposed and accurate offline state
  when not advertising.

### Server bundle delivery

- [ ] Deliver the complete responsive bundle manifest/assets with current
  hash/path/size verification and versioned cache paths.
- [x] Launch direct and embedded server UI modes on the exact isolated session
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
