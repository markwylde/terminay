# ADR Review

## In-force ADRs reviewed

- ADR-0005 — Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind
- ADR-0009 — Make the selected Terminay Server the sole owner of project environment connections
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

## Decisions recorded

_No durable architectural decisions were introduced by this change._ The preview
origin and partition rules apply ADR-0005's sandboxed origin-bound model to a new
surface, and compilation running on the exact project environment follows
ADR-0009 rather than revising it.
