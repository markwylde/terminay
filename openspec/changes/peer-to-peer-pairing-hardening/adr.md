# ADR Review

## In-force ADRs reviewed

- ADR-0003 — Hold server secrets in a vault with AES-256-GCM entries and platform key protectors
- ADR-0005 — Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts
- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind (supersedes ADR-0007)
- ADR-0009 — Make the selected Terminay Server the sole owner of project environment connections
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review
- ADR-0012 — Keep the installable PWA on the manager origin and frame the session origin

ADR-0001, 0002, 0004, and 0010 are in force but do not constrain this change.

## Decisions recorded

- [ADR-0013 — Pair with device-bound host approval, and exchange credentials only on transport-authenticated data channels](../../adr/0013-device-bound-host-approval-and-channel-only-credentials.md).
  It narrows ADR-0011's "PIN/approval" to host approval of a device-bound match
  code, forbids hosted HTTPS origins as credential paths on every client host,
  requires authentication before a live peer is displaced, and places the host
  key under the same protection as device keys. ADR-0011 stays in force
  unchanged.
