# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-21
- Reviewer: Claude
- Change: stabilise-ci-and-e2e

## In-Force ADR Context Reviewed

- openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md - the shard and budget model is unchanged.
- openspec/adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md - the waiting stays in that client.
- openspec/adr/0103-mcp-never-moves-the-users-view-implicitly.md - only an explicit focus request moves the view.
- openspec/adr/0122-ci-download-caches-can-live-in-daemon-owned-volumes.md - the npm cache location is unchanged.
- openspec/adr/0123-ci-execution-budget-excludes-runner-queueing.md - cold-build time still counts toward the budget.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

These are defect fixes and bounded CI limit changes.
