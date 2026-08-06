# Terminal workspace

## Summary

Terminay provides native PTY terminals inside the project workspace. Terminay
Server creates and owns each session; xterm renders it in a client panel and
forwards input, resize, and lifecycle commands through the application
protocol.

## Behaviour

- New sessions resolve a server-owned shell profile and working directory
  through the canonical
  [shell profiles and terminal launch](./shell-profiles-and-terminal-launch.md)
  policy. Startup, new-project, new-tab, split, local, and remote creation do
  not maintain separate shell or cwd fallbacks.
- Terminals support splits, search, copy/paste including bracketed-paste-aware
  input, dropped paths, guarded external links, resizing, scrollback, zoom, and
  exit handling.
- Dropping operating-system files onto a Desktop terminal inserts their native
  paths without copying the files. Dropping browser-local files onto a web
  terminal uploads bounded file contents into the selected server project's
  root and inserts the resulting server paths. Browser clients never receive
  or infer a local absolute path.
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

Initial attach and resume replay is capped independently of the retained server
window so its base64 command-result representation always fits the default
protocol header budget. The server enforces the cap even when a client omits or
overstates its requested replay budget, and coalesces contiguous replay chunks
to avoid per-event metadata exhausting that budget. Live output continues on
the ordered terminal event stream after attachment.

The command-result replay cap is not a terminal-lifetime or presentation-size
limit. A fresh display hydrates through a bounded binary checkpoint transfer;
it does not require the complete raw transcript to fit in a command header.
Long-running and high-output terminals therefore remain recoverable after the
raw replay window has advanced. Presentation-unavailable is reserved for a
missing, invalid, or resource-exhausted authoritative checkpoint, not for an
otherwise healthy terminal whose lifetime output exceeds an attach-header
budget.

An attach or resync begins from a valid terminal presentation boundary. The
server never asks a fresh emulator to reconstruct a screen from an arbitrary
byte suffix that may begin inside an escape sequence or depend on discarded
terminal mode history. A bounded checkpoint or equivalent canonical screen
state is tied to an exact output position; live raw bytes continue from that
position without a gap or duplicate. If no valid boundary is retained, the
client receives an explicit unavailable/resync state instead of a plausible but
corrupted terminal display.

Checkpoint hydration is authorized by the immutable, one-use pin bound during
attach to the exact server, project, session, client, and attachment. A mutable
live-attachment registry is not a second authority for that binary handoff:
rapid panel replacement or moving a terminal presentation between projects can
change the live registry while the already-bound checkpoint query is in flight.
The pin remains scoped and unguessable, and replacement releases stale pins.

Workspace metadata and chrome are not terminal presentation lifecycles.
Changing a project root, opening or closing a sidebar, resizing a window, and
other layout-only updates preserve the mounted emulator, its attachment, and
its rendered byte position. A surviving emulator resumes from its exact
acknowledged position after transient transport loss. Only a genuinely new
emulator, such as one created after renderer reload or window restoration,
requests checkpoint hydration.

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

Each live session also has one interactive presentation lease shared by
keyboard/paste input, viewport ownership, and emulator-generated protocol
responses. Only its current holder may forward an xterm `onData` stream into
the PTY. Other authorized clients remain live read-only observers and can
request an explicit takeover; focus, attachment, or receipt of output alone
does not silently seize control. Handoff, disconnect, expiry, and revocation
release the lease predictably and are visible to every attached client.

When a client creates a terminal, the server briefly reserves initial
presentation ownership for that authenticated creator. Reconciliation order
cannot let an observing browser win a race by attaching before the creating
desktop. The creator acquires the lease as part of its serialized attach; if
it disconnects or fails to attach within the bounded reservation, the server
elects an already attached write-authorized observer. For a pre-existing
session with no reservation or holder, the first write-authorized attachment
acquires the lease. Initial ownership is not a takeover and never displaces an
existing holder.
The owning surface shows no controller badge or control affordance. A
write-authorized observer shows takeover UI only while a different live
attachment is the holder, as a full-width terminal bar reading “Another device
is controlling this terminal.” with a “Take back control” action. A lease
conflict is normal read-only presentation state, not a connection failure.
The control bar is an opaque, themed layout row above the terminal viewport;
it reserves its own height and never covers terminal output, the cursor, or the
emulator input surface. Its geometry and appearance are identical in desktop
and browser renderers and remain stable across active-tab changes.
Terminal journal consumers route by the exact server, project, session, client,
and attachment identity before strict event decoding. Auxiliary or other-client
journal payloads cannot detach a valid terminal stream; an unknown event that
does claim the exact attachment still fails closed as a protocol violation.
If control changes while emulator or keyboard bytes are already queued, a
server `presentation_owner` rejection definitively means those bytes were not
delivered. The old controller discards that stale queue and remains attached
as a read-only observer; it does not show a connection error or retry action.
Presentation acquire, takeover, and renewal expose the presentation state as
the standard command result payload. Because presentation state contains its
own `revision`, the server handler must retain the internal command-result
wrapper so the dispatcher does not reinterpret that domain revision as
transport metadata. The wire response still contains exactly one command
result envelope.

Initial ownership and explicit takeover immediately fit the terminal to the
owning surface and submit its current viewport. A resize attempted before the
asynchronous attach completed is retained and submitted once ownership is
known, so an unshared terminal always fills its panel and never retains a
stale observer viewport.

The current presentation holder exclusively defines the canonical PTY columns
and rows. Every accepted holder resize is published to each exact terminal
attachment. Read-only observers adopt that canonical grid locally, scaling it
to their available panel when necessary, but their own layout observers never
submit a resize or alter PTY dimensions. Attach and resume deliver the current
canonical dimensions before replayed output. On takeover, the former holder's
resize lease is released, the new holder clears any observer-size override,
fits its own viewport, and immediately publishes its dimensions. Taking
control back performs the same transition in reverse.

Server-authorized non-interactive sources such as macros, dictation, and MCP
retain their own scoped command authorization and enter the same ordered input
queue, but they do not acquire presentation ownership. Automatic terminal
replies are never identified by filtering particular escape strings: gating the
complete emulator input stream prevents two renderers from answering one PTY
query and injecting duplicate control responses.

## Acceptance outcomes

- Terminal identity survives panel moves and native-window adoption.
- Resize and input reach only the intended live PTY.
- With Desktop and browser clients attached to one session, both render every
  output byte in order, only the visible lease holder can produce interactive
  or emulator-generated input, and explicit takeover transfers that authority
  without duplicated terminal-query responses.
- A sole local or remote attachment silently owns and fills its terminal. No
  controller/read-only badge is shown unless another attachment currently owns
  that presentation; that observer receives the full-width takeover bar.
- A fresh client and a client recovering after a replay gap hydrate from a
  valid presentation boundary and then receive uninterrupted live output; they
  never start inside a partial ANSI/OSC sequence.
- An exited terminal is clearly represented and cannot be accidentally reused as
  a live session.
- Reconnect resumes from a known output position without duplicating the PTY or
  replaying acknowledged output.
- Every terminal-creation route resolves the same profile and cwd for the same
  server, project, active panel, and explicit user choices.
- System-default resolution happens on the server machine that will own the PTY;
  Desktop and remote clients do not supply their host shell as a fallback.
- Every resolved Terminay PTY advertises the emulator it actually runs under
  with `TERM=xterm-256color` and `COLORTERM=truecolor`. Host launcher values
  such as `TERM=dumb` never cross into a terminal session, and profiles cannot
  weaken these protected emulator capabilities.
