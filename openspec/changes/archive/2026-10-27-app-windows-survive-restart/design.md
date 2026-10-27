## Context

`AppWindowService` (`packages/server-core/src/appWindows/index.ts`) keeps every window in a `Map` in the server process. Terminal sessions outlive the server because a detached session holder owns the PTYs (ADR-0035), the workspace snapshot keeps their panels, and the Desktop host restores each running terminal's MCP capability (`mcpCapabilities.restore` in `electron/main.ts`), so the agent in a kept terminal can still call Terminay after a restart. Its windows are the one thing that does not come back: the new server starts with an empty map, and composition shutdown calls `appWindows.endAll()` even when it is only detaching from the holder.

The session holder is deliberately minimal and outlives app updates, so anything it carries must stay compatible across releases. The workspace snapshot is the reducer's canonical, revisioned state, committed on every command.

## Goals / Non-Goals

**Goals:**

- A window lasts exactly as long as its terminal session, across server restarts.
- A restored window has the same id, so the agent's handle still works.
- Nothing is restored for a session that did not come back, and nothing is left on disk for it.

**Non-Goals:**

- Restoring what a person typed into a view, its scroll, or its script state. A restored view starts from its document, as on a takeover by a client that was not mirroring.
- Keeping an MCP App's upstream connection, or a running tool call, alive across a restart.
- Changing the session holder or its protocol.

## Decisions

### Window records are server data, not holder data

Records are written by the server under its data root, in `app-windows/`, one file per window named by its id. The holder keeps holding only PTYs.

*Alternatives:* storing records in the holder ties a frozen, version-spanning process to a schema that changes often (sources, CSP, mirror and attachment features) and puts large HTML documents in a process meant to be tiny. Storing them in the workspace snapshot would rewrite up to 8 × 4 MiB of documents on every workspace command and grow the canonical, revisioned state that every client syncs; window records already have their own operations, events, and authority checks.

*Boundary:* this stays inside the server's privileged data root, beside attachments. Records are reachable only through the existing `app-windows.*` operations and MCP tools, under the same session ownership checks; nothing on disk is served to a client directly.

### What is written

The persisted record is the `MutableWindow` minus transient fields: `id`, `terminalSessionId`, `projectId`, `title`, `source`, `state`, `html`, `data`, `csp`, `permissions`, `tool`, `toolInput`, `toolResult`, `toolCancelled`, `contentRevision`, `createdAt`, plus a record schema version. `pendingContext`, `sending`, `upload`, `responses`, and mirror state are never written. Size is already bounded by the existing limits (`MAX_AGENT_WINDOW_HTML_BYTES`, `MAX_MCP_APP_RESOURCE_BYTES`, `MAX_APP_WINDOW_DATA_BYTES`, eight windows per session), so no new cap is introduced.

### When it is written

Every mutation that already calls `publish()` for a single window (open, replace, state change, tool result, tool cancelled) writes that window's file; ending a window deletes it. Writes go through a per-window serial queue using write-to-temp-and-rename, so a crash leaves either the old or the new record. Writes are not awaited by the operation that caused them; a failed write is logged as a diagnostic and does not fail the operation, since the in-memory record stays authoritative while the server runs.

### Ending versus releasing

`endSession`, `close`, and `endAll` (MCP disabled, terminals ended) end windows and delete their files. A new `release()` drops in-memory state, abandons uploads, and stops the mirror without deleting files; composition shutdown calls `release()` when a session holder is present and the terminals are being detached, and `endAll()` otherwise. `endAllTerminalSessions` ends the sessions, whose exit events remove their windows as today.

### When it is restored

In composition start, after `reattachHeldSessions` and `restoreWorkspaceOnStartup`, the service loads every file in `app-windows/`. A record is kept when its `terminalSessionId` is a running session in the terminal service, and takes that session's current project as its `projectId` (the terminal may have been moved since the record was written); otherwise its file is deleted. An unreadable or invalid file is deleted and reported as a diagnostic. An `mcp-app` record with neither `toolResult` nor `toolCancelled` gets `toolCancelled` set (the agent's tool call ended with the old server) and is rewritten. `contentRevision` is bumped once on restore so any cached view is treated as new. One `changed` event is published after the load, which clients already treat as a cue to re-list.

### MCP App calls after a restart

A restored MCP App view calls its server through the existing gateway path, which fails with the ordinary not-connected error until the connected-server registry reconnects that entry. No new state is needed.

## Risks / Trade-offs

- [A large window rewrites up to 4 MiB on each state change] → state changes are rare user actions; writes are serial per window and coalesced to the latest record if one is queued.
- [A disk write fails, and that window is missing after the next restart] → the running server is unaffected; the failure is a diagnostic, and the next mutation retries.
- [A session id is reused by a new terminal after a restart] → session ids are server-issued and unique (terminal session identity requirement), so a record can only ever match the session that wrote it.
- [Windows on a data root from a release without this feature] → nothing is on disk, so the first start restores nothing, as today.

## Migration Plan

No migration. The directory is created on first write. Rolling back to a release without this leaves `app-windows/` unread; a later forward roll discards records whose sessions are gone.

## Open Questions

None. ADR-0037 ("a window is a server-owned record") stays in force; this change adds durability to that record without changing who owns it.
