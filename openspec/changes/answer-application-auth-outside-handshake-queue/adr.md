# ADR Review

## In-force ADRs reviewed

- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review
- ADR-0013 — Pair with device-bound host approval, and exchange credentials only on transport-authenticated data channels

ADR-0001 to 0005, 0007 to 0010, and 0012 are in force but do not constrain
this change.

## Decisions recorded

_No durable architectural decisions were introduced by this change._ It
corrects the scheduling of an existing reply without changing any contract;
ADR-0013's ordering guarantee (a live peer is displaced only after its
replacement consumed a ticket) is preserved by a per-device chain.
