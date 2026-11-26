# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-26
- Reviewer: Claude
- Change: folder-activity-icon

## In-Force ADR Context Reviewed

Read the ADR folder (0001–0142) and followed `Supersedes:` links to find the ADRs in force that touch the Folders tree, the renderer, or git activity. Of those:

- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted at privileged boundaries; this change adds no IPC, protocol message, or privilege.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md (supersedes ADR-0018, which superseded ADR-0008) - the Folders tree is part of the server-bundled workspace UI; the change stays inside that bundle.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - folders are presentation groups; the activity icon presents state the folder already carries and gives it no new authority.
- openspec/adr/0028-no-polling-without-owner-approval.md (supersedes ADR-0022) - the icon is driven by the existing pull/delete flags; no polling is added.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Renderer-only presentation change; no protocol, persistence, or privilege boundary moves.
