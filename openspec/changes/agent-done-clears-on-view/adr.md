# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Claude (for Mark Wylde)
- Change: agent-done-clears-on-view

## In-Force ADR Context Reviewed

- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - state still comes from observed snapshots; acknowledgement only rewrites `done` to `idle` in the server store.
- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md - interaction already removes a terminal's notifications; this aligns the agent state with that same interaction.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - unchanged; detection and snapshot mapping are untouched.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The rule is a product-contract change in `agent-status-and-sidebar`, enforced in the existing server-owned store.
