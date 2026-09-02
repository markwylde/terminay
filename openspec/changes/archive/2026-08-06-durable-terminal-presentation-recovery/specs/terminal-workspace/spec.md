## ADDED Requirements

### Requirement: Layout changes preserve terminal presentation
Emulator lifetime SHALL be tied to the terminal panel and the immutable
terminal session identity. Project-root, sidebar, file-upload capability,
settings, and layout context changes SHALL NOT clear, replace, detach, or
rehydrate a live display. Terminal settings and dimensions SHALL update the
existing emulator through their own effects.

#### Scenario: Project root changes
- **WHEN** the user changes the project root while a terminal is live
- **THEN** the same emulator and the same attachment are retained
- **AND** prior content and subsequent input remain usable

#### Scenario: Settings or dimensions change
- **WHEN** terminal settings or dimensions change
- **THEN** the existing emulator is updated in place rather than rebuilt

#### Scenario: Drop capability changes
- **WHEN** browser drop-upload capability changes
- **THEN** the emulator and attachment are unaffected

### Requirement: Attach begins at a valid presentation boundary
A fresh attachment SHALL begin at a server-provided checkpoint position rather
than at byte zero. The attach result SHALL carry only bounded checkpoint
metadata: dimensions, a format version, an opaque checkpoint identifier, and
the checkpoint and stream-head positions. Terminal history SHALL NOT travel
inside a command header, and a fresh presentation SHALL NOT be refused merely
because the complete transcript exceeds the command-result replay allowance.

#### Scenario: Session with a very large transcript
- **WHEN** a client attaches to a session whose output far exceeds the
  command-result replay allowance
- **THEN** attach succeeds and returns checkpoint metadata

#### Scenario: Surviving emulator reattaches
- **WHEN** an emulator that still holds rendered content reattaches
- **THEN** it resumes from its last rendered and acknowledged byte position
- **AND** it does not request a fresh presentation

### Requirement: Checkpoint hydration authorization
A checkpoint SHALL be pinned to the exact
`{serverId, projectId, sessionId, clientId, attachmentId}` boundary, and SHALL
be immutable, bounded, and single-attachment. The checkpoint operation SHALL
validate the exact attachment, the opaque checkpoint identifier, the project
claim, the authorization scope, expiry, and size. Snapshot bytes SHALL be
delivered through the binary query-result body rather than base64-encoded JSON.
A pinned checkpoint SHALL be released after a successful fetch, detach, client
close, timeout, or session exit; it SHALL contain terminal presentation only and
SHALL NOT be persisted as workspace metadata or exposed across a project or
session boundary.

#### Scenario: Cross-session reuse attempt
- **WHEN** a client presents a checkpoint identifier issued for another session
  or another attachment
- **THEN** the server rejects the fetch

#### Scenario: Duplicate fetch
- **WHEN** a client fetches an already-consumed checkpoint
- **THEN** the fetch is rejected and the pin is not revived

#### Scenario: Abandoned pin
- **WHEN** an attachment never fetches its pinned checkpoint
- **THEN** the pin expires
- **AND** the PTY and any already attached display are unaffected

### Requirement: Checkpoint restore then fit
A client SHALL establish its attachment subscription before fetching the pinned
checkpoint and SHALL buffer subsequent output under a hard byte limit. It SHALL
restore the checkpoint into an empty emulator at the checkpoint geometry, apply
the ordered raw output and resize tail from the checkpoint position to the
stream head, and only then enter live delivery. It SHALL acknowledge only bytes
actually written by the emulator.

#### Scenario: Output arrives during hydration
- **WHEN** the PTY produces output between subscribe, fetch, and live
  transition
- **THEN** that output is buffered and applied in order exactly once

#### Scenario: Hydration queue overflow
- **WHEN** buffered output exceeds the hard hydration byte limit
- **THEN** that hydration fails closed with a precise recoverability error
- **AND** the PTY and existing displays continue

### Requirement: Protected emulator environment
The server-owned headless terminal state machine SHALL consume accepted PTY
output exactly once in raw byte order, with resize transitions ordered against
output and checkpoint positions. It SHALL NOT forward emulator-generated
replies — device, status, colour, cursor, focus, mouse, or window queries —
into terminal input. Presentation input SHALL remain solely under the existing
controller lease.

#### Scenario: Hostile query sequence
- **WHEN** PTY output contains device, status, colour, cursor, focus, mouse, or
  window query sequences
- **THEN** the headless authority generates no terminal input

#### Scenario: Snapshot boundary safety
- **WHEN** a checkpoint is taken
- **THEN** its position is never inside a UTF-8 sequence or an ANSI control
  sequence
