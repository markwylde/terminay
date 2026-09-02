# ADR Review

## In-force ADRs reviewed

- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review
- ADR-0012 — Keep the installable PWA on the manager origin and frame the session origin

## Decisions recorded

_No durable architectural decisions were introduced by this change._ It reaffirms
ADR-0006 by fixing Werift through the existing audited patch mechanism rather
than switching runtimes, and removes an unreachable alternative runtime path
without revisiting that decision.
