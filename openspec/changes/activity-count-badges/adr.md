# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-02
- Reviewer: Mark Wylde
- Change: activity-count-badges

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the change stays inside the sandboxed workspace UI with no new host privileges.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the change ships as part of the server-bundled UI; hosts are untouched.
- openspec/adr/0011-security-trust-boundary-model.md - counts derive from server-owned panel params already rendered by the UI; no boundary is crossed.
- openspec/adr/0001, 0002, 0003, 0004, 0006, 0009, 0010, 0012 - reviewed, not relevant to a client presentation change. ADR-0007 is superseded by ADR-0008 and was treated as history only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Presentation-only change to the header activity dropdown and project tab bar. The decision to keep ephemeral activity counts out of the persisted `ProjectTab` model is tactical and recorded in design.md.
