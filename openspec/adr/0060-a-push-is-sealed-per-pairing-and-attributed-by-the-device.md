# ADR-0060: A push is sealed per pairing and attributed by the device; the hosted push service reads nothing and identifies no one

Status: accepted
Date: 2026-10-11

## Context

The installed PWA at `app.terminay.com` shows one server at a time and knows
nothing about a server it is not showing. ADR-0047 accepted that and left "a
host-readable activity summary for servers no window is showing" as an open
item, having rejected a background connection per saved server. ADR-0028 rules
out polling. The only way a browser wakes a web app is Web Push.

Web Push fixes three things this design cannot choose. A service-worker
registration holds one subscription, bound to one signing key. A cross-origin
iframe cannot hold notification permission, and iOS delivers push only to the
installed app's own origin, so the subscription lives at the manager origin and
not at any server's session origin. And a service worker can badge only an
application inside its own scope, which rules out a registration per server.

So every paired server must reach one subscription through one signing key. That
key cannot be given to servers, because anyone can run one. A hosted party has
to hold it, and the transport then offers the device nothing it can trust about
which server a push came from.

Three existing commitments bear on this. ADR-0011 treats hosted services as
untrusted for confidentiality and integrity and says a new boundary must be
added to the model before it ships. ADR-0012 gives the manager a small fixed
surface and forbids it from reading workspace content. And the hosted relay
today holds no record of a user or an installation: each server registers under
its own id, and nothing links two servers to one person.

## Decision

1. **A push is sealed end to end with a key that belongs to one pairing.** For
   each saved server the manager generates a random key and routing id, hands
   them to that server's own session origin, and the session passes them to the
   server on the authenticated channel. The server seals every push under that
   key. The manager's service worker verifies a push before acting on it.
2. **Attribution comes from the device.** The name shown for a server is the
   label the user gave it on that device. No field of a push names a server to
   the user. A push that fails verification changes nothing and is never
   attributed.
3. **The hosted push service holds the signing key and reads nothing.** It
   receives inner ciphertext of one fixed length, applies Web Push encryption and
   the signature, forwards, and retains nothing of the message.
4. **The hosted push service identifies no one.** It stores, per enrolment, a
   hash of a token, the subscription sealed under a key derived from that token,
   and an expiry. It cannot open a row without the token, keeps no token, and
   records no endpoint, body, or token in any log. Two rows for one installation
   are indistinguishable from two rows for two installations.
5. **A push states the server's current published notifications** (ADR-0061).
   Push decides nothing about what a notification is or when it is shown. It is
   idempotent and self-correcting, so the device never asks a server anything and no party
   queues past notifications.
6. **The manager's service worker may display a banner's text, which is its
   terminal and project names and any text a process sent, and do nothing else
   with it.** It does not store, forward, or expose
   them to the manager page. This is the single exception to the manager
   reading no workspace content.
7. **A count is a number per server.** The manager holds one slot per saved
   server, written only by a verified push from that server or by that server's
   own framed session, and sums the slots onto the icon.

This extends the security contract in ADR-0011 with two boundaries:

| Boundary | Protected assets | Required invariant |
| --- | --- | --- |
| Server → hosted push service → browser vendor | notification content, which servers belong to one installation, the Web Push signing key | the hosted service and the vendor carry only ciphertext of a fixed length; the hosted service stores no content, no openable subscription, and nothing that links enrolments; the signing key never leaves it; compromise can cause delay, loss, or an unattributed line, never a readable or attributed notification |
| paired server → manager origin (push) | the identity of every other saved server, each server's count and banners, the manager's no-content rule | every push is verified under its own pairing's key before any effect; the server's name is device-held; one server's key, token, and count slot are reachable only by that server's origin; decrypted names are displayed and not retained |

## Rejected alternatives

- **A signing key and a scoped service-worker registration per server.** It
  removes the hosted service, but a scoped worker cannot badge the application
  icon and the route is unproven on iOS.
- **A subscription at each server's session origin.** The browser would attribute
  each notification to its origin, but a framed document cannot hold the
  permission and iOS would deliver nothing.
- **Trusting the hosted service to tag each push with its sender.** The model
  treats that service as untrusted for integrity.
- **Signing pushes with the server's host key.** It reuses the transport
  authentication key for a second purpose and gives no confidentiality.
- **Banners that name only the server.** It keeps the manager wholly blind to
  content. Rejected by the owner: knowing which terminal is the point of the
  notification.
- **A stateless hosted service.** It stores nothing, but cannot revoke one
  server's access on unpair and gives every server the subscription endpoint.
- **Storing endpoints in the clear.** Every server on one device shares one
  endpoint, so the table would be the installation identity the hosted side has
  never had.

## Consequences

- ADR-0047's open item is closed for the PWA: a saved server reports a count and
  raises banners without a window showing it. Desktop is unchanged.
- ADR-0012's manager surface grows by a push handler, per-server push keys and
  counts, and three notification messages on the framed-host channel. It gains
  no storage proxy and no general read of workspace content. Manager XSS, which
  ADR-0012 already accepts as exposing every vaulted device key, also exposes
  push keys and the names in banners.
- The browser vendors' push services join the delivery path. They and the hosted
  push service observe when a push is sent and to which subscription. That
  metadata cannot be hidden with Web Push.
- A server that cannot reach the hosted push service sends nothing. Push is a
  hosted feature in the way hosted signaling is.
- Terminay Server needs no Web Push dependency and never holds a subscription.
- The hosted side keeps a durable table for the first time. Its contents are
  constrained by this record, and a later change may not add a readable
  endpoint, a server identifier, or an account key to it without superseding
  this decision.
- Any later surface that shows something on behalf of a paired server at the
  manager origin takes its attribution from the device, by the same rule.

## Open items

- Whether iOS permits a push that shows nothing, and how many, decides how
  promptly a notification acknowledged elsewhere clears on an iPhone. The spike
  is recorded under `./evidence/` when it is run.
- While a push is in flight the hosted service holds the endpoint in memory.
  The commitment that it is not recorded is enforced by test, not by
  construction.
