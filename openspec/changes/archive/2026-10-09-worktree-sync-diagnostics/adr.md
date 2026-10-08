# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-02
- Reviewer: Claude
- Change: worktree-sync-diagnostics

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - governs the summary flush timer and rules out any cache-verification timer; the design arms a one-shot timer only from an observed event and runs no Git on it.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - the forced measurement spawns Git only on an explicit user action; idle cost is unchanged.
- openspec/adr/0011-security-trust-boundary-model.md - the renderer gains no logging channel; its evidence stays bounded console output observed by Desktop main.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - the Git service reports to whichever host composes it and owns no log sink.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the optional `fresh` request field needs no protocol version change.
- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - worktree-fact refreshes keep announcing changes as before; they are recorded as event-raised synchronisations.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Reporting through a host-supplied observer follows the pattern already used for file-operation failures and agent session sources; it is not a new commitment. If the records gathered by this change show the stale row comes from watch delivery, the fix may warrant an ADR of its own.
