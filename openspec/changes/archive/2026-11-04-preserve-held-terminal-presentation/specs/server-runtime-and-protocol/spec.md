## MODIFIED Requirements

### Requirement: Server-owned session lifetime

PTYs and server-side agents SHALL be owned by the server, not by a renderer, browser tab, Electron window, or individual transport connection, and SHALL continue running through client disconnect, reload, window close, and temporary network loss. A client SHALL be able to resubscribe using session identity and output position without duplicating the PTY or replaying already acknowledged output. An explicit terminal-close command SHALL end the PTY for all clients. When a session holder retains a running PTY through a server-process restart, the server SHALL adopt that same process and its recoverable presentation. Durable workspace state SHALL record interruption for processes that were not retained and SHALL NOT present an ended process as live.

#### Scenario: All clients disconnect

- **WHEN** every client closes
- **THEN** active PTYs keep running and the server stays alive

#### Scenario: Resubscribing

- **WHEN** a client resubscribes with a session identity and output position
- **THEN** the PTY is not duplicated and already acknowledged output is not replayed

#### Scenario: Explicit close

- **WHEN** a client issues an explicit terminal-close command
- **THEN** the PTY ends for all clients

#### Scenario: Server restart

- **WHEN** the server process restarts
- **THEN** sessions retained by a holder are adopted with the same process identity
- **AND** durable workspace state records interruption for processes that were not retained and does not present an ended process as live

### Requirement: Bounded authenticated holder presentation transfer

Holder presentation recovery SHALL remain internal to the authenticated holder/server connection. Restoration bytes SHALL travel in bounded binary payloads with validated session identity, geometry, format, lengths, and byte positions. A recovery snapshot SHALL be installed before later output is parsed or clients hydrate.

#### Scenario: Unauthenticated peer requests presentation

- **WHEN** a peer has not completed the holder authentication handshake
- **THEN** the holder sends it no terminal presentation or output

#### Scenario: Transfer is malformed or crosses sessions

- **WHEN** a presentation transfer exceeds its bounds, has invalid positions, or names another session
- **THEN** the server refuses that transfer without applying it to any terminal

#### Scenario: Queries appear in held output

- **WHEN** terminal output requests cursor, palette, mouse-mode, or other protocol replies
- **THEN** the holder observes presentation without forwarding emulator replies to the PTY

### Requirement: Holder presentation is bounded and observational

The holder SHALL bound presentation memory and parsing work, SHALL NOT forward terminal-emulator replies to its PTYs, and SHALL NOT persist running terminal output to disk. Exhausting presentation resources SHALL NOT end the PTY or disrupt its existing live output stream.

#### Scenario: Untrusted output exhausts presentation bounds

- **WHEN** terminal output exceeds the holder presentation limits
- **THEN** presentation recovery reports a bounded failure while the same process and existing live output continue
- **AND** the holder creates no running-output disk journal
