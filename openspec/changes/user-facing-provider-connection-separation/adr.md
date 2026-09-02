# ADR Review

## In-force ADRs reviewed

- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind
- ADR-0009 — Make the selected Terminay Server the sole owner of project environment connections
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

## Decisions recorded

_No durable architectural decisions were introduced by this change._ It is a
user-facing presentation separation on top of ADR-0009's server-owned environment
ownership, and it deliberately changes no persisted identifier or authority
boundary.
