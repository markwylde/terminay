# recording Specification

## Purpose

Define optional per-terminal session recording and the replay timeline: server-owned capture at the routed terminal-stream boundary, asciicast persistence, input-privacy consent, storage and retention rules, and read-only replay.

## Requirements

### Requirement: Optional per-terminal recording

Terminay SHALL support optional per-terminal session recording and a timeline for replaying saved sessions. Recording SHALL be off by default and SHALL be enableable for new terminals or started and stopped for one terminal.

#### Scenario: Default state
- **WHEN** Terminay is used without changing recording settings
- **THEN** no terminal is recorded

#### Scenario: Recording a single terminal
- **WHEN** a user starts recording for one terminal
- **THEN** only that terminal's session is captured

### Requirement: Server-owned capture independent of clients

Recordings SHALL live on the selected Terminay Server. Capture SHALL continue independently of client focus, renderer lifetime, or network connection and SHALL NEVER pass through the hosted signaling service.

#### Scenario: Client disconnects during capture
- **WHEN** a client loses focus, reloads, or disconnects while a recording is active
- **THEN** capture continues on the server

#### Scenario: Hosted service is not in the path
- **WHEN** a session is recorded
- **THEN** no recording data passes through the hosted signaling service

### Requirement: Replaceable recording observers

Recording observers SHALL be replaceable subscriptions: disconnecting, reloading, or moving a view SHALL remove only that observer. Multiple observers SHALL receive the same server lifecycle snapshots, while each PTY boundary event SHALL be appended exactly once.

#### Scenario: Multiple observers
- **WHEN** several clients observe the same recording
- **THEN** each receives the same lifecycle snapshots while each PTY boundary event is appended to the recording exactly once

#### Scenario: One observer leaves
- **WHEN** one observing view disconnects, reloads, or moves
- **THEN** only that observer is removed and the recording continues

### Requirement: Capture at the routed terminal-stream boundary

Capture SHALL occur at the Terminay Server's routed terminal-stream boundary so a remote environment can be recorded without writing on the target. Environment identity SHALL be retained as non-secret provenance; cwd and root MAY be remote path text, while reveal and delete SHALL always act on the server recording store.

#### Scenario: Recording a remote environment
- **WHEN** a terminal on a remote environment is recorded
- **THEN** capture happens at the server's routed stream boundary and nothing is written on the target

#### Scenario: Reveal or delete on a remote recording
- **WHEN** a user reveals or deletes a recording whose cwd is remote path text
- **THEN** the operation acts on the server recording store

### Requirement: Terminay Server recording ownership

Terminay Server SHALL own recording policy and storage configuration, capture of PTY output, authorized input, resize, and lifecycle events, asciicast and metadata persistence, recording state, listing, replay reads, and deletion, and path validation, retention, and recovery. Clients SHALL display recording state, request explicit actions, and render replay data through bounded application-protocol transfers, and SHALL NOT require direct filesystem access to use recordings.

#### Scenario: Client without filesystem access
- **WHEN** a client with no direct filesystem access uses recordings
- **THEN** it can display state, request actions, and render replay data through bounded protocol transfers

### Requirement: Canonical recordings client facade

The shared client facade SHALL use the canonical `recordings.*` operations for every host, SHALL validate bounded list, replay, and state DTOs, SHALL cache list queries until an explicit recording mutation including an uncertain reconnect outcome, and SHALL remove project roots and cast paths before data reaches shared UI code. The timeline SHALL use that facade for list, bounded replay, reveal, and deletion on every host. Desktop SHALL supply only the negotiated native reveal presentation and SHALL NOT implement or translate recording operations.

#### Scenario: Cached list invalidation
- **WHEN** a recording mutation occurs or a reconnect outcome is uncertain
- **THEN** the cached list query is invalidated

#### Scenario: Data reaching shared UI
- **WHEN** recording data is handed to shared UI code
- **THEN** project roots and cast paths have been removed

#### Scenario: Desktop reveal
- **WHEN** a user reveals a recording on Desktop
- **THEN** Desktop supplies only the negotiated native presentation while the operation itself runs through the canonical facade

### Requirement: Recording defaults and controls

Recording SHALL be disabled by default. **Record new terminals** SHALL enable automatic capture for terminals created after the setting changes, and existing terminals SHALL NOT begin recording merely because the global default changes. A terminal tab menu SHALL provide **Start Recording** or **Stop Recording** for that exact session. Starting an already active recording and stopping an inactive recording SHALL be idempotent.

