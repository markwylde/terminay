## ADDED Requirements

### Requirement: Read-only replay
Recording replay SHALL be bounded. It SHALL read the cast through bounded chunks and
checkpoints rather than loading a complete cast into client memory, SHALL support seeking to
a nonzero offset, and SHALL handle malformed or truncated input and cancellation without
failing the surrounding surface.

#### Scenario: Bounded incremental replay
- **WHEN** a long recording is replayed
- **THEN** data is delivered through bounded chunks from bounded checkpoints
- **AND** no complete cast is read into client memory

#### Scenario: Malformed input
- **WHEN** a cast is malformed or truncated, or replay is cancelled
- **THEN** replay stops with a recoverable state and no partial write occurs

### Requirement: Recording deletion
Recording actions SHALL address recordings by opaque id only. Client-supplied filesystem
paths SHALL NOT be accepted for read, delete, or reveal, and deleting an active recording
SHALL be rejected.

#### Scenario: Opaque ids only
- **WHEN** a client requests read, delete, or reveal for a recording
- **THEN** only an opaque recording id is accepted and public DTOs carry no path
- **AND** a filesystem path supplied by the client is refused

#### Scenario: Active recording delete
- **WHEN** deletion is requested for a recording that is still capturing
- **THEN** the request is rejected and capture continues

### Requirement: Input recording consent
Local and remote terminal input SHALL reach capture through one shared privileged input
boundary, and input policy changes SHALL take effect on a live recording.

#### Scenario: One privileged input boundary
- **WHEN** authenticated remote input is delivered for a recorded session
- **THEN** it reaches the single privileged input boundary exactly once
- **AND** local input uses the same boundary

#### Scenario: Live policy change
- **WHEN** the input recording policy changes during an active recording
- **THEN** subsequent input follows the new policy without restarting capture

### Requirement: Storage safety and recovery
Recording storage SHALL recover from interruption at startup, including a cast created
before its sidecar, SHALL retain historical roots across temporary unavailability, and SHALL
clean up after a fatal writer failure. Failures SHALL be reported without exposing paths.

#### Scenario: Cast before sidecar
- **WHEN** the server restarts after a cast file was created but its sidecar metadata was not
- **THEN** startup recovery reconciles the pair without discarding the retained recording

#### Scenario: Temporarily unavailable historical root
- **WHEN** a historical recording root is temporarily unavailable
- **THEN** it is retained rather than forgotten, and listings report a recoverable state

#### Scenario: Fatal writer failure
- **WHEN** a recording writer fails fatally
- **THEN** its resources are cleaned up, the failure is reported without a path, and the PTY is unaffected

### Requirement: Capture lifecycle boundaries
Automatic capture SHALL start at the privileged PTY creation boundary, before the host
receives its create command, so that no output is produced before capture is armed.

#### Scenario: Capture before first output
- **WHEN** a session with automatic recording enabled is created
- **THEN** capture is armed at the privileged PTY creation boundary before the create command returns
- **AND** the first byte of output is recorded
