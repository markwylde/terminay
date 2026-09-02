# ADR Review

## In-force ADRs reviewed

- ADR-0005 — Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts
- ADR-0008 — Ship the workspace UI from the server and keep Desktop and browser hosts protocol-blind
- ADR-0012 — Keep the installable PWA on the manager origin and frame the session origin

The change is confined to layout inside the server-bundled workspace UI and crosses none of these boundaries. It is consistent with ADR-0008: the corrected narrow layout ships with the server's bundle and reaches Desktop and browser hosts identically, with no host-specific path. It touches nothing the framed-session host owns under ADR-0012; the workspace continues to size itself from the box its host gives it.

## Decisions recorded

_No durable architectural decisions were introduced by this change._ Choosing an overlay over a stacked row at one breakpoint is a presentation decision scoped to a single component, and it constrains no future work.
