## Why

The new browser connection manager existed but was not the thing served at
`https://app.terminay.com`; that root still returned the obsolete Terminay
Remote application. The hosted handshake and signaling service for
`*.terminay.com` still had to keep running, so the cutover had to replace the
root without disturbing the wildcard runtime or its PostgreSQL state.

## What Changes

- `app.terminay.com` becomes the one canonical browser connection manager, and
  the shared exact-origin contract, browser host, server allowlists, transport
  classification, verifier, and tests all use it.
- The production web image serves the manager document only for exact Host
  `app.terminay.com` and keeps unknown Hosts failing closed.
- Ingress routes exact `app.terminay.com` to the static web image, and that
  exact rule is removed from the hosted application while `*.terminay.com`
  remains routed there for signaling and session handshakes.
- **BREAKING** The obsolete Terminay Remote root is no longer served.
- `web.terminay.com` is retired and may perform only a bounded redirect or
  metadata migration to `app.terminay.com`.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `connections-and-client-hosts`: the canonical manager origin is served by the
  static manager image, with the exact route winning over the wildcard hosted
  route.

## Impact

The shared exact-origin contract, the browser host composition, server
allowlists, transport classification, the deployment verifier and its tests,
`docker/nginx.web.conf` host matching, and the ingress rules for `terminay-web`
and `terminay-app`. Existing non-secret manager profiles at `app.terminay.com`
stay same-origin; session-origin keys, reconnect grants, and server device state
are not moved or deleted.
