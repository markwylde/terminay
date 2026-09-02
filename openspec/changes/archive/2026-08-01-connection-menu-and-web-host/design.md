## Context

See proposal.md. The pre-change Desktop header advertised transport
(**Remote**) rather than identity, which made exposure look like the mode the
user was in. The browser manager and the Desktop journey had diverged.

## Goals / Non-Goals

Goals:
- One host-neutral connection model and menu shared by Desktop and browser,
  differing only by host capability.
- Desktop runs one Local plus several remote windows without credential or
  state leakage.
- The browser host holds no secrets that a session origin should own.

Non-Goals:
- Public deployment, DNS, TLS, or CDN verification. Those are release
  operations, and the local contract deliberately does not claim them.

## Decisions

### Identity, not transport, labels the header

The header renders `Local` or the selected server label. The narrow
server-connection hand-off carries only a validated display label alongside its
fixed server id, so a selected HTTP remote cannot continue to render as
**Local** once its terminal transport is live. Activity and notification counts
stay separate from connection state, and the menu distinguishes offline, relay,
WebRTC route, expired, revoked, identity mismatch, and incompatible failures as
different states rather than one generic error.

### Exposure is capability-gated

**Expose this server…** appears only when the current connection has the
administrative capability. `createConnectionMenuModel` gates it on the
`serverExposure` host capability together with the current connected profile.

### Browser credentials never reach the manager

The static browser host derives and persists a non-extractable origin-keyed
WebCrypto proof key in IndexedDB, discards the pairing grant, and keeps
`localStorage` metadata-only. Two hardening rules came out of review:

- A proof already in WebCrypto signing must not be released after a newer
  pairing replaces that origin's credential. Both browser vault implementations
  tag each enrollment and re-check the durable current record before returning
  a proof, rejecting the stale request.
- The non-extractable proof key is restricted to canonical v1 reconnect
  challenges for its exact session origin and reconnect handle. The vault
  rejects arbitrary, cross-origin, cross-handle, and appended signing payloads
  rather than acting as a signing oracle.

A fresh pairing upserts against the existing exact browser origin instead of
creating duplicate saved-server cards; the retained profile id and metadata stay
non-secret while reconnect enrollment continues to use the origin-keyed vault.

### QR fragment secrets stay out of both managers

`consumePairingUrl` consumes the fragment in memory. Tests assert it is absent
from profile storage and from session URLs, and deep links and pasted pairing
URLs leave no unconsumed fragments in logs, history, or profile storage.

### Migration is metadata-only

Migration from the legacy manager records is defined by
`WebConnectionHost.migrateLegacyManagerRecord` with server-side
`sanitizeManagerProfiles` as the canonical contract. Existing
`<session>.terminay.com` origins and their reconnect grants are preserved: a
focused fixture proves the exact session URL is retained, origin-bound grant
material stays usable at that origin, and manager storage never receives it.
Forget and revoke keep distinct confirmation copy and explicit confirmation.

## Risks / Trade-offs

- The web-host release-readiness contract is deliberately local and
  deterministic (package exports, built artifacts, stable manager origin, no
  Local profile). It proves readiness, not public deployment.
- Compose evidence proved a local static web image can proxy an authenticated
  server connection and survive a server-only restart without restarting the
  web container, and that a live server-only restart accepted the saved proof
  and issued a fresh ticket without another pairing URL. This is local Docker
  Compose evidence only.

## Migration Plan

Legacy manager metadata is imported once against the stable manager origin and
the source record is then removed. No cross-origin secret is copied; existing
session origins keep their own grants and continue to reconnect directly. Users
whose only record was in the legacy manager receive a clear one-time migration
path rather than silent loss.
