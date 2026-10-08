# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-24
- Reviewer: Claude (for Mark Wylde)
- Change: custom-about-window

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md — the About window has no
  preload and no script, runs sandboxed, and can hand only three fixed URLs to
  the operating system.

Reviewed and not relevant to this change: every other in-force ADR. The window
touches no server, session, update, or workspace state.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.
