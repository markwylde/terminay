# Terminal workspace

## Summary

Terminay provides terminal sessions inside the project workspace. Terminay
Server creates and owns each session through the exact project's
[environment](./project-environments.md): This server uses a native PTY, while
providers may control a remote PTY. Xterm renders it in a client panel and
forwards input, resize, and lifecycle commands through the application protocol.

## Behaviour

- New sessions resolve a server-owned shell profile and working directory
  through the canonical
  [shell profiles and terminal launch](./shell-profiles-and-terminal-launch.md)
  policy. Startup, new-project, new-tab, split, local, and remote creation do
  not maintain separate shell or cwd fallbacks.
- Terminals support splits, search, copy/paste including bracketed-paste-aware
  input, dropped paths, guarded external links, resizing, scrollback, zoom, and
  exit handling. Clipboard text that exceeds one terminal-input frame is sent in
  ordered, bounded chunks. The terminal advances the paste one delivered chunk
  per render frame so its compact indicator visibly reports the actual
  delivered-byte percentage for the whole transfer; it must not complete merely
  because the browser or transport has buffered the remainder. The indicator
  includes a Stop control. Stop prevents unsent clipboard chunks from reaching
  the PTY while leaving bytes already accepted by the transport untouched. On Desktop, a user-initiated
  terminal paste prefers copied
  file paths, then text, then converts an image-only clipboard item into a PNG
  in Terminay's temporary clipboard directory and inserts its shell-escaped
  path. Clipboard images and their temporary paths are read and created only by
  Electron; browser clients retain their ordinary exact-origin text paste.
- Desktop Zoom In, Zoom Out, and Reset Zoom change the terminal font size
  only. They publish a `terminal.zoom` host event; they do not zoom the
  surrounding UI.
- Live xterm surfaces use the WebGL renderer when the host provides WebGL2 so
  box-drawing and block glyphs fill the cell. Missing WebGL, a lost GPU
  context, or an automated driver session falls back to the DOM renderer
  without changing PTY behaviour. Server-side headless xterm never loads a
  GPU renderer. Recording replay stays on the DOM renderer: it is not a live
  split-pane atlas surface. Replay list, play, zoom, and palette chrome stay
  mounted if the replay canvas fails to open. Live surfaces pin the xterm 6.1
  WebGL addon so split panes that share a glyph atlas rebuild after atlas
  page merges instead of painting stale glyphs. Custom box-drawing glyphs are
  a WebGL addon option, not a core xterm option.
- On touch devices, xterm owns scrollback and the terminal mouse/key sequences
  required by interactive TUIs. Terminay does not translate or suppress touch
  input over the xterm surface. A synchronous, non-cancelling touch focus
  bridge focuses xterm's helper textarea so iOS can present its software
  keyboard. While that keyboard is visible, Terminay presents a compact
  accessory row immediately above it for Escape, Tab, one-shot Control, Shift,
  and Alt modifiers, arrow keys, Enter, Paste, and keyboard dismissal. The
  accessory sends its bytes through the terminal panel's normal input boundary;
  it never implements scrolling or gesture translation.
- Dropping operating-system files onto a Desktop terminal inserts their native
  paths without copying the files. Dropping browser-local files onto a web
  terminal uploads bounded file contents into the selected server project's
  root and inserts the resulting server paths. Browser clients never receive
  or infer a local absolute path.
- A tab can be renamed and styled manually with colour, emoji, terminal-theme
  controls, and an optional note. Double-clicking the tab or long-pressing it
  opens that editor. Tab context actions expose terminal-specific actions such
  as recording and moving it to another project.
- The Command Bar exposes terminal and workspace actions; terminal commands
  report an inline failure rather than silently targeting a different panel.
- PTY output fans out in Terminay Server to authorized clients and recording,
  activity, and agent integrations. These consumers do not change the terminal
  stream.
- Provider capabilities govern cwd/foreground-process observation. Missing
  observation is an explicit limited state and never inspects a similarly named
  process on the Terminay Server host.

## Safety and accessibility

