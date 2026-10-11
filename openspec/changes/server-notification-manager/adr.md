# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-11
- Reviewer: Claude (for Mark Wylde)
- Change: server-notification-manager

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - a control-socket token resolves to immutable server, project, and session state; a notification's owner is resolved the same way.
- openspec/adr/0028-no-polling-without-owner-approval.md - the settle period is a timer armed by an event, not a sample on an interval.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - the two new operations get a scope and exactly one permission group.
- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - agent-facing operations go through Terminay's own control endpoint; the notification tools follow the app-window tools.
- openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md - the manager is fed by reducer state changes, not by output.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - removal is server-owned and reaches every window of every device.
- openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md - notification text is never written into a terminal.
- openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md - notifications are live state and are not persisted.
- openspec/adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md - notifications publish as deltas on the ordered journal.
- Remaining in-force ADRs checked against the index by title and scope; none constrains this change and none is touched by it.

## Repository-Level ADRs Created

- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md - a notification is a record in one server-side manager, added and removed by its terminal, published to every consumer only after a settle period; supersedes nothing.

## Notes

- ADR-0061 is the foundation ADR-0060 (`pwa-push-notifications`) builds on: push reads the published set.
- The index in `openspec/adr/README.md` has a row for ADR-0061.
