## Why

Remote localhost and Docker connections took seconds to reconnect, create a
project, and attach a terminal. The cause was not transport latency: remote and
web clients ran a separate HTTP+SSE pseudo-protocol while Desktop-local ran the
canonical framed `ServerConnection`, so remote had its own command, query,
event, and terminal-output implementations that behaved differently.

## What Changes

- Add a browser-compatible framed byte-stream transport and a standalone-server
  stream endpoint that adapts each authenticated stream directly into
  `ServerConnection`. Desktop remote and web remote instantiate the same
  transport; Electron local keeps its existing local byte transport.
- **BREAKING** Delete the split application protocol: JSON command dispatch,
  JSON query dispatch, and SSE app-event subscription/replay are removed from
  `LocalUiServer`, and client-side HTTP event subscription, retry, replay,
  filtering, and JSON-to-frame re-encoding are removed. `/protocol/query`,
  `/protocol/command`, and `/protocol/events/subscribe` are no longer
  application-protocol paths.
- Keep HTTP only for static assets, health and readiness, pairing, reconnect
  enrollment, and stream bootstrap/authentication.
- Make project create/activate/close/root-update and terminal create/open-at use
  the canonical command result plus the unified event stream, and remove the
  remote-specific waits, sleeps, and fallback refreshes that only compensated
  for the split path.
- Route terminal attach, input, resize, detach, and output through the same
  framed stream, removing JSON/base64/SSE replay from the remote path.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-runtime-and-protocol`: application traffic uses one framed connection
  protocol, transport neutrality and conformance, the versioned application
  protocol, and separated terminal presentation lanes.

## Impact

`LocalUiServer` in `apps/terminay-server`, `HttpByteTransport` and the new
browser stream transport in `packages/client-core`, `ServerConnection` in
`packages/server-core`, the workspace mutation and terminal attach paths in the
shared UI, and the remote-only tests that asserted the deleted split protocol.