#### Scenario: Enabling record-new-terminals
- **WHEN** a user enables Record new terminals
- **THEN** terminals created afterwards are captured automatically and already-open terminals are unchanged

#### Scenario: Redundant start or stop
- **WHEN** a user starts an already recording session or stops an inactive one
- **THEN** the action is idempotent and no error state results

### Requirement: Accessible recording indicator

The recording indicator SHALL be visible without relying only on colour and SHALL have an accessible label.

#### Scenario: Indicator presentation
- **WHEN** a terminal is recording
- **THEN** the indicator is distinguishable without colour alone and exposes an accessible label

### Requirement: Recordings timeline entry point

The Recordings command SHALL open the recordings timeline in a Desktop auxiliary window or an in-page web route.

#### Scenario: Opening recordings
- **WHEN** a user invokes the Recordings command
- **THEN** the timeline opens in a Desktop auxiliary window or an in-page web route

### Requirement: Recording file format

Each session SHALL consist of one asciicast v3 `.cast` file containing the terminal event stream and one adjacent metadata JSON file containing Terminay-specific index data. The cast header SHALL include version, initial terminal dimensions, start timestamp, and optional environment metadata limited to safe display values such as `TERM` and `SHELL`. Events SHALL record time relative to the start and SHALL use `o` for PTY output, `i` for input when input recording is enabled, `r` for terminal resize, and `m` for bounded Terminay markers needed by replay.

#### Scenario: Files written for a session
- **WHEN** a session is recorded
- **THEN** an asciicast v3 `.cast` file and an adjacent metadata JSON file exist

#### Scenario: Header contents
- **WHEN** the cast header is written
- **THEN** it carries version, initial dimensions, start timestamp, and only safe environment display values such as `TERM` and `SHELL`

### Requirement: Writer integrity

The writer SHALL emit complete newline-delimited JSON records, SHALL serialize concurrent writes, and SHALL NEVER leave a partially interleaved event. Timestamps SHALL be monotonic within one recording.

#### Scenario: Concurrent events
- **WHEN** output, input, and resize events arrive concurrently
- **THEN** writes are serialized into complete newline-delimited records with monotonic timestamps and no interleaving

### Requirement: Input recording consent

Input recording SHALL be a separate setting and SHALL default to disabled. When disabled, typed input SHALL NOT be written as `i` events. The UI SHALL explain that enabled input recording can capture passwords, tokens, and other secrets, and Terminay SHALL NOT claim to detect secret prompts reliably. Paste, macros, dictation insertion, MCP writes, and remote writes SHALL follow the same input-recording policy as keyboard input. Disabling input capture SHALL affect later events and SHALL NOT rewrite an existing recording.

#### Scenario: Input capture disabled
- **WHEN** input recording is disabled
- **THEN** no `i` events are written for keyboard, paste, macro, dictation, MCP, or remote writes

#### Scenario: Enabling input capture
- **WHEN** a user enables input recording
- **THEN** the UI explains that passwords, tokens, and other secrets can be captured and that reliable secret detection is not claimed

#### Scenario: Disabling mid-recording
- **WHEN** input capture is disabled during an active recording
- **THEN** later events omit input and already-written events are not rewritten

### Requirement: Recording storage layout

The default recording root SHALL be `~/Documents/TerminaySessions`. Sessions SHALL be grouped under date directories and SHALL use opaque ids in filenames. User-facing titles SHALL be metadata and SHALL NOT be path components.

#### Scenario: Naming a recording file
- **WHEN** a recording is stored
- **THEN** it lives under a date directory with an opaque id filename and its title appears only in metadata

### Requirement: Storage safety and recovery

The server SHALL expand and canonicalize the configured root, SHALL create missing directories with user-only permissions where supported, SHALL prevent traversal outside the configured root for list, replay, delete, and reveal operations, SHALL write metadata atomically, SHALL keep incomplete recordings discoverable and label their state accurately, SHALL preserve configured historical roots in the library index while a volume, network mount, or removable device is temporarily unavailable, SHALL recover a cast created before its metadata sidecar as the same opaque recording id with an `interrupted` state, and SHALL NEVER overwrite a different recording after a title or project rename.

