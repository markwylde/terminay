# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-27
- Reviewer: Claude, for Mark Wylde
- Change: app-windows-survive-restart

## In-Force ADR Context Reviewed

- openspec/adr/0035-detached-session-holder-owns-ptys.md - sessions outlive the server; the holder stays PTY-only and is not extended.
- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - a window is a server-owned record of one session; ownership is unchanged, durability is added.
- openspec/adr/0046-window-attachments-are-an-unbounded-streamed-scratch-write.md - uploads in flight are abandoned at shutdown and never persisted.
- openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md - restore runs after reattach and workspace restore, so a restored window always has a visible terminal.
- openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md - a restored window takes its session's current project; no reach changes.
- openspec/adr/0011-security-trust-boundary-model.md - records stay in the server's data root and are reached only through existing session-fenced operations.

## Repository-Level ADRs Created

- openspec/adr/0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md - window records are written by the server under its data root and restored for sessions that survive a restart; the holder stays PTY-only.

## Notes

- ADR-0037 is not superseded: it never committed to in-memory storage, only to server ownership.
