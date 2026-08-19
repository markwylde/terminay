# PWA framed session host

Status: accepted product architecture. Implementation is owned by the
`terminay.com` hosted surfaces. This repository keeps the product contract.

## Context

iOS Add to Home Screen keeps `app.terminay.com` chrome-less only while the
top-level document stays on that origin. A top-level navigation to
`https://<server>.terminay.com` shows Safari's address bar.

Safari treats a cross-origin session iframe as third-party storage: IndexedDB
and `localStorage` are partitioned and often ephemeral. Chrome same-site
iframes persist first-party storage, but the product uses one Safari-safe
host rather than two storage implementations.

Per-server session origins remain the isolation boundary for untrusted
server-bundled UI. The workspace does not move onto `app.terminay.com`.

## Decision

When the installable PWA opens a connection, it keeps `https://app.terminay.com`
as the top-level document and loads the exact session origin in a fullscreen
iframe. The advertised hosted pairing URL is also on `app.terminay.com`
(`?s=<session-id>#<secret>`). Opening it stays on the manager, asks **Save
and connect**, then frames the session origin. Legacy `/v1/` session URLs and
**Open in new tab** still use a first-party session document.

Safari-lowest-common-denominator host messages, origin-checked:

- device credential load/save (`CryptoKey` plus device id/name);
- clipboard read/write;
- microphone capture for dictation;
- notifications;
- shell ready, pairing-fragment consumed, back to connections, optional title
  and error for manager chrome.

WebRTC, pairing PIN UI, reconnect, bundle install, and the workspace stay in
the iframe. The manager does not run a workspace build or decode application
frames.

The manager persists framed-session device credentials in its own IndexedDB,
keyed only by `event.origin`. It clones a credential only into the iframe whose
origin matches that key. A generic storage proxy is forbidden. Forget deletes
that origin's vault slot with the bookmark.

The session bootstrap is the framed document and is the only intended speaker
on the manager bus. The workspace uses in-page clipboard, microphone, and
notification APIs. When framed, the session bootstrap presents those APIs
through the host channel.

The manager XSS blast radius includes every vaulted device key. That is
accepted so iOS standalone can persist reconnect credentials. Per-server
session origins stop one server's bundled UI from opening another server's
storage directly.

Hosted session responses allow framing by `https://app.terminay.com` only.
The manager document and Local Desktop UI remain unembeddable. Session pages
never navigate `window.top`. The PWA uses at most one session iframe. The
session talks to `parent` only when that parent is the manager origin.
