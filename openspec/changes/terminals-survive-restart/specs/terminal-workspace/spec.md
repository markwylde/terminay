## MODIFIED Requirements

### Requirement: Exit and interruption metadata

Exit metadata — code, signal, reason, and timestamp — SHALL be committed and published once, and the canonical workspace session record SHALL be marked exited so a later attach or renderer reload cannot treat that panel as a live PTY. A server shutdown or restart SHALL NOT alter the lifetime of a session that keeps running. A session that is found no longer running when the server starts SHALL be marked ended once, with its exit code when known, while client disconnect, reload, and native-window close SHALL NOT alter session lifetime.

#### Scenario: Terminal exits

- **WHEN** a PTY exits
- **THEN** its code, signal, reason, and timestamp are committed and published once and the session record is marked exited
- **AND** a later attach or renderer reload does not treat that panel as a live PTY

#### Scenario: Closing an exited terminal

- **WHEN** an exited terminal is closed
- **THEN** its panel is removed without recovering the shared application connection or reloading the renderer
- **AND** sibling live terminals stay attached and interactive

#### Scenario: Server restart

- **WHEN** the server shuts down or restarts while a session keeps running
- **THEN** the session stays running and is not marked interrupted

#### Scenario: Session gone at server start

- **WHEN** the server starts and a formerly live session is no longer running
- **THEN** it is marked ended once, with its exit code when one is known
