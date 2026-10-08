# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-17
- Reviewer: Mark Wylde
- Change: fix-extension-failure-ends-desktop

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - its **Server → extension child** row makes crash isolation the invariant for this boundary. An unheard child `error` event aborting Desktop main violated it; this change restores it without changing what the boundary is.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - provider observation contract; lifecycle publication semantics are unchanged, only a queued frame is no longer mistaken for a lost one.
- openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md - language-server extensions share the host and child; they gain the same containment.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Changing Desktop main's abort-on-uncaught-exception policy would be an architectural decision and is explicitly out of scope. Owning every expected child, channel, and stream failure is a correction under ADR-0011.
