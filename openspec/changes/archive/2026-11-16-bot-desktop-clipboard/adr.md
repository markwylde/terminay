# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: bot-desktop-clipboard

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the server UI host denies ambient clipboard-read, so host text reaches the bot only through a user-initiated native paste.
- openspec/adr/0012-pwa-framed-session-host.md - browser sessions use the in-page Clipboard API that the frame delegates.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - the viewer and server may run different versions (it supersedes ADR-0018, which superseded ADR-0008). The design states the Latin-1 fallback for that skew.
- openspec/adr/0112-terminal-output-may-write-but-never-read-the-viewing-devices-clipboard.md - bot-to-host uses the same semantic write route, 1 MiB bound and control-character rejection.
- openspec/adr/0098-bot-desktop-owns-graphical-applications.md - the desktop stays inside the bot's container, and no host authority is added.
- openspec/adr/0127-a-bots-executions-share-its-shell-and-desktop.md - executions share the desktop. Clipboard sharing is gated on the user's focus, not on execution identity.

## Repository-Level ADRs Created

- openspec/adr/0128-a-bot-desktop-shares-the-clipboard-only-while-the-user-controls-it.md - clipboard sharing in control mode only. Host to bot only through the native paste of the user's shortcut. Bot to host only while the user is focused on the visible desktop, through the host's semantic write. PRIMARY is never sent, and every running container is enforced at control open. Extended UTF-8 cut text is admitted within 1 MiB.

## Notes

ADR-0128 is new in this change and is listed in `openspec/adr/README.md`.