#### Scenario: Traversal attempt
- **WHEN** a list, replay, delete, or reveal request would resolve outside the configured recording root
- **THEN** it is rejected

#### Scenario: Unavailable volume
- **WHEN** a configured historical root is on a temporarily unavailable volume or mount
- **THEN** its entries remain in the library index

#### Scenario: Cast without metadata
- **WHEN** a cast file exists without its metadata sidecar
- **THEN** it is recovered as the same opaque recording id with an `interrupted` state

#### Scenario: Title or project rename
- **WHEN** a recording's title or project is renamed
- **THEN** no different recording is overwritten

### Requirement: Changing the recording root

Changing the recording root SHALL affect new recordings only. Existing entries SHALL remain visible through their recorded roots until removed from the configured library or deleted explicitly.

#### Scenario: New root configured
- **WHEN** a user changes the recording root
- **THEN** new recordings use it while existing entries remain visible through their recorded roots

### Requirement: Recording metadata contents

Metadata SHALL contain a stable recording id and terminal session id, server id and project id, project name and root snapshot, terminal title, note, colour, and emoji snapshot where available, cwd snapshot, start and end timestamps, duration, initial and final dimensions, process exit code or signal when available, a `recording`, `completed`, `interrupted`, or `failed` state, whether input events are present, format and version information, and the relative cast path plus bounded size information. Metadata SHALL update when user-facing terminal information changes during capture. An absent optional field SHALL remain absent rather than being guessed.

#### Scenario: Terminal renamed during capture
- **WHEN** a recording terminal's title, note, colour, or emoji changes
- **THEN** the metadata updates to match

#### Scenario: Unavailable optional value
- **WHEN** an optional metadata value such as an exit code is unavailable
- **THEN** the field is absent rather than guessed

### Requirement: Capture lifecycle boundaries

Automatic capture SHALL start at the privileged PTY creation boundary before the shell can produce its first output event. The first known dimensions SHALL be written to the header and a later fit SHALL emit an `r` event. Output SHALL be recorded once at the server PTY boundary before fan-out to clients. Authorized writes SHALL be recorded once at the server input boundary when input capture is enabled. Terminal exit SHALL finalize the recording exactly once.

#### Scenario: First shell output
- **WHEN** a terminal with automatic capture enabled starts
- **THEN** capture is already active before the shell's first output event

#### Scenario: Terminal resized after start
- **WHEN** the terminal fits to a new size after the header is written
- **THEN** an `r` event records the new dimensions

#### Scenario: Output fan-out
- **WHEN** output reaches multiple clients
- **THEN** it is recorded once at the server PTY boundary

### Requirement: Finalization and interruption

Explicit terminal close, server shutdown, recording stop, and fatal writer error SHALL all finalize with an accurate state. A fatal writer error SHALL close and remove the active writer while retaining its visible failed state. Client disconnect, reload, window close, or view movement SHALL NOT finalize an active recording. A server restart SHALL mark an unfinalized recording interrupted and SHALL preserve its valid events.

#### Scenario: Server shutdown
- **WHEN** the server shuts down with active recordings
- **THEN** each finalizes with an accurate state rather than corrupting the cast

#### Scenario: Server restart with an unfinalized recording
- **WHEN** the server restarts after an unclean stop
- **THEN** the unfinalized recording is marked interrupted and its valid events are preserved

#### Scenario: Client-side lifecycle events
- **WHEN** a client disconnects, reloads, closes a window, or moves a view
- **THEN** the active recording is not finalized

### Requirement: Recording failure does not affect the PTY

Recording failure SHALL NOT interrupt the PTY. The server SHALL publish a visible error and SHALL stop claiming the session is being captured.

#### Scenario: Writer fails mid-session
- **WHEN** the recording writer fails
- **THEN** the PTY continues, a visible error is published, and the session is no longer reported as being captured

### Requirement: Timeline listing and actions

The timeline SHALL list recordings newest first and SHALL support search by title, project, cwd, and date; date and project grouping; recording-state and input-present filters; duration, exit status, and file-size display; replay; reveal on the server host where the client has that capability; and confirmed deletion of the cast and metadata files.

#### Scenario: Searching recordings
- **WHEN** a user searches or filters the timeline
- **THEN** results match by title, project, cwd, date, recording state, and input presence, ordered newest first

#### Scenario: Reveal capability absent
- **WHEN** a client lacks the reveal capability for the server host
- **THEN** reveal is not offered

