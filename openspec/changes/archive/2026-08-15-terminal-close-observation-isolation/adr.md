# ADR Review

## In-force ADRs reviewed
- ADR-0004 — Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix
- ADR-0009 — Make the selected Terminay Server the sole owner of project environment connections
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

## Decisions recorded
_No durable architectural decisions were introduced by this change._ Privileged
process inspection stays inside the owning environment or host boundary per
ADR-0009, and the terminal-session boundary asserted by ADR-0011 is what the
change enforces on close protection.
