## ADDED Requirements

### Requirement: Server-owned terminal sessions
Terminay Server SHALL be the sole owner of every PTY process and terminal
stream. A terminal session SHALL receive immutable server, project, and session
identity at creation, and that identity SHALL be the only ownership record. No
renderer identifier, native window identifier, or `webContentsId` SHALL
determine PTY ownership or lifetime. A PTY SHALL survive client reload, client
disconnect, and native-window close while the server remains alive.

#### Scenario: Renderer is destroyed
- **WHEN** a renderer or native window hosting a terminal is destroyed
- **THEN** the server detaches that client's subscriptions
- **AND** the PTY process continues running

#### Scenario: Client reconnects after reload
- **WHEN** a client reloads and reattaches to the same session id
- **THEN** it reattaches to the same live PTY rather than creating a new one

#### Scenario: Exit observed once
- **WHEN** a session exits while two clients are attached
- **THEN** both clients observe exactly one exit event with the same exit
  metadata

### Requirement: Bounded output framing and replay window
Each session SHALL maintain a monotonic output position. The server SHALL retain
a bounded replay snapshot and SHALL track a cursor per subscriber. Delivery from
a stale cursor SHALL be duplicate-suppressed. Queued output SHALL be bounded,
and a consumer that cannot keep up SHALL be disconnected and required to
resynchronize rather than allowed to grow the queue without limit.

#### Scenario: Stale cursor resume
- **WHEN** a client resumes from a position already delivered
- **THEN** the already-acknowledged content is suppressed rather than delivered
  twice

#### Scenario: Slow consumer
- **WHEN** a subscriber stops draining until its bounded queue is exhausted
- **THEN** the server disconnects that subscriber and requires a resync
- **AND** other subscribers and the PTY are unaffected

### Requirement: Replay cap is not a lifetime limit
When a client requests output from a position that has fallen outside the
retained replay window, the server SHALL raise an explicit retained-replay gap
rather than deliver a partial transcript. The client SHALL fail closed: it SHALL
detach the affected attachment, clear the ambiguous emulator buffer, and resume
from the server-provided `replayFrom` cursor with a fresh ordered input queue.

#### Scenario: Requested position has aged out
- **WHEN** a client asks to resume from a position no longer retained
- **THEN** the server reports a retained-replay gap with a `replayFrom` cursor

#### Scenario: Gap recovery
- **WHEN** a client receives a `resync_required` event
- **THEN** it detaches, clears the ambiguous buffer, and resumes from
  `replayFrom`
- **AND** it does not remain interactive over a partially replayed buffer

### Requirement: Transport-neutral attach and detach boundary
Attach, detach, and resume SHALL be expressed as transport-neutral operations
carrying the exact server, project, and session identity plus a cursor. The same
contract SHALL serve local and remote transports without transport-specific
fields.

#### Scenario: Same contract over another transport
- **WHEN** the attachment contract is driven over a different byte transport
- **THEN** attach, detach, resume, input, resize, and acknowledgement behave
  identically

### Requirement: Server-side input write boundary
Keyboard, paste, macro, dictation, MCP, and remote writes SHALL pass through
one server-side authorized input boundary with backpressure. Input, resize, and
kill SHALL be rejected for exited, stale, cross-project, and cross-server
sessions.

#### Scenario: Cross-project write
- **WHEN** a client sends input naming a session that belongs to another
  project
- **THEN** the server rejects the write

#### Scenario: Write to an exited session
- **WHEN** a client writes to a session that has already exited
- **THEN** the server rejects the write rather than reviving or recreating a
  process

### Requirement: Viewport dimension lease
Terminal dimensions SHALL be owned by a lease held by one attached client at a
time, with defined release and stale-client behaviour so that several attached
clients, including narrow or mobile viewers, cannot fight over the grid. A
lease SHALL be released immediately both when an authenticated client
disconnects and when an attachment detaches normally.

#### Scenario: Client disconnects while holding the lease
- **WHEN** the lease-holding client's authenticated connection drops
- **THEN** the lease is released at once
- **AND** the next authorized client can resize the same live session without
  waiting for expiry

#### Scenario: Panel closed or server switched
- **WHEN** an attachment detaches normally
- **THEN** its viewport lease is released immediately rather than blocking the
  next authorized attachment

### Requirement: Output fan-out to integrations
Raw PTY output bytes SHALL be captured once and fanned out to every authorized
consumer — the terminal emulator, recording, activity parsing, and other
server-side integrations — without a second capture path.

#### Scenario: Recording and emulator both attached
- **WHEN** a session is recorded while a client is attached
- **THEN** both receive the same raw bytes from one capture
- **AND** no consumer observes duplicated or reordered output

