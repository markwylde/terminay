# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-09
- Reviewer: Claude (for Mark Wylde)
- Change: worktree-folder-single-line

## In-Force ADR Context Reviewed

Depth of review: every ADR from 0001 to 0054 was screened by its title only. The notes below say what each engaged title asks of this change; none was read in full, and the supersession graph was not rebuilt from the `Supersedes` fields.

- openspec/adr/0011-security-trust-boundary-model.md - the renderer stays untrusted. It reads two more fields of a listing it already receives and gains no command.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - the label is presentation only. A folder's id, its link, and its panels are untouched, and no authority is derived from the label.
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - the location shown in the tooltip is the path the server resolved for the worktree; the client supplies none.
- openspec/adr/0028-no-polling-without-owner-approval.md - the tooltip delay is a single timer per hover, not a poll.
- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - pull request and check chips are presented as before.
- Screened by title and not engaged: every other ADR from 0001 to 0054.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It changes how one renderer surface names a linked folder and adds a tooltip; server state, the protocol, and persistence are unchanged.

## Notes

The highest ADR sequence number in use is 0054.
