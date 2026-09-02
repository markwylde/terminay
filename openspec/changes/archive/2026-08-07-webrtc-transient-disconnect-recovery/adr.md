# ADR Review

## In-force ADRs reviewed
- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

## Decisions recorded
_No durable architectural decisions were introduced by this change._ It changes
only lifecycle evaluation inside the WebRTC runtime chosen by ADR-0006 and
leaves the authentication and revocation boundaries of ADR-0011 untouched.
