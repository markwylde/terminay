## Why

Hosted compact pairing URLs used `https://<session>.terminay.com/v1/#…`, so
pasting one into a browser left the PWA manager. Desktop either rejected those
URLs or, if the origin were taken from the link, would treat
`app.terminay.com` as the server.

## What Changes

- Advertise hosted pairing links as
  `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`,
  reconstructing the session origin from `s` plus the manager's parent domain
  and port, and keeping the secret in the fragment.
- Continue accepting legacy `/v1/` session pairing URLs.
- Emit the manager-origin form from `terminay-server` and from Desktop's expose
  and QR surfaces, while signaling, ICE, and session origins stay on the session
  subdomain.
- Parse the same URL in Desktop Add connection, never enrolling against
  `app.terminay.com`, using `hostName` as the default profile label, and
  completing device enrollment against the reconstructed session origin.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `remote-access`: hosted pairing URL format, opening a hosted pairing link, and
  Desktop pairing origin selection.

## Impact

The `terminay-server` pairing URL emitter, Desktop expose and QR surfaces,
Desktop Add connection URL parsing and enrollment, and the PWA manager's
handling of `?s=` links.
