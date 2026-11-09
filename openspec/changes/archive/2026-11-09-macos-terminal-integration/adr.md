# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-09
- Reviewer: Codex
- Change: macos-terminal-integration

## In-Force ADR Context Reviewed

- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md — local paths belong to the embedded server.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md — local launches never switch remote windows.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md — select local presentation by window identity.
- openspec/adr/0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md — validate roots through owning server authority; read with ADR-0102's partial supersession.
- openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md — every created terminal has a visible panel.
- openspec/adr/0082-shell-integration-is-a-server-managed-launch-layer-fed-only-by-data.md — paths remain data.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Folder launch adapts external Desktop intent to existing local server operations. Parsing, queuing, and alternate document registration are feature-level decisions. Accepted records are not edited.
