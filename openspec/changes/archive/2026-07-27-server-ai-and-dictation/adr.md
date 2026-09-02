# ADR Review

## In-force ADRs reviewed
- ADR-0003 — Hold server secrets in a vault with AES-256-GCM entries and platform key protectors
- ADR-0004 — Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix
- ADR-0005 — Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

## Decisions recorded
_No durable architectural decisions were introduced by this change._ It applies
ADR-0003's vault as the only source of provider credentials and ADR-0011's trust
boundaries to two features that previously ran inside the Electron host.
