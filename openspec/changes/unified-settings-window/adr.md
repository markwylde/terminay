# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-26
- Reviewer: Claude (with Mark Wylde)
- Change: unified-settings-window

## In-Force ADR Context Reviewed

- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - Settings stays a management window in the shared frame. Macros' close confirmation uses the frame's refuse-dismissal path.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - the Recordings section and replay tabs are Home tabs, device-local presentation.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - the Settings server selector and per-connection clients are unchanged.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - the Settings window is still its own workspace client; no connection is shared.
- openspec/adr/0012-pwa-framed-session-host.md - on framed sessions the manager owns saved profiles, so Saved servers lists attached connections only.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - pairing, approvals and revocation keep their device-bound flows; only where they are hosted changes.

## Repository-Level ADRs Created

- openspec/adr/0075-management-lives-in-one-settings-surface.md - Settings is the only management surface, collections use a list column, workspace content lives in Home, scoping stays explicit, and the first menu is Terminay.

## Notes

- No in-force ADR is superseded.
