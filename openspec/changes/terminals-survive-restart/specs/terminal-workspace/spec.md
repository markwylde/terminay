## MODIFIED Requirements

### Requirement: Exit and interruption metadata

Exit metadata — code, signal, reason, and timestamp — SHALL be committed and published once, and the canonical workspace session record SHALL be marked exited so a later attach or renderer reload cannot treat that panel as a live PTY. After server shutdown or restart, a session retained by its holder SHALL be adopted with its process and recoverable presentation. Sessions that were not retained SHALL be marked interrupted once. Client disconnect, reload, and native-window close SHALL NOT alter session lifetime.

#### Scenario: Terminal exits

- **WHEN** a PTY exits
- **THEN** its code, signal, reason, and timestamp are committed and published once and the session record is marked exited
- **AND** a later attach or renderer reload does not treat that panel as a live PTY

#### Scenario: Closing an exited terminal

- **WHEN** an exited terminal is closed
- **THEN** its panel is removed without recovering the shared application connection or reloading the renderer
- **AND** sibling live terminals stay attached and interactive

#### Scenario: Server restart

- **WHEN** the server shuts down or restarts
- **THEN** sessions retained by their holders are adopted and sessions that were not retained are marked interrupted once
