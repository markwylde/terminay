# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Mark Wylde
- Change: file-viewer-view-profiles

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted. The tab set and default view are derived from the server's capability snapshot; no authority is inferred from a filename and no privileged call is added.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - supersedes ADR-0008. The switcher, editor theme, and status bar summary are workspace-bundle presentation; hosts stay protocol-blind.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - supersedes ADR-0009. Classification stays on the server that owns the project; `preferredMode` keeps its existing shape.
- openspec/adr/0020-per-operation-canonical-roots.md - unchanged. Capability and diff requests keep their canonical roots; the open question about diffs in secondary worktrees is left to a separate change.
- openspec/adr/0028-no-polling-without-owner-approval.md - the focused-file summary is driven by Dockview events and panel parameter changes, never a timer.
- openspec/adr/0022-watch-do-not-poll.md - unchanged; file size in the status bar follows the existing watch-driven metadata refresh.
- openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md - unchanged; the editor theme recolours tokens only.
- Also reviewed and not engaged by this change: 0001, 0002, 0003, 0004, 0005, 0006, 0010, 0012, 0013, 0014, 0015, 0016, 0021, 0023, 0024, 0025, 0026, 0027, 0029, 0030, 0031, 0032, 0033, 0034. Superseded and treated as history only: 0007, 0008 (by 0018), 0009 (by 0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It changes which view the existing capability snapshot prefers and how the panel presents it.

## Notes

The highest ADR sequence number in use is 0034.
