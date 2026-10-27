# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-26
- Reviewer: Claude (for Mark Wylde)
- Change: every-live-terminal-has-a-panel

## In-Force ADR Context Reviewed

- openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md: decision 1, "every running terminal belongs to a project and has a panel", is the rule this change enforces. The change adds no new decision. It keeps that rule true between creation and restart, where it was not enforced.
- openspec/adr/0028-no-polling-without-owner-approval.md: the check runs on workspace changes and once at start. Its only timer is a one-shot that exists while a panel-less terminal waits out its grace.
- openspec/adr/0035-detached-session-holder-owns-ptys.md: held shells and reattach are unchanged. The check runs after reattach and covers a persisted record that reattach adopts with no panel.
- openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md and openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md: a recovered terminal keeps its identity and project. A session whose workspace record names another project is left for its move to finish.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md: the panel lands in General, found by kind.

## Repository-Level ADRs Created

- None. The durable decision is already ADR-0071. This change implements it at one point in the server.

## Notes

The highest ADR sequence number in use is 0075.