The terminal is untrusted text: modifier-clicking a detected or OSC-8 HTTP or
HTTPS link opens that credential-free URL in the system browser; other schemes
and URLs with credentials are rejected. Paste and external drop behaviour remain
user initiated, and screen-reader/reduced-motion settings are honoured. Secrets
typed in a terminal are not collected by default; recording has its own explicit
policy.

## Ownership and transport

Terminay Server owns PTY creation, output replay, input, resize, activity, and
termination under the
[server runtime and application protocol](./server-runtime-and-protocol.md).
Xterm is a client renderer. A PTY survives browser reload, transport loss, and
Electron-window close while its server remains alive.

Local and remote clients use the same terminal command/stream contract; only
the underlying transport differs.

High-volume delivery, slow-renderer isolation, attachment-scoped resync, and
recovery after genuine transport loss follow the
[terminal stream congestion and recovery](./terminal-stream-congestion-and-recovery.md)
contract. Terminal presentation congestion never invalidates the shared
workspace connection.

The server terminal boundary uses immutable `{serverId, projectId, sessionId}`
identity. Input is accepted only for that exact live session and is bounded by
the negotiated input-byte limit; resize and termination use the same
authorization boundary. The server also verifies the session's stored
environment equals its canonical project. Clients cannot choose the terminal
adapter with an environment id.
Terminal output is counted in raw bytes, split into bounded
frames, and retained in a bounded replay window with a monotonically increasing
byte position. A reconnect from a position older than the retained window
receives an explicit resync/gap result rather than guessed or duplicate output.
Queued output is bounded per subscriber; a slow consumer is detached without
terminating the server-owned PTY. Exit metadata (code, signal, reason, and
timestamp) is committed and published once, and the canonical workspace session
record is marked exited so a later attach or renderer reload cannot treat that
panel as a live PTY. Server shutdown/restart marks live sessions interrupted
once, while client disconnect, reload, and native-window close do not alter
session lifetime.

Live terminal output uses the protocol frame's binary body. Its event envelope
contains only attachment-scoped identity, byte positions, and output metadata;
the body length must exactly equal `nextPosition - position`. The server may
coalesce adjacent PTY callbacks into one bounded, contiguous body before
framing, but it never reorders, drops, or splits an ANSI sequence by inventing
a byte position. A client advertises `terminal.binary-output` before receiving
these binary event bodies; a compatible server retains the base64 event field
only for clients that do not advertise that capability. Attach-result replay
remains base64 because command-result events have no binary body. This keeps
the wire format compatible while avoiding JSON/base64 expansion and per-chunk
encoding work on the live high-volume path.

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

The client establishes an identity-scoped terminal subscription before it
issues `terminal.attach` or `terminal.resume`, then accepts events only for the
opaque attachment identity returned by that command. It buffers this bounded
handoff until the command result and any authoritative checkpoint are applied.
This ordering closes the live-only interval in which a newly spawned shell can
write after the server allocates its attachment but before a post-command
subscription exists; it does not relax strict contiguous-position validation.

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

`TerminayTerminalPanelClient` is the transport-neutral view over an attachment.
It exposes raw-byte output,
exit/resync notifications, and attachment-scoped input, resize, kill, and
acknowledgement commands. The adapter has no Electron or Node dependency, so a
shared panel uses it identically in Desktop and browser hosts.

The production shared Terminal route body is project-scoped from the current
server-owned workspace snapshot. Creating a terminal is a server-owned
workspace mutation: the server creates the PTY session and the corresponding
terminal panel record, commits both under the next workspace revision, and
publishes the ordered workspace event consumed by every connected client.
The event accelerates reconciliation but is not an acknowledgement: after the
create command returns, the initiating client actively reads the authoritative
delta and completes only when one atomic projection contains both the returned
session and its terminal panel. This remains correct if a change notification
is lost during transport replacement.
Renderer code must not create durable terminal panel identity as a fallback for
missing server state. It may only mount the xterm body for a server-owned panel,
attach through `TerminayTerminalPanelClient`, and keep temporary local
measurements that are either discarded or committed through explicit workspace
commands.

Dockview mounts only the active terminal body, so a newly created terminal
cannot complete xterm hydration while its tab remains inactive. While that
hydration is in progress, the terminal tab uses a small rotating loader in its
icon position and the terminal body remains an undecorated, empty terminal
surface. It must not show a centered Terminay mark or loading copy. The loader
is removed when hydration completes; an attachment failure replaces the blank
state with the existing actionable terminal error presentation.

