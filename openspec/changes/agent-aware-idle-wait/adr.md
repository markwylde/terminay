# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-04
- Reviewer: Claude (with Mark Wylde)
- Change: agent-aware-idle-wait

## In-Force ADR Context Reviewed

The ADRs in `openspec/adr/` were listed and filtered by title for relevance; those bearing on this change:

- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - agent state is read from the existing reduced snapshot; no new detection path is added.
- openspec/adr/0028-no-polling-without-owner-approval.md - the hold reacts to agent state edges; no timer or poll is introduced.
- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md - MCP `wait_for_idle` keeps its scope and authority; only the meaning of idle changes.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - the wait stays in the server above the holder; detach still resolves outstanding waits.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The injected hold interface on the terminal service is a local seam, not a new architectural boundary: it follows the existing optional-observer pattern (`sessionLifecycle`, `presentationCheckpoints`).
