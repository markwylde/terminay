## 1. Implementation slices

- [x] 1.1 Define the hosted pairing URL format `https://app.terminay.com/?s=<session-id>&hostName=<optional>#<secret>`, reconstruct the session origin from `s` plus the manager's parent domain and port, keep the secret in the fragment, and accept legacy `/v1/` session URLs, verified by the URL format and parse tests
- [x] 1.2 Emit the manager-origin form from `terminay-server` and Desktop expose and QR surfaces while keeping signaling, ICE, and session origins on the session subdomain, verified by the hosted handoff and WebRTC QR payload tests
- [x] 1.3 Parse the same URL in Desktop Add connection, never enroll against `app.terminay.com`, use `hostName` as the default profile label, complete device enrollment against the reconstructed session origin, and keep the standalone fragment pairing URL's HTTPS enroll path, verified by the Desktop pairing origin selection tests
- [x] 1.4 Add tests for URL format and parsing, hosted handoff, WebRTC QR payload, and Desktop pairing origin selection

## 2. Acceptance checks

- [x] 2.1 Verify copying a hosted pairing link and opening it in a browser lands on `app.terminay.com` rather than the session subdomain
- [x] 2.2 Verify Desktop Add connection with that link pairs the session origin
- [x] 2.3 Verify production ICE and signaling still use the session origin
- [x] 2.4 Verify a pairing secret never appears in a query string, logs, or saved profiles