A newly mounted terminal restores its checkpoint at the checkpoint's original
grid, then fits to the active panel's non-zero viewport before hydration becomes
visible and before it claims the current viewport dimensions from the PTY. A
saved checkpoint grid never leaves a newly activated terminal visibly narrow
when its active panel is wider.

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

Lease expiry distinguishes an abandoned attachment from a temporarily
suspended host. A still-live, write-authorized exact attachment may renew an
unowned lease after its timers resume, including after operating-system sleep;
renewal never displaces a different holder. If a presentation is read-only
while no holder exists, its control surface remains visible and offers an
explicit acquire action rather than silently discarding input behind an
apparently interactive terminal.

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
Congestion recovery must not drop that action or apply it to a detached
attachment: if the observer clicks during checkpoint resync, the replacement
attach performs the requested acquire or takeover. Presentation events with an
older revision must not overwrite a newer local presentation state.
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

The controlling renderer fits its local emulator on every layout observation,
but coalesces a burst of changed viewport dimensions before submitting the
authoritative PTY resize. The initial ownership and explicit-takeover viewport
remain immediate; an interactive window or panel drag publishes its final
settled dimensions once. This prevents resize-sensitive inline terminal UIs
from redrawing their complete history for every intermediate layout frame while
the local display remains responsive.

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
- A controlling attachment that remains live across operating-system sleep
  renews an otherwise unowned lease when its timers resume. If automatic
  renewal cannot restore control, the terminal visibly offers acquisition and
  never remains an unlabelled read-only surface.
- A fresh client and a client recovering after a replay gap hydrate from a
  valid presentation boundary and then receive uninterrupted live output; they
  never start inside a partial ANSI/OSC sequence.
- An exited terminal is clearly represented and cannot be accidentally reused as
  a live session. Closing it removes that panel without recovering the shared
  application connection or reloading the renderer. Sibling live terminals stay
  attached and interactive.
- Reloading a renderer, including a cache-ignoring Force Reload, hydrates each
  still-running session from its checkpoint and makes the restored surface the
  interactive presentation owner. Input and live output resume immediately; a
  stale attachment from the discarded document cannot leave the tab looking live
  while silently discarding keystrokes.
- Reconnect resumes from a known output position without duplicating the PTY or
  replaying acknowledged output.
- Every terminal-creation route resolves the same profile and cwd for the same
  server, project, active panel, and explicit user choices.
- System-default resolution happens in the exact project environment that will
  own the PTY; Desktop and browser clients do not supply their host shell as a
  fallback.
- Every resolved Terminay PTY advertises the emulator it actually runs under
  with `TERM=xterm-256color` and `COLORTERM=truecolor`. Host launcher values
  such as `TERM=dumb` never cross into a terminal session, and profiles cannot
  weaken these protected emulator capabilities.
- Modifier-clicking a detected `http://` or `https://` terminal link, including
  OSC-8 hyperlinks, opens that credential-free URL in the system browser.

## Shared workspace, local view

A workspace's contents are shared; each device's view of them is its own. Two
devices attached to one workspace are two people reading the same book at
different pages.

Workspace facts sync to every device: a terminal existing, its title, its
project, its shell, its output, its removal. Closing a terminal removes it
everywhere, because the terminal is gone.

View state never syncs: which terminal tab is selected, which project tab is
selected, split layout and pane sizes, scroll position, and focus. A terminal
created on one device appears everywhere and is selected only on the device
that created it. A device reading one terminal is never moved to another
because a second device made or selected something.

Each device remembers its own selection per project and restores it on
reconnect. That memory is a hint, not an instruction: a device may reconnect to
a workspace whose projects and terminals have changed entirely, so a remembered
selection is validated against what exists and otherwise discarded. Storage that
is unavailable, full, or disabled means the device starts fresh rather than
failing. A device with nothing selected takes the first terminal it adopts, so
it lands somewhere of its own choosing rather than on a blank workspace or on
another device's page. When the selected terminal is closed anywhere, each
device independently selects a neighbour.
