## ADDED Requirements

### Requirement: Bounded and visible pending input

Pending keyboard and clipboard input SHALL have aggregate bounds. Overflow SHALL be visible and SHALL pause input until acknowledged with control available. Unsent successors SHALL be discarded rather than silently truncating a command. Large pastes SHALL deliver Unicode-safe ordered chunks and release retained capacity on completion, cancellation, or discard.

#### Scenario: Keyboard queue fills

- **WHEN** delayed delivery exhausts the terminal's pending keyboard-input bound
- **THEN** the terminal reports the refusal visibly, discards pending unsent input, and requires acknowledgement of the interruption before more input

#### Scenario: Paste capacity fills

- **WHEN** a paste exceeds the aggregate retained clipboard capacity
- **THEN** it is refused visibly rather than retained without a bound or silently truncated

#### Scenario: Competing production sources

- **WHEN** interactive input, a macro, dictation, an automation, or an app-window message is admitted for one terminal
- **THEN** all sources use the same bounded per-session queue with their existing authorization

## MODIFIED Requirements

### Requirement: Transport-neutral attach and detach boundary

The transport-neutral `TerminalServiceAdapter` SHALL supply the attach, detach, and resume boundary used by local and remote protocol adapters. It SHALL use the position the display actually rendered or request a fresh presentation. It SHALL NOT substitute a remembered cursor or advance a reconnect cursor on the display's behalf. Detaching SHALL close only that client subscription while the PTY and its replay window remain owned by the server.

#### Scenario: Stale reconnect cursor

- **WHEN** a client reconnects
- **THEN** replay starts from its confirmed rendered position or a fresh checkpoint, without an adapter-owned remembered cursor

#### Scenario: Detach

- **WHEN** a client detaches
- **THEN** only that client's subscription closes
- **AND** the PTY and its replay window remain owned by the server


### Requirement: Client terminal command surface

`TerminayTerminalClient` SHALL expose the same boundary over a canonical client command and subscription transport. A write-authorized client SHALL create a new server-owned session through `terminal.create`, and the server SHALL assign its session identity and return its canonical cwd and dimensions. The client SHALL then use `terminal.attach`, `terminal.resume`, `terminal.detach`, and `terminal.ack`, subscribe to the bounded `terminal` stream, decode raw output bytes, and reject events whose immutable identity does not match the requested session. A resume SHALL name the display's confirmed rendered position or request a fresh checkpoint. Duplicate suppression SHALL belong to the attachment delivery lane, and a detached client SHALL NOT substitute a remembered delivered position for what the display rendered. Local sockets, browser transports, and WebRTC SHALL only provide the underlying command and event transport and SHALL NOT own the PTY.

#### Scenario: Creating a session

- **WHEN** a write-authorized client issues `terminal.create`
- **THEN** the server assigns the session identity and returns its canonical cwd and dimensions

#### Scenario: Mismatched event identity

- **WHEN** an event's immutable identity does not match the requested session
- **THEN** the client rejects that event


### Requirement: Server-side input write boundary

`TerminalInputSourceAdapter` SHALL be the server-side write boundary for keyboard, paste, macro, dictation, MCP, and remote sources. It SHALL validate the exact server, project, and session authorization, preserve per-session write ordering, track optional per-source sequence numbers, and bound bytes pending at that admission boundary before forwarding them to the PTY. Acceptance SHALL NOT mean that the shell has consumed or echoed the bytes.

#### Scenario: Concurrent input sources

- **WHEN** keyboard, macro, dictation, MCP, and remote input arrive for one session
- **THEN** per-session write ordering is preserved and bounded pending-byte admission is applied before bytes reach the PTY adapter

#### Scenario: Input reaching only its own PTY

- **WHEN** input or resize is submitted for a session
- **THEN** it reaches only that intended live PTY

## ADDED Requirements

### Requirement: Input interruption notices reflect readiness

An input interruption notice SHALL remain visible while its current attachment cannot accept input. Its action SHALL indicate waiting until control and attachment hydration permit continuation. A read-only replacement SHALL NOT dismiss the interruption or enable typing.

#### Scenario: Notice during replacement

- **WHEN** an uncertain-outcome or overflow notice is visible before the replacement holds control
- **THEN** the notice remains visible and continuation waits until a controller attachment is ready
