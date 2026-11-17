# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Codex
- Change: bot-desktop-clipboard-sync

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md — native capability stays narrow and bound to one top-level document.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md — host observes the OS clipboard without decoding server application protocols.
- openspec/adr/0028-no-polling-without-owner-approval.md — a specific fallback monitor requires Mark's approval; none is inferred from the feature request.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md — preserve the native document/server binding.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md — several windows may coexist; clipboard ownership must be explicit.
- openspec/adr/0112-terminal-output-may-write-but-never-read-the-viewing-devices-clipboard.md — terminal OSC 52 semantics remain separate.
- openspec/adr/0129-a-bot-desktop-shares-the-clipboard-only-while-the-user-controls-it.md — initiation and focus restrictions are superseded in part; transport/content/view-only protections stand.
- openspec/adr/0132-desktop-pastes-into-a-bot-desktop-through-the-terminal-paste-bridge.md — shortcut transfer is insufficient for the clarified sync requirement.

## Repository-Level ADRs Created

- openspec/adr/0133-a-selected-control-desktop-synchronizes-clipboard-text.md — one lifecycle-owned bidirectional clipboard sharing session for the selected control desktop.

## Notes

Reviewed all 139 existing repository ADR files and their declared supersession relationships; highest sequence before this change was 0132. Relevant currently applicable boundaries are listed above. Previous accepted records are unchanged. Mark approved the 500 ms session-owned monitor on 2026-11-16; the API evaluation and approval are recorded in design.md.
