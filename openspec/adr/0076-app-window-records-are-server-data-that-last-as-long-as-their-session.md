# ADR-0076: App window records are server data that last as long as their session

Status: accepted
Date: 2026-10-27

## Context

ADR-0037 made an app window a server-owned record belonging to one terminal
session, and the server kept those records only in memory. ADR-0035 then let a
terminal session outlive the server: a detached session holder owns the PTYs,
and a relaunched server reattaches them. A person who quit Terminay keeping an
agent's terminal running got the terminal back without the window the agent had
shown over it.

The records could live in three places: the session holder, the workspace
snapshot, or the server's own data root. The holder is deliberately minimal and
spans app updates in frozen generations, so whatever it carries must stay
compatible across releases; window records change shape often and carry
documents of up to several MiB. The workspace snapshot is canonical, revisioned
state committed on every workspace command and synced to every client; adding
window documents to it would rewrite them on unrelated commands.

## Decision

1. A window record is written by the server, one file per window, under its
   data root, whenever it changes, and is removed when the window ends.
2. A window lasts exactly as long as its terminal session. After held sessions
   are reattached, the server restores the records of running sessions and
   discards the rest. Detaching from the holder at shutdown releases windows; it
   does not end them.
3. The record keeps what a view starts from (document, data, policy, tool input
   and result), never what a view did since: no typed values, scroll, script
   state, messages in flight, uploads, or mirror recordings.
4. The session holder holds only PTYs. Window state never moves into it.

## Consequences

- An agent's window handle survives a restart, because the id is kept.
- A restored view starts fresh from its document; a person's unsent input in a
  view is lost on restart, as on a takeover by a client that was not mirroring.
- A tool call running when the server stopped is recorded as cancelled; the
  view's later calls to its MCP server fail until that server reconnects.
- Future window fields must decide whether they are part of what a view starts
  from, and so written, or transient.
