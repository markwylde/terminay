## ADDED Requirements

### Requirement: Client capture responsibilities
Microphone permission, `MediaRecorder` capture, audio level metering, silence
detection, the recorder overlay, Stop, and Cancel SHALL be owned by shared
client UI and SHALL use browser microphone APIs only. The capture path SHALL NOT
depend on a privileged host preload, so the same code serves Desktop and browser
clients.

#### Scenario: Browser client dictates
- **WHEN** a browser client starts dictation
- **THEN** capture, metering, silence detection, and the overlay behave as they
  do on Desktop
- **AND** no privileged host API is used

#### Scenario: Silence stops the recording
- **WHEN** the configured silence threshold is reached
- **THEN** capture stops and the buffered audio is submitted

### Requirement: Capture client boundary
Each capture SHALL be bound at start to one immutable server, project, panel,
and session request in a transport-neutral capture boundary. That boundary SHALL
enforce client-side duration, byte, MIME, cleanup, and cancellation limits as a
bounded state machine.

#### Scenario: Oversized or wrong-type audio
- **WHEN** captured audio exceeds the duration or byte limit, or has an
  unsupported MIME type
- **THEN** the capture boundary rejects it before upload

#### Scenario: Cancel during capture
- **WHEN** the user cancels an in-flight capture
- **THEN** the capture state machine tears down the recorder and releases its
  buffers without submitting audio

### Requirement: Execution-location disclosure
Before capture begins, the client SHALL present the selected server and the
transcription provider that will execute the request. The capture boundary
SHALL accept only a confirmed disclosure, and SHALL reject a disclosure
containing credential-shaped fields.

#### Scenario: Disclosure not confirmed
- **WHEN** capture is requested without a confirmed disclosure
- **THEN** the capture boundary refuses to start

#### Scenario: Disclosure carries a credential
- **WHEN** a disclosure payload contains a credential-shaped field
- **THEN** the capture boundary rejects it

### Requirement: Server transcription responsibilities
Audio upload SHALL be bounded and SHALL apply backpressure, a timeout,
cancellation, media validation, and server-side size and type limits.
Transcription SHALL use server-scoped settings and vault credentials resolved
through a server-side callback. Temporary audio SHALL be removed after both
provider success and provider failure, and provider errors SHALL be redacted
before reaching a client or a log.

#### Scenario: Upload exceeds the server limit
- **WHEN** an upload exceeds the server's byte or duration limit
- **THEN** the server rejects the request and removes any partial temporary
  audio

#### Scenario: Provider failure
- **WHEN** the transcription provider fails
- **THEN** the temporary audio file is removed
- **AND** the client receives a redacted error

### Requirement: Immutable insertion target
A normalized transcript SHALL be inserted only into the original authorized
live terminal named by the capture request, after the request and the session's
liveness are re-validated. Focus, view, window, or connection changes SHALL NOT
retarget an insertion.

#### Scenario: Focus moves before the transcript returns
- **WHEN** the user focuses another terminal while transcription is in flight
- **THEN** the transcript is inserted into the original terminal

#### Scenario: Target exits before insertion
- **WHEN** the originally targeted session has exited
- **THEN** the transcript is discarded rather than inserted elsewhere

#### Scenario: Authorization revoked mid-request
- **WHEN** the requesting device's authorization is revoked during
  transcription
- **THEN** no insertion occurs

### Requirement: Provider credential isolation
Transcription provider keys and plaintext secrets SHALL NOT enter browser or
Desktop UI state, protocol payloads, snapshots, status records, or logs.

#### Scenario: Snapshot inspection
- **WHEN** a client snapshot or status log is inspected after a dictation
  request
- **THEN** it contains no provider key or plaintext secret
