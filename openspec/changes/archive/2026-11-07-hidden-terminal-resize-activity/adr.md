# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-07
- Reviewer: Claude (for Mark Wylde)
- Change: hidden-terminal-resize-activity

## In-Force ADR Context Reviewed

- openspec/adr/0035-detached-session-holder-owns-ptys.md - PTYs may live in a holder; the resize report sits in `TerminalService.resize`, after the PTY accepts the size, so it holds for either PTY owner.
- openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md - the resize window is one timestamp comparison per output event, so per-output cost is unchanged.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the visibility rule lives in the shared workspace UI, not in a host.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - "on screen" means the selected folder of the project in front, which the workspace already computes.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Both rules extend existing ones: the 1 s input-echo window in the raw-output tier, and the zero-size fit guard in the terminal panel.