### Requirement: Timeline resilience to bad data

Missing or malformed metadata SHALL NOT crash the timeline. A valid cast SHALL be shown with reduced metadata, and missing cast data SHALL be shown as unavailable.

#### Scenario: Malformed metadata
- **WHEN** a recording's metadata is missing or malformed
- **THEN** the timeline still renders, showing the valid cast with reduced metadata

#### Scenario: Missing cast
- **WHEN** the cast file is absent
- **THEN** the entry is shown as unavailable

### Requirement: Recording surfaces require the canonical client

The timeline and terminal recording controls SHALL require the selected server's canonical `RecordingsClient`. They SHALL NEVER consult a Desktop recording-service global, translate legacy host method names, or subscribe to a host-local recording state stream. Missing selected-server capability SHALL be a typed unavailable state, and canonical workspace reconciliation SHALL own recording state.

#### Scenario: Server lacks recording capability
- **WHEN** the selected server does not provide the recordings capability
- **THEN** a typed unavailable state is shown rather than falling back to a host-local recording service

### Requirement: Recording deletion

Deleting a recording SHALL be explicit and SHALL NOT escape the configured recording roots. It SHALL NOT close or alter a live terminal. Deleting an actively written recording SHALL require stopping it first or confirming a combined stop-and-delete action.

#### Scenario: Deleting an active recording
- **WHEN** a user deletes a recording that is still being written
- **THEN** the recording must be stopped first or a combined stop-and-delete action must be confirmed

#### Scenario: Deletion and the live terminal
- **WHEN** a recording for a live terminal is deleted
- **THEN** the terminal is neither closed nor altered

### Requirement: Read-only replay

Replay SHALL be read-only and SHALL use xterm-compatible rendering. It SHALL support play, pause, restart, seek, and playback speed; recorded resize events; a visible timestamp and total duration; safe handling of truncated final lines; and bounded incremental loading for large recordings.

#### Scenario: Replaying a session
- **WHEN** a user replays a recording
- **THEN** play, pause, restart, seek, and speed controls work, recorded resizes apply, and timestamp and duration are visible

#### Scenario: Large or truncated recording
- **WHEN** a recording is large or its final line is truncated
- **THEN** loading is bounded and incremental and the truncated line is handled safely

### Requirement: Replay executes nothing

Replay SHALL NEVER execute recorded input, links, commands, or escape-sequence side effects outside terminal rendering. External links SHALL remain guarded by the normal terminal policy.

#### Scenario: Recorded escape sequences
- **WHEN** a replayed recording contains input, links, commands, or escape sequences with side effects
- **THEN** nothing is executed beyond terminal rendering and external links follow the normal terminal policy

### Requirement: Recording security and privacy

Recording SHALL remain opt-in and input capture SHALL require separate consent. Cast and metadata paths SHALL be server-authorized by opaque recording id. Remote clients SHALL receive only recordings within their authorized server scope. Recording data SHALL NOT be uploaded to Terminay-hosted infrastructure. Logs SHALL exclude terminal content and recorded input. Recording lifecycle notifications SHALL be metadata-only; configured roots, absolute cast paths, environment secrets, and recorded input SHALL NOT be copied into observer payloads or normal diagnostics. Secret values from settings or macros SHALL NOT be added to metadata. A recording SHALL be treated as sensitive terminal history in warnings, export, deletion, and support diagnostics.

#### Scenario: Cross-scope request
- **WHEN** a remote client requests a recording outside its authorized server scope
- **THEN** the request is rejected

#### Scenario: Lifecycle notification payload
- **WHEN** a recording lifecycle notification is published
- **THEN** it carries metadata only, without configured roots, absolute cast paths, environment secrets, or recorded input

#### Scenario: Stale or forged request
- **WHEN** a traversal attempt, cross-server id, stale delete request, or unauthorized replay request arrives
- **THEN** it is rejected

### Requirement: Recording non-goals

Terminay SHALL NOT provide cloud sync or automatic upload to asciinema.org, video export, a promise to redact secrets from output or enabled input capture, replay that restores a live process, or a database-backed timeline requirement.

#### Scenario: Upload expectation
- **WHEN** a user looks for cloud sync, upload, or video export of recordings
- **THEN** no such capability exists

#### Scenario: Replay expectation
- **WHEN** a user replays a recording
- **THEN** no live process is restored
