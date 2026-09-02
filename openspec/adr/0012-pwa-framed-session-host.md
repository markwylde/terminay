# ADR-0012: Keep the installable PWA on the manager origin and frame the session origin

Status: accepted
Date: 2026-08-18

## Context

iOS Add to Home Screen keeps `app.terminay.com` chrome-less only while the
top-level document stays on that origin. A top-level navigation to
`https://<server>.terminay.com` shows Safari's address bar, which defeats the
installed-app presentation.

Safari also treats a cross-origin session iframe as third-party storage:
IndexedDB and `localStorage` are partitioned and often ephemeral, so a framed
session cannot reliably persist its own device credentials. Chrome same-site
iframes do persist first-party storage, but maintaining two storage
implementations for one product is not acceptable.

Per-server session origins remain the isolation boundary for untrusted
server-bundled UI (see
[ADR-0005](./0005-sandboxed-origin-bound-client-hosts.md) and
[ADR-0008](./0008-server-bundled-clients-and-protocol-blind-hosts.md)). The
workspace does not move onto `app.terminay.com`.

Implementation is owned by the `terminay.com` hosted surfaces; this repository
keeps the product contract.

## Decision

When the installable PWA opens a connection, it keeps `https://app.terminay.com`
as the top-level document and loads the exact session origin in a fullscreen
iframe. The advertised hosted pairing URL is also on `app.terminay.com`
(`?s=<session-id>#<secret>`). Opening it stays on the manager, asks **Save and
connect**, then frames the session origin. Legacy `/v1/` session URLs and **Open
in new tab** still use a first-party session document.

The host message set is the Safari lowest common denominator, and every message
is origin-checked:

- device credential load/save (`CryptoKey` plus device id and name);
- clipboard read/write;
- microphone capture for dictation;
- notifications;
- shell ready, pairing-fragment consumed, back to connections, and optional title
  and error for manager chrome.

WebRTC, pairing PIN UI, reconnect, bundle install, and the workspace stay in the
iframe. The manager does not run a workspace build or decode application frames.

The manager persists framed-session device credentials in its own IndexedDB,
keyed only by `event.origin`. It clones a credential only into the iframe whose
origin matches that key. A generic storage proxy is forbidden. Forget deletes
that origin's vault slot with the bookmark.

The session bootstrap is the framed document and is the only intended speaker on
the manager bus. The workspace uses in-page clipboard, microphone, and
notification APIs; when framed, the session bootstrap presents those APIs through
the host channel.

Hosted session responses allow framing by `https://app.terminay.com` only. The
manager document and Local Desktop UI remain unembeddable. Session pages never
navigate `window.top`. The PWA uses at most one session iframe. The session talks
to `parent` only when that parent is the manager origin.

The iframe `src` and the session document's resume URL stay on the session
bootstrap (`/v1/`). Installing the workspace into Cache Storage must not leave
`history` or `iframe.src` on `/remote-app/…` as the document iOS restores after
freeze. The service worker may still serve `/remote-app/` assets. Relative
workspace `src` and `href` values are rewritten onto that cached entry; a `<base>`
tag is not used.

A hidden, frozen, or restored framed session asks the session host to replace its
WebRTC generation through the same reconnect path as Retry. Vault credential
replies use the existing origin-checked schema and the existing timeout; a missed
reply is a visible session error, not an infinite splash.

## Consequences

- iOS standalone keeps chrome-less presentation and can persist reconnect
  credentials, which partitioned third-party storage would not allow.
- The manager's XSS blast radius includes every vaulted device key. This is
  accepted in exchange for iOS credential persistence. Per-server session origins
  still stop one server's bundled UI from opening another server's storage
  directly.
- The manager carries a small, fixed host surface — credentials, clipboard,
  microphone, notifications, and chrome signals — and must not grow into a
  generic storage or capability proxy.
- One storage implementation serves both Safari and Chrome, at the cost of using
  the Safari-constrained design everywhere.
- Two session entry shapes remain supported: the framed PWA path, and the
  first-party session document used by legacy `/v1/` URLs and **Open in new tab**.
