# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-24
- Reviewer: Claude (with Mark Wylde)
- Change: menu-bar-main-window-only

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - Desktop presents the native application menu rather than the in-page menu. This change only narrows which native windows carry the menu bar and stays consistent with it.
- openspec/adr/0011-security-trust-boundary-model.md - No window's preload, sandbox, session or window-open policy changes. The new input handler runs in the main process and targets the window that received the input.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - Host windows keep the same sandboxed, origin-bound configuration.
- Remaining in-force ADRs (0001-0004, 0006, 0010, 0012, 0013, 0015-0017, 0019-0023, 0025-0027) - Not relevant to native menu presentation.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The per-window menu policy is a local Desktop presentation rule captured in the spec requirement "Native menu bar only on project windows". It does not warrant a durable ADR.
