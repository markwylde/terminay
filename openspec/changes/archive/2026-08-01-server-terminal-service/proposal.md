## Why

PTY hosts already ran as Node children, but Electron owned their maps, routed
output to a single renderer, and killed sessions by `webContentsId`. A terminal
therefore could not survive a client reload, a native window close, or a remote
reconnect, and no second client could observe the same session.

## What Changes

- Move PTY spawn configuration, child supervision, cwd and process inspection,
  input, resize, kill, exit, and shutdown into server-core behind a
  window-independent adapter; `TerminalService` owns the process and the
  immutable terminal identity.
- Assign immutable server, project, and session ownership at creation, and
  remove PTY lifetime from Electron renderer and window destruction. A
  destroyed web contents detaches subscriptions and marks only the legacy
  compatibility owner as detached; it does not kill a terminal.
- Add per-session output positions, bounded replay snapshots, subscriber
  cursors, duplicate suppression, retained-replay gap errors, bounded output
  queues, and a defined slow-consumer disconnect and resync path.
- Route keyboard, paste, macro, dictation, MCP, and remote writes through one
  authorized input boundary with backpressure, and define terminal-size
  ownership across several attached clients including release, stale clients,
  and narrow viewers.
- Add a transport-neutral `TerminayTerminalClient` and
  `TerminayTerminalPanelClient` contract, adapt Desktop terminal panels to it
  without changing xterm behaviour, and remove terminal application IPC once
  the Local client uses the server transport.
- **BREAKING** for the Desktop compatibility path: a server-backed panel no
  longer falls back to `getTerminalBuffer`, `onTerminalData`, `onTerminalExit`,
  or `killTerminal` preload IPC; attachment failure renders an actionable error
  with an explicit **Retry connection** action.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `terminal-workspace`: terminal sessions become server-owned with a
  transport-neutral attach and detach boundary, positioned replay, an
  authorized input boundary, and a viewport dimension lease.
- `server-runtime-and-protocol`: adds server-owned session lifetime and a
  window-independent PTY adapter to the runtime contract.

## Impact

- `packages/server-core`: `TerminalService`, `ServerTerminalAuthority`, the
  `createNodePtyFactory` seam, terminal protocol dispatch.
- `packages/client-core`: `TerminayTerminalClient`,
  `TerminayTerminalPanelClient`, terminal panel input queue.
- Desktop renderer: Dockview terminal panels attach through
  `TerminalPanelClientContext`; `DesktopTerminalAuthorityAdapter` remains only
  for the non-panel compatibility path.
- Removal of terminal application IPC from the server-backed path.
