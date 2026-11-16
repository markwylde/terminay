# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude
- Change: bot-files-download-saves

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - Desktop denies browser-initiated downloads; this change keeps that denial and adds a host action instead.
- openspec/adr/0011-security-trust-boundary-model.md - the renderer is untrusted at the host bridge; actions are parsed and bounded, errors are path-free, and saves are document-scoped.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - Desktop runs its packaged bundle (superseding ADR-0018, which superseded ADR-0008), so the renderer helper and host actions ship together.

## Repository-Level ADRs Created

- openspec/adr/0130-desktop-saves-renderer-bytes-through-a-streamed-host-save.md - streamed, user-chosen-destination, whole-or-nothing host save for renderer bytes.

## Notes

The single-payload `preview.download` and `import-export.bundle.save` actions are left unchanged.
