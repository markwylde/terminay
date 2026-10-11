# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-11
- Reviewer: Claude, for Mark Wylde
- Change: typing-echo-not-working

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - the rule is evaluated when output arrives and adds no timer or deadline.
- openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md - the new check is constant work per output chunk, and suppressed echo publishes fewer events than today.
- openspec/adr/0011-security-trust-boundary-model.md - project and session fencing in the reducer runs before the new check; unchanged.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - provider-backed sessions are outside the raw-output tier; unchanged.
- openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md - activity stays live server state; unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

- The change is a tactical rule inside the existing server activity reducer. It introduces no new pattern, boundary, or contract beyond the requirement added to `terminal-activity-signals`.
