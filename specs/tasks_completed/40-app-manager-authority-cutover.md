# App manager authority cutover

## Goal

Serve the new browser connection manager at `https://app.terminay.com` while
preserving the hosted handshake/session service for `*.terminay.com`. Remove
the obsolete Terminay Remote root without deleting its still-required wildcard
runtime or PostgreSQL state.

## Authority contract

- `app.terminay.com` is the one canonical browser connection manager.
- Exact Host `app.terminay.com` routes to the static `terminay-web` image.
- Wildcard `*.terminay.com` continues to route to `terminay-app` for hosted
  signaling and session handshakes. The exact manager route must win over the
  wildcard route.
- `web.terminay.com` is retired and may perform only a bounded redirect or
  metadata migration to `app.terminay.com`.
- Existing non-secret manager profiles at `app.terminay.com` remain
  same-origin. Session-origin keys, reconnect grants, and server device state
  are not moved or deleted by the cutover.

## Checklist

- [x] Update the shared exact-origin contract, browser host, server allowlists,
  transport classification, verifier, and tests to use `app.terminay.com`.
- [x] Make the production web image serve `web.html` only for exact Host
  `app.terminay.com`; keep unknown Hosts fail closed.
- [x] Route exact `app.terminay.com` ingress to `terminay-web` and remove that
  exact rule from `terminay-app` while retaining `*.terminay.com` there.
## Acceptance

- Opening `https://app.terminay.com/` shows **Terminay Connections** with the
  primary **Add connection…** action.
- The old **Terminay Remote / Your saved sessions** root is no longer served.
- `https://app.terminay.com/.well-known/terminay-release.json` identifies the
  selected source revision.
- Hosted `*.terminay.com` signaling/session traffic continues to work.
