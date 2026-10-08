# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-08
- Reviewer: Claude (for Mark Wylde)
- Change: folders-sidebar-cards

## In-Force ADR Context Reviewed

Depth of review: the context and decision of 0049 were read. Every other ADR was screened by its title and `Status` line only, which is enough to build the supersession graph and to see that a renderer presentation change over existing commands does not engage it.

- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - a folder is a server-owned workspace object that carries no authority. Reordering folders and creating a terminal in a chosen folder grant nothing, and folder order stays the server's.
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - the New terminal row names a folder id only; the server resolves where the terminal starts.
- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted. No privileged call, protocol command, or Electron IPC is added; `folder.reorder` already exists and is validated by the server.
- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - the chips present the pull request and check facts the host already publishes and ask for nothing new.
- openspec/adr/0052-terminals-report-git-commands-to-the-server-through-git-trace2.md - how the server learns which terminal created a worktree is untouched; only the device's notice about the resulting move is removed.
- openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md - moving a terminal back to General is a folder move inside one project and retires nothing.
- openspec/adr/0028-no-polling-without-owner-approval.md - nothing is polled; the narrow layout is a CSS container query, not a timer or an observer loop.
- Screened by title and not engaged: 0002, 0003, 0005, 0006, 0007, 0012, 0013, 0015, 0016, 0017, 0019, 0020, 0021, 0023, 0025, 0026, 0027, 0031, 0033, 0034, 0035, 0036, 0037, 0038, 0039, 0040, 0041, 0042, 0044, 0045, 0046, 0047, 0048, 0051, 0053.
- Superseded and treated as history only: 0001 (by 0033), 0004 (by 0035), 0008 (by 0018), 0009 (by 0017), 0010 (by 0032), 0014 and 0024 (by 0025), 0018 (by 0047), 0022 (by 0028), 0030 (by 0031), 0032 (by 0036).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It redraws one renderer surface, calls a workspace command that already exists, and removes a notice.

## Notes

The highest ADR sequence number in use is 0053.
