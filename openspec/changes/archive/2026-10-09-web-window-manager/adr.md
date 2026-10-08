# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-08
- Reviewer: Claude (for Mark Wylde)
- Change: web-window-manager

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - remembered geometry lives in storage on the server-bound bundle origin; the About iframe sandbox is unchanged.
- openspec/adr/0011-security-trust-boundary-model.md - the frame is renderer-only and adds no capability or privileged action.
- openspec/adr/0012-pwa-framed-session-host.md - the workspace may itself be framed; windows are sized against the workspace viewport, not the screen.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - precedent for device-local presentation state that never reaches the server.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - one bundle per window; geometry is keyed by window id only, never by server.
- Remaining in-force ADRs (0002, 0003, 0006, 0010, 0013, 0015, 0016, 0017, 0019, 0020, 0021, 0023, 0025-0029, 0031, 0033-0039, 0041-0046, 0048-0052) reviewed by index title; not touched by this change.

## Repository-Level ADRs Created

- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - every in-page window and dialog renders through one modal frame; geometry is a pure model and device-local view state.

## Notes

- No prior ADR is superseded.
- The index in `openspec/adr/README.md` gains the 0053 row.
