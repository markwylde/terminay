## Why

Remote access was a terminal viewer, not a Terminay Server connection: it lived in Electron,
delegated peer connections to a hidden `BrowserWindow`, and exposed only list, attach, write,
and resize terminal messages. A remote user could not open the real workspace — projects,
files, Git, agents, or settings — over that path.

## What Changes

- Move the WebRTC host into Terminay Server as a headless runtime, and remove the hidden
  Electron WebRTC host after parity.
- **BREAKING** Carry the complete Terminay application protocol over four isolated WebRTC
  traffic lanes — connection control, application commands and events, terminal streams, and
  assets/binary content — each with its own backpressure and bounds.
- Move exposure lifecycle — start/stop, pairing-room rotation, device and grant stores,
  audit, connections, and status — into Terminay Server, keeping Embedded Local loopback-only
  until an explicit **Expose this server…**.
- Deliver the complete responsive server UI bundle to remote clients with hash, path, and
  size verification, versioned cache paths, and no partial installs.
- Give Desktop connection parity with browser clients: shared device-pairing transaction,
  main-process secure credential store, protected reconnect exchange, strict fail-closed
  signaling bootstrap parsing, and a privileged four-lane WebRTC coordinator with no silent
  HTTP downgrade.
- Keep hosted infrastructure data-blind: metadata-only audit with closed allowlists, no
  application data, and no device, PIN, or reconnect secrets.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `remote-access`: remote connections become full server connections with server-owned
  pairing, reconnect, exposure lifecycle, and revocation.
- `server-runtime-and-protocol`: the application protocol runs over transport-neutral
  headless WebRTC channels and serves the verified UI bundle to remote clients.
- `connections-and-client-hosts`: Desktop pairs, reconnects, and exposes servers through the
  same server-owned lifecycle as standalone, without a renderer credential surface.

## Impact

Server-core remote transport, channel transport, pairing, reconnect, headless negotiation,
exposure, and UI bundle store; the Terminay Server node-datachannel runtime, peer, host,
signaling host boundary, hosted signaling registrar, and remote audit log; Electron remote
pairing, credential store, reconnect transport, signaling bootstrap, WebRTC transport and
bootstrap, and server-owned exposure; the browser device-pairing flow and bootstrap parser;
the vendored deterministic secure-Werift artifact and its release-signing contract; and the
remote conformance, security, disconnect-storm, and Chromium proof suites.
