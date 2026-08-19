# Manager-origin hosted pairing URL

## Goal

Advertise hosted pairing links on `https://app.terminay.com` so paste-into-browser
lands on the PWA. Session subdomains stay the WebRTC peer. Desktop Add
connection accepts the same link and pairs against that session origin.

Governing spec: [remote access](../features/remote-access.md),
[connections and client hosts](../features/connections-and-client-hosts.md).

## Current gap

Hosted compact pairing URLs still use `https://<session>.terminay.com/v1/#…`.
Opening them leaves the manager. Desktop rejects those URLs or would treat
`app.terminay.com` as the server if the origin were taken from the link.

## Implementation slices

- [x] Hosted pairing URL format:
      `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`.
      Reconstruct session origin from `s` plus the manager's parent domain and
      port. Keep the secret in the fragment. Accept legacy `/v1/` session URLs.
- [x] `terminay-server` and Desktop expose/QR emit the manager-origin form.
      Signaling, ICE, and session origins stay on the session subdomain.
- [x] Desktop Add connection parses the same URL, never enrolls against
      `app.terminay.com`, uses `hostName` as the default profile label, and
      completes device enrollment against the reconstructed session origin, not
      `app.terminay.com`. Standalone fragment pairing URLs keep the HTTPS enroll
      path.
- [x] Tests: URL format/parse, hosted handoff, WebRTC QR payload, Desktop
      pairing origin selection.

## Acceptance checks

- Copying a hosted pairing link and opening it in a browser lands on
  `app.terminay.com`, not the session subdomain.
- Desktop Add connection with that link pairs the session origin.
- Production ICE and signaling still use the session origin.
- A pairing secret never appears in query, logs, or saved profiles.

## Definition of done

Product specs match the advertised URL. Unit tests for format, server handoff,
and Desktop origin selection pass.
