## ADDED Requirements

### Requirement: Interactive presentation lease
The server SHALL hold one interactive presentation lease per terminal session, keyed on the
exact `{serverId, projectId, sessionId, clientId, attachmentId}` identity. The lease SHALL have
a bounded expiry with renewal, explicit release, cleanup on disconnect, server-side revocation,
and an observable revision. The complete emulator data stream and every viewport change SHALL be
gated by that lease. A non-holder SHALL render live output read-only and SHALL NOT send
keyboard input, paste, resize, or automatic terminal responses. Enforcement SHALL be
server-authoritative and SHALL NOT be widened by client-supplied focus, title, project, or
session metadata.

#### Scenario: One reply per terminal query
- **WHEN** two emulators are attached and the shell queries colours, device attributes, status, cursor position, window state, focus, or mouse mode
- **THEN** exactly one response reaches the PTY and no printable OSC or CSI text appears at the prompt

#### Scenario: Observer attach is inert
- **WHEN** a second client attaches to an existing session
- **THEN** the PTY dimensions are unchanged and no bytes are injected

#### Scenario: Unauthorized input rejected
- **WHEN** a non-holder sends keyboard input, paste, or a resize
- **THEN** the server rejects it and the PTY is unaffected

#### Scenario: Client metadata cannot widen authority
- **WHEN** a client supplies focus, title, project, or session metadata that would imply ownership
- **THEN** the server ignores it and the lease holder is unchanged

### Requirement: Initial presentation ownership
Presentation ownership SHALL be acquired or taken over only through explicit user intent.
Attachment, focus change, output receipt, reconnect, and background rendering SHALL NOT acquire
or steal the lease. Simultaneous takeover requests SHALL resolve deterministically. Takeover
SHALL be audited as bounded metadata without recording terminal content.

#### Scenario: No silent steal
- **WHEN** a second client attaches, gains focus, receives output, or reconnects
- **THEN** the existing holder keeps the lease

#### Scenario: Concurrent takeover
- **WHEN** two clients request takeover at the same time
- **THEN** exactly one becomes the holder by a deterministic rule and the other is told it did not

### Requirement: Control bar and takeover presentation
Every attached client SHALL present whether it is the controller or read-only, and SHALL offer
an accessible explicit takeover action in both wide and narrow layouts.

#### Scenario: Read-only client
- **WHEN** a client is attached without the lease
- **THEN** it presents read-only state and an accessible takeover action

### Requirement: Non-interactive sources do not own presentation
Macro, dictation, and MCP writes SHALL use their own separately authorized ordered server input
paths and SHALL NOT acquire, hold, or disturb the interactive presentation lease.

#### Scenario: Macro write during read-only attachment
- **WHEN** an authorized macro, dictation, or MCP write is delivered to a session
- **THEN** it is applied in order through its own input path and the interactive lease holder is unchanged

### Requirement: Attach begins at a valid presentation boundary
Attach SHALL hydrate a client from a bounded validated presentation checkpoint tied to an exact
raw-output position, and SHALL then deliver every subsequent raw output byte exactly once with no
gap between the checkpoint and live output. Replay SHALL NOT begin at an arbitrary byte suffix of
retained output. When no valid checkpoint is retained, the server SHALL return an explicit
resync or unavailable presentation state.

#### Scenario: Fresh client hydration
- **WHEN** a fresh client attaches to a running session
- **THEN** it receives a valid checkpoint and then every later output byte exactly once

#### Scenario: No valid checkpoint
- **WHEN** no valid checkpoint is retained for the session
- **THEN** the server returns an explicit resync or unavailable presentation state instead of an arbitrary byte suffix

#### Scenario: Checkpoint at a sequence boundary
- **WHEN** a checkpoint falls at any byte boundary within a CSI, OSC, DCS, UTF-8, alternate-screen, bracketed-paste, cursor/style, or synchronized-output sequence
- **THEN** the hydrated screen and modes are correct

### Requirement: Checkpoint hydration authorization
Checkpoint memory, serialization size, generation work, generation frequency, and per-client
hydration queues SHALL be bounded, and PTY output SHALL be treated as untrusted throughout
checkpoint generation and hydration.

#### Scenario: Hostile output
- **WHEN** the PTY emits malformed or hostile control sequences
- **THEN** checkpoint generation stays within its bounds and does not produce an invalid presentation state

#### Scenario: Slow client
- **WHEN** a client cannot consume its hydration data promptly
- **THEN** its hydration queue stays bounded and other clients are unaffected
