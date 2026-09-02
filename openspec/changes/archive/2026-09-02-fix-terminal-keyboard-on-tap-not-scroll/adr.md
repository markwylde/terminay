# ADR Review

## In-force ADRs reviewed

- ADR-0005 — Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

The change lives entirely inside the server-bundled workspace UI and crosses none of these boundaries: it adds no host capability, no protocol surface, and no privileged call. It is consistent with ADR-0008 in particular, since the corrected behaviour ships with the server's bundle and reaches Desktop and browser hosts identically.

## Decisions recorded

_No durable architectural decisions were introduced by this change._ Choosing a movement threshold for a tap gesture is a local interaction detail, follows an idiom already established in the codebase, and constrains no future work.
