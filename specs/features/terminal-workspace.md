# Terminal workspace

## Summary

Terminay provides native PTY terminals inside the project workspace. Terminay
Server creates and owns each session; xterm renders it in a client panel and
forwards input, resize, and lifecycle commands through the application
protocol.

## Behaviour

- New sessions resolve the configured shell and launch mode, including sessions
  created through the server-owned workspace protocol for new projects, tabs,
  and splits. They inherit a sensible working directory from the active
  terminal/project when applicable.
- Terminals support splits, search, copy/paste including bracketed-paste-aware
  input, dropped paths, guarded external links, resizing, scrollback, zoom, and
  exit handling.
- A tab can be renamed and styled manually with colour, emoji, terminal-theme
  controls, and an optional note. Tab context actions expose terminal-specific
  actions such as recording and moving it to another project.
- The Command Bar exposes terminal and workspace actions; terminal commands
  report an inline failure rather than silently targeting a different panel.
- PTY output fans out in Terminay Server to authorized clients and recording,
  activity, and agent integrations. These consumers do not change the terminal
  stream.

## Safety and accessibility

The terminal is untrusted text: link navigation is protocol-guarded, paste and
external drop behaviour remain user initiated, and screen-reader/reduced-motion
settings are honoured. Secrets typed in a terminal are not collected by default;
recording has its own explicit policy.

## Ownership and transport

Terminay Server owns PTY creation, output replay, input, resize, activity, and
termination under the
[server runtime and application protocol](./server-runtime-and-protocol.md).
Xterm is a client renderer. A PTY survives browser reload, transport loss, and
Electron-window close while its server remains alive.

Local and remote clients use the same terminal command/stream contract; only
the underlying transport differs.

The server terminal boundary uses immutable `{serverId, projectId, sessionId}`
identity. Input is accepted only for that exact live session and is bounded by
the negotiated input-byte limit; resize and termination use the same
authorization boundary. PTY output is counted in raw bytes, split into bounded
frames, and retained in a bounded replay window with a monotonically increasing
byte position. A reconnect from a position older than the retained window
receives an explicit resync/gap result rather than guessed or duplicate output.
Queued output is bounded per subscriber; a slow consumer is detached without
terminating the server-owned PTY. Exit metadata (code, signal, reason, and
timestamp) is committed and published once. Server shutdown/restart marks live
sessions interrupted once, while client disconnect, reload, and native-window
close do not alter session lifetime.

The transport-neutral `TerminalServiceAdapter` supplies the attach/detach/resume
boundary used by local and remote protocol adapters. It keeps a bounded
per-client/session high-water mark, advances a stale reconnect cursor before
asking the server for replay, and suppresses output at or below the last
delivered position. Detaching closes only that client subscription; the PTY and
its replay window remain owned by the server.

`TerminayTerminalClient` exposes the same boundary over a canonical client
command/subscription transport. A write-authorized client creates a new
server-owned session through `terminal.create`; the server assigns its session
identity and returns its canonical cwd and dimensions. It then uses
`terminal.attach`, `terminal.resume`, `terminal.detach`, and `terminal.ack`,
subscribes to the bounded `terminal`
stream, decodes raw output bytes, and rejects events whose immutable identity
does not match the requested session. Client/session high-water marks survive a
detach and stale resume cursors cannot deliver duplicate output. Local sockets,
browser transports, and WebRTC only provide the underlying command and event
transport; they do not own the PTY.

The incremental panel migration uses `TerminayTerminalPanelClient`, a
transport-neutral view over that attachment. It exposes raw-byte output,
exit/resync notifications, and attachment-scoped input, resize, kill, and
acknowledgement commands. The adapter has no Electron or Node dependency, so a
Desktop panel can adopt it while retaining xterm's existing rendering and
host-only preload capabilities.

The production shared Terminal route body is project-scoped from the current
server-owned workspace snapshot. Creating a terminal is a server-owned
workspace mutation: the server creates the PTY session and the corresponding
terminal panel record, commits both under the next workspace revision, and
publishes the ordered workspace event consumed by every connected client.
Renderer code must not create durable terminal panel identity as a fallback for
missing server state. It may only mount the xterm body for a server-owned panel,
attach through `TerminayTerminalPanelClient`, and keep temporary local
measurements that are either discarded or committed through explicit workspace
commands.

While the remaining Desktop renderer paths are migrated, their terminal
mutations use the compatibility-only `DesktopTerminalAuthorityAdapter`. It is
a thin view over `TerminayTerminalClient` and accepts only the immutable
server/project/session identity plus client authorization; legacy
`webContentsId`, `windowId`, and `rendererId` ownership fields are rejected.
This boundary does not import Electron or call `window.terminay`, and it does
not change the server-owned PTY lifetime.

`TerminalInputSourceAdapter` is the server-side write boundary for keyboard,
paste, macro, dictation, MCP, and remote sources. It validates the exact
server/project/session authorization, preserves per-session write ordering,
tracks optional per-source sequence numbers, and applies bounded input
backpressure before forwarding bytes to the PTY. Viewport changes use an
explicit lease: one client claims `wide`, `narrow`, or `mobile` dimensions,
the owner updates or releases them, and an expired/disconnected owner no
longer blocks another client from claiming the session.

## Acceptance outcomes

- Terminal identity survives panel moves and native-window adoption.
- Resize and input reach only the intended live PTY.
- An exited terminal is clearly represented and cannot be accidentally reused as
  a live session.
- Reconnect resumes from a known output position without duplicating the PTY or
  replaying acknowledged output.
- Every Desktop terminal creation path launches the current configured shell,
  or the host's system-shell fallback when no shell is configured.
