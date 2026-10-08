# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-09
- Reviewer: Claude (for Mark Wylde)
- Change: folders-dirty-means-unpushed

## In-Force ADR Context Reviewed

Depth of review: every ADR was screened by its title only. The notes below say what each engaged title asks of this change; none was read in full.

- openspec/adr/0011-security-trust-boundary-model.md - the renderer stays untrusted. It receives three more read-only facts in an existing query result and gains no command.
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - the measurement runs in worktree paths the server already resolved for the listing.
- openspec/adr/0028-no-polling-without-owner-approval.md - nothing is polled; a push is seen through the existing Git directory watch.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - the added cost is at most one Git command for a remeasured worktree that has commits to size.
- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - pull request and check facts are presented as before; only the rule for `no PR` reads the new facts.
- Screened by title and not engaged: every other ADR from 0001 to 0054.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It adds fields to an existing read-only listing and changes how one renderer surface reads them.

## Notes

The highest ADR sequence number in use is 0054.
