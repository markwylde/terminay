# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude
- Change: gitea-tea-login-recheck

## In-Force ADR Context Reviewed

- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - re-reading a missing or unwatched file adds no spawn, so background cost is unchanged.
- openspec/adr/0028-no-polling-without-owner-approval.md - no new poll; re-reads happen only on lookups already bounded by the approved Gitea refresh floors or on demand.
- openspec/adr/0063-a-forge-extension-may-ask-the-forge-cli-for-a-token-once-never-per-refresh.md - tea config is read, `tea` is never run; re-reading a missing file is not a spawn.
- openspec/adr/0106-forge-pull-requests-and-issues-come-from-pull-based-on-demand-forge-sources.md - **Check again** reaches the store through the on-demand forge source's account listing.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The fix is a cache-invalidation correction inside `terminay-gitea`'s tea token
store and stays within ADR-0063.