### Requirement: Transport-neutral panel client
A terminal panel SHALL attach through a transport-neutral panel client that
preserves raw emulator bytes and routes input, resize, kill, and acknowledgement
through the exact attachment. A server-backed panel SHALL NOT fall back to a
host-privileged buffer, data, exit, or kill path. On an attachment failure, or a
failed write, resize, or acknowledgement, the panel SHALL detach the attachment
and its ordered input queue and present an actionable retry rather than sending
later input with an unknown delivery order.

#### Scenario: Attachment fails
- **WHEN** a server-backed panel cannot establish its attachment
- **THEN** it closes its input queue and renders an actionable error with a
  retry action
- **AND** it does not call a host-privileged terminal buffer or data path

#### Scenario: Retry after failure
- **WHEN** the user invokes the retry action
- **THEN** a fresh attachment is created from the client's retained replay
  boundary rather than from a stale interface cursor

### Requirement: Terminal creation is a server-owned workspace mutation
New-terminal and open-at-folder flows SHALL be issued as a write-scoped
terminal creation command. The server SHALL assign the session identity and own
its working directory and dimensions; a client SHALL NOT invent them.

#### Scenario: Client proposes a session id
- **WHEN** a client includes a session identifier in a creation request
- **THEN** the server ignores it and assigns canonical identity itself

### Requirement: Exit and interruption metadata
Session exit and server-restart interruption SHALL each be represented exactly
once, with exact exit metadata in the canonical session snapshot. A configured
successful normal exit SHALL suppress a stale failure notice, while a failed or
signalled exit SHALL retain its exact notice. Malformed runtime exit metadata
SHALL be presented as `unknown` rather than as a non-finite number.

#### Scenario: Successful configured exit
- **WHEN** a session exits normally under a configuration that suppresses the
  notice
- **THEN** no stale failure line is shown

#### Scenario: Malformed exit metadata
- **WHEN** runtime exit metadata is missing or not a finite number
- **THEN** the presentation shows `unknown`

### Requirement: Core terminal interactions
Terminal interactions SHALL live on the shared terminal path and SHALL remain
presentation-only where they do not represent user input. Link activation SHALL
support OSC-8 and detected web links with a pointer affordance, suppressed
duplicate handlers, and a handled external-open failure that permits an
immediate retry. Selection copy SHALL NOT call the clipboard for an empty
selection and SHALL handle a denied clipboard write without an unhandled
rejection. Paste SHALL hand only non-empty text to the emulator and SHALL
refocus the terminal after a denied clipboard or paste failure. In-buffer search
SHALL bind to `Cmd+F` on macOS and `Ctrl+F` elsewhere, excluding mixed and
extended modifier chords. Terminal notes SHALL be isolated from terminal input
and SHALL return focus to the exact terminal on an unmodified `Escape`. Zoom
SHALL retain a readable six-pixel minimum and SHALL reject malformed host
values. Appearance changes SHALL compose presentation-only options without
mutating saved settings. Terminal switching SHALL claim only non-repeating
`Alt+Tab` and `Alt+Shift+Tab`. Literal multiline input SHALL be produced only by
non-repeating `Shift+Enter` or `Alt+Enter` as bracketed-paste newline input.
Clear SHALL be presentation-only and scoped to the exact live session.
Scrollback navigation SHALL use only non-repeating unmodified `Shift+PageUp`,
`Shift+PageDown`, `Shift+Home`, and `Shift+End` and SHALL never send terminal
input.

#### Scenario: Cross-session clear event
- **WHEN** a clear event names a different or missing session
- **THEN** no attachment is cleared

#### Scenario: Malformed zoom value
- **WHEN** a host supplies a non-finite zoom value
- **THEN** terminal options are left uncorrupted and the six-pixel minimum is
  preserved

#### Scenario: Extended modifier chord
- **WHEN** the user presses a search, switching, multiline, or scrollback chord
  with extra modifiers
- **THEN** the terminal does not claim it and it remains available to the host
  or shell

#### Scenario: Denied clipboard write
- **WHEN** a clipboard write is denied
- **THEN** the failure is handled without an unhandled rejection and a later
  selection can be copied immediately

### Requirement: File drop behaviour
Portable explorer and text path drops SHALL be handled on the shared terminal
path. Resolution of raw file objects SHALL be fenced behind the explicit
Desktop compatibility branch, so a server-backed or browser panel neither calls a
host-privileged path nor claims a drop it cannot resolve.

#### Scenario: Raw file drop on a browser panel
- **WHEN** a raw file object is dropped on a server-backed or browser terminal
  panel
- **THEN** the panel does not claim the drop and does not call a
  host-privileged path

### Requirement: Renderer does not invent terminal panel identity
Split focus restoration SHALL be scoped to the exact terminal that received a
fresh window-activation pointer event. Stale, future, or malformed activation
timestamps SHALL NOT move focus to another split, and recovery SHALL remain
presentation-only.

#### Scenario: Stale activation timestamp
- **WHEN** a focus restoration carries a stale or malformed activation
  timestamp
- **THEN** focus is not stolen from another split
