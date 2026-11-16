# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: server-upgrade-card-header

## In-Force ADR Context Reviewed

- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md (supersedes ADR-0018, which superseded ADR-0008) - the card and the confirmation are drawn by the server-bundled renderer the window runs; hosts and the protocol are unchanged.
- openspec/adr/0053-in-page-windows-share-one-modal-frame.md, as amended in part by openspec/adr/0125-compact-drawers-and-sheets-are-navigation-surfaces.md - the confirmation stays in the shared `InPageWindow` frame; giving that frame's title a tooltip is a change to the shared frame, so it is specified in `in-page-windows`.
- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md, as superseded in part by openspec/adr/0117-installing-a-channels-latest-build-may-move-backwards-only-on-explicit-request.md - the upgrade and Install latest flows, and what the server publishes, are unchanged; the Install latest confirmation title is covered alongside the upgrade one.
- openspec/adr/0125-a-server-upgrade-attempt-is-owned-by-the-server-and-ended-by-the-upgraders-record.md - the card's steps and outcome remain derived as before; only their presentation changes.
- openspec/adr/0011-security-trust-boundary-model.md - presentation only; no new privileged capability or data.

## Repository-Level ADRs Created

- None: layout and appearance choices are tactical and recorded in design.md.
