# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-31
- Reviewer: Claude (with Mark Wylde)
- Change: windows-menu-switcher-scrollbars

## In-Force ADR Context Reviewed

- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md: the workspace UI comes from the server's bundle, so the menu button is offered through `hostPresentation`, and bare-Alt handling stays in main, where an older server's bundle cannot block it.
- openspec/adr/0011-security-trust-boundary-model.md: the renderer may ask main to show its own application menu, but it never names or runs a native command.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md: the button belongs to project-host windows only, and each window asks for its own menu.
- openspec/adr/0083-windows-x64-desktop-joins-the-matrix-and-holders-prove-themselves-both-ways.md: Windows Desktop is in the matrix, so its title bar gets platform-native affordances.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Popping up main's own application menu on request is a narrow host affordance within the existing renderer-to-main boundary. It is not a new pattern.
