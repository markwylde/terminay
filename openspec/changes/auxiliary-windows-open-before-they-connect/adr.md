# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-24
- Reviewer: Claude (for Mark Wylde)
- Change: auxiliary-windows-open-before-they-connect

## In-Force ADR Context Reviewed

Depth of review: every file in openspec/adr/ (0001 to 0141) was listed and its Status and Supersedes lines read to build the supersession graph. ADR-0008, ADR-0013, ADR-0047, ADR-0048, ADR-0075, ADR-0111 and ADR-0115 were read in full; the rest were screened by title and status as not touching window creation, remote connection order, or auxiliary windows.

- ADR-0048 (a connection belongs to a window; narrows ADR-0013): engaged and kept. Each auxiliary window still opens its own connection with its own window id; only the order of window creation and connection changes. Its rejected alternative, sharing one connection between windows in the host, stays rejected. Desktop still opens one connection at a time per server; cancelling on close keeps a closed window from holding that queue.
- ADR-0013 (device-bound approval and channel-only credentials), as narrowed by ADR-0048: kept; nothing about credentials or tickets changes.
- ADR-0047 (a window is one server, Desktop runs its packaged bundle; supersedes ADR-0018, which superseded ADR-0008): kept. The auxiliary window is bound to the same server as before and runs the same packaged bundle; an unpreparable bundle still leaves no window open.
- ADR-0075 (one Settings surface), as superseded in part by ADR-0111 (Import & Export category) and ADR-0115 (place rail replaces the server selector): kept. The surviving rule used here is the auxiliary-route allow-list (Settings, Performance Log), which is unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The highest ADR sequence number in use is 0141.
