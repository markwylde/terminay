# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-28
- Reviewer: Claude (with Mark Wylde)
- Change: workspace-status-bar

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - The terminal working directory has no watch. The status bar queries it on demand, on focus change, window focus and input settle, and never on a timer.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - Desktop keeps its native menu and browser hosts keep the in-page menu. **Show Status Bar** is added to both.
- openspec/adr/0011-security-trust-boundary-model.md - No preload API, IPC channel or protocol message is added. Each workspace renders only its own project's focused terminal.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - Each cwd query spawns a process-table walk. On-demand refresh keeps idle spawns at zero.
- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - The branch chip reads the existing typed worktree status and adds no Git queries.
- Remaining in-force ADRs (0001-0006, 0010, 0012, 0013, 0015-0017, 0019, 0020, 0023, 0025-0027, 0030, 0031) - Not relevant to workspace chrome presentation.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The status bar is renderer presentation over existing data. Its refresh strategy applies ADR-0028 as written and does not extend it.
