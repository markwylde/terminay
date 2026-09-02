# ADR Review

## In-force ADRs reviewed
- ADR-0009 — Make the selected Terminay Server the sole owner of project environment connections
- ADR-0002 — Use SQLite through `node:sqlite` for the server state repository
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

## Decisions recorded
_No durable architectural decisions were introduced by this change._ It is the
first implementation of ADR-0009: the environment registry, the reserved This
server environment, and the routing contract are that decision made concrete,
persisted through the ADR-0002 repository and authorized under the ADR-0011
trust boundaries.
