# local-desktop-diagnostics Specification

## Purpose

Terminay Desktop continuously records a bounded, local diagnostic history so a packaged application can be investigated without launching it from a terminal or leaving developer tools open, while excluding terminal content, credentials, project content, and other user data that is not needed to identify a failing component and lifecycle transition.

## Requirements

### Requirement: Bounded local diagnostic history

Terminay Desktop SHALL continuously record a bounded, local diagnostic history that distinguishes application startup and shutdown, main-process failures, renderer white screens and crashes, renderer hangs, Electron child-process failures, and embedded Local server failures. The default history SHALL cover the preceding 24 hours and SHALL never be uploaded automatically.

#### Scenario: Packaged launch without a terminal

- **WHEN** a packaged Desktop build is launched with no visible terminal
- **THEN** a readable versioned application log is created in the platform Diagnostics folder
- **AND** a clean exit is marked when the application shuts down normally

#### Scenario: History retained for the default window

- **WHEN** diagnostics are inspected after a failure
- **THEN** the recorded history covers the preceding 24 hours
- **AND** no artifact has been uploaded or transmitted automatically

### Requirement: Diagnostic ownership stays in Desktop main

Terminay Desktop main SHALL own diagnostic collection, storage, retention, and reveal/clear actions. Filesystem writes and Electron process inspection SHALL NOT move into a renderer or the server-bundled workspace UI. Each Desktop renderer SHALL be treated as an untrusted diagnostic source: main observes bounded Electron lifecycle and console events for a known `WebContents`, and a renderer SHALL NOT receive a general-purpose logging IPC method, file path, file handle, or permission to read existing diagnostics.

#### Scenario: Renderer requests diagnostic authority

- **WHEN** renderer code attempts to write, name, or read a diagnostic artifact
- **THEN** no such capability exists and the write is refused
- **AND** the only renderer-derived evidence is what main observes from bounded Electron lifecycle and console events for a known `WebContents`

#### Scenario: Bootstrap and recovery evidence

- **WHEN** canonical renderer bootstrap or terminal-recovery observations report release evidence
- **THEN** they use one bounded, observation-only renderer callback with no privileged preload or IPC diagnostics channel
- **AND** absence or failure of that callback does not alter startup, workspace reconciliation, or recovery

### Requirement: Embedded and remote server diagnostic boundaries

Desktop SHALL record bounded lifecycle failures from its in-process embedded Local Terminay Server composition, routing that application logging through the bounded main-process output route rather than a fictitious child stdout/stderr boundary. Diagnostics SHALL NOT capture PTY streams or shell-process output. Diagnostics for a standalone or remote Terminay Server SHALL remain owned by that server host.

#### Scenario: Embedded server failure

- **WHEN** the embedded Local server fails during startup, runtime, or shutdown
- **THEN** its bounded semantic lifecycle and application error metadata are recorded
- **AND** no PTY output or shell-process output is recorded

#### Scenario: Connecting to a remote server

- **WHEN** Desktop connects to a standalone or remote Terminay Server
- **THEN** that server's service logs are not copied into Desktop diagnostics

### Requirement: Diagnostics folder and artifact set

Desktop SHALL use Electron's platform application log directory, referred to in product behaviour and UI as the **Diagnostics folder** rather than one literal path on every platform. The folder SHALL contain timestamped line-oriented application log segments for the current and recent launches, local native crash dumps collected by Electron Crashpad, optional Chromium performance traces written only while performance logging is enabled, and a small launch marker used to distinguish a clean exit from an interrupted session.

#### Scenario: Locating diagnostics on macOS

- **WHEN** a user opens the Diagnostics folder on macOS
- **THEN** the default location is `~/Library/Logs/Terminay`
- **AND** Linux and Windows use Electron's platform-appropriate application log directory

#### Scenario: Interrupted session

- **WHEN** a launch ends without a clean exit
- **THEN** the launch marker distinguishes that interrupted session from a clean exit

### Requirement: Application log record format

Application logs SHALL use UTF-8 JSON Lines. Every complete line SHALL be independently readable and parseable and SHALL contain a schema version, UTC timestamp, severity, component, stable event name, launch id, and bounded event fields. A formatted message and stack MAY be included when safe. Multiline and control characters SHALL be escaped.

#### Scenario: Renderer attempts to forge entries

- **WHEN** renderer output contains newlines or control characters
- **THEN** those characters are escaped before persistence
- **AND** the output cannot forge additional log entries

#### Scenario: Reading one line in isolation

- **WHEN** a single log line is read on its own
- **THEN** it parses independently and carries schema version, UTC timestamp, severity, component, stable event name, launch id, and bounded event fields

### Requirement: Launch identification and environment record

Launch ids SHALL be random correlation values that grant no authority. A new launch SHALL record the Terminay, Electron, Chromium, Node, operating-system, and architecture versions plus whether the previous launch ended cleanly. It SHALL NOT record usernames, device names, environment variables, command-line secrets, project roots, or connection credentials.

#### Scenario: New launch record

- **WHEN** Desktop starts a new launch
- **THEN** the launch records Terminay, Electron, Chromium, Node, operating-system, and architecture versions and whether the previous launch ended cleanly
- **AND** it records no username, device name, environment variable, command-line secret, project root, or connection credential

### Requirement: Native crash dump collection

Crash reporting SHALL start before any renderer is created, SHALL store dumps locally, and SHALL have upload disabled. Native crash dumps are diagnostic binaries and SHALL NOT be presented as a substitute for the readable application log or as directly human-readable.

#### Scenario: Native crash

- **WHEN** a native crash occurs
- **THEN** Crashpad writes a local dump with upload disabled
- **AND** the readable application log remains the primary evidence

### Requirement: Always-on lifecycle and failure coverage

The normal diagnostic level SHALL record Desktop main startup milestones, readiness, window creation/destruction, and clean shutdown; main-process warnings, uncaught exceptions, unhandled rejections, stdout, and stderr originating from Terminay application code; renderer information, warnings, errors, uncaught errors, unhandled rejections, preload failures, failed loads, and failed navigations; unexpected renderer exit with Electron's reason and exit code including crash, out-of-memory, killed, launch-failed, integrity-failure, and memory eviction outcomes; unexpected GPU, network-service, audio-service, and other Electron child-process exits with their bounded type, service name, reason, and exit code; renderer `unresponsive` and later `responsive` transitions; bounded process memory and CPU metrics when a process becomes unresponsive or unexpectedly exits; and diagnostic-writer, cleanup, crash-dump, and retention failures.

#### Scenario: Distinct renderer failure events

- **WHEN** a renderer load failure, preload failure, crash, out-of-memory termination, or GPU child failure occurs
- **THEN** each produces a distinct stable event
- **AND** the event carries the Electron reason and exit code where available

#### Scenario: Clean lifecycle

- **WHEN** Desktop starts, creates and destroys windows, and shuts down cleanly
- **THEN** startup milestones, readiness, window creation/destruction, and clean shutdown are recorded

### Requirement: Always-on coverage of user-visible operation failures

The normal diagnostic level SHALL record user-visible Git operation failures that are caught and rendered as ordinary UI state, using a stable operation label and sanitized bounded error text, and user-visible embedded Local filesystem-operation failures using only the stable operation name and bounded failure category. These events SHALL NOT record a project id, root, requested path, directory entry, file content, repository or worktree path, ref, command argument, or raw Git output.

#### Scenario: Failed Explorer query

- **WHEN** a Local Explorer filesystem query fails and is rendered as ordinary UI state
- **THEN** the diagnostic records only the stable operation name and bounded failure category
- **AND** no project root or file path is recorded
- **AND** a later successful query does not leave a stale Explorer failure banner

#### Scenario: Failed Git operation

- **WHEN** a Git operation fails and is rendered as ordinary UI state
- **THEN** the diagnostic records a stable operation label and sanitized bounded error text
- **AND** it excludes repository and worktree paths, refs, command arguments, and raw Git output

### Requirement: Always-on coverage of protocol, pairing, and WebRTC lifecycle

The normal diagnostic level SHALL record embedded Local server protocol-stream failures, including a client disconnect racing an event delivery, as a stable bounded error without protocol frames, terminal content, credentials, or remote addresses. It SHALL record hosted remote pairing signaling lifecycle — advertisement, host-registered, pairing or device-host socket close, automatic QR rotation, client-join, and registration failure — using only origin class (`manager`, `session`, `loopback`, `other`), close-code, close-reason class, and remaining TTL, and SHALL NOT record pairing URLs, fragments, PINs, room ids, session ids, or hostnames. After a client has joined, it SHALL record hosted remote WebRTC liveness: peer and ICE state changes, ICE disconnect grace start/clear/expiry, data-channel open/close, and application-lane counters (inbound/outbound frame and byte counts, last-activity age, buffered amount, inbound kind class, send failure class), emitted as state changes plus a bounded stall warning when inbound frames continue while outbound frames stop, and a periodic summary while a peer is live. It SHALL NOT record PTY bytes, keystrokes, protocol payloads, SDP, ICE candidate addresses, or channel labels beyond the fixed set `control`, `application`, `terminal`, `assets`, `asset`, and `api`.

#### Scenario: Client disconnects during event delivery

- **WHEN** a Local protocol client disconnects while an event is being delivered
- **THEN** one bounded connection-failure diagnostic is produced
- **AND** Desktop and its Electron windows remain running

#### Scenario: Remote session accepts input but stops streaming

- **WHEN** a hosted remote session accepts keystrokes but stops streaming PTY output
- **THEN** peer, ICE, and channel state plus application-lane counters showing inbound continuing while outbound stalls are recorded
- **AND** no terminal content is persisted

#### Scenario: Pairing lifecycle

- **WHEN** pairing advertises, registers a host, rotates a QR code, accepts a client join, or fails registration
- **THEN** only origin class, close-code, close-reason class, and remaining TTL are recorded
- **AND** no pairing URL, fragment, PIN, room id, session id, or hostname is recorded

### Requirement: Always-on coverage of terminal congestion and recovery

The normal diagnostic level SHALL record embedded Local terminal presentation congestion plus renderer recovery starts, retries, checkpoint commits, timeouts, and terminal failures, using only bounded attempt counts, durations, byte positions, queue measurements, and process-local correlation metadata.

#### Scenario: Congestion episode

- **WHEN** a Local terminal congestion episode occurs
- **THEN** the server queue boundary and the renderer's bounded recovery lifecycle are recorded through completion or a visible retryable failure
- **AND** no PTY bytes, session ids, project ids, or terminal titles are persisted

### Requirement: Always-on collector remains low volume

Normal user actions and high-frequency UI state SHALL NOT produce one event per interaction. A caught successful-path error SHALL be recorded only when it becomes a user-visible operational failure. Debug-level tracing, raw Chromium verbose logging, Chromium network logs, protocol frame dumps, request/response bodies, and screenshots SHALL NOT be enabled by the always-on collector.

#### Scenario: Ordinary interaction

- **WHEN** a user performs ordinary navigation and UI interaction
- **THEN** no per-interaction diagnostic event is produced

#### Scenario: Caught error that is not user visible

- **WHEN** an error is caught and handled without becoming a user-visible operational failure
- **THEN** no diagnostic event is recorded for it

### Requirement: Opt-in performance logging control

Desktop SHALL provide a performance-logging collector that is off by default and performs no periodic sampling, stack collection, or Chromium tracing until enabled on the device. Users SHALL enable or disable it from the Desktop Settings **Diagnostics** category and from the Help menu **Performance Logging** checkbox, both sharing one device-local preference persisted in Desktop userData. The preference SHALL NOT be a server setting and SHALL NOT be synchronized to other clients. Browser hosts SHALL NOT expose the control. Disabling it SHALL immediately stop sampling and any in-progress trace, and resetting Diagnostics settings SHALL turn it off.

#### Scenario: First launch default

- **WHEN** Desktop is launched for the first time
- **THEN** performance logging is off and no periodic sampling, stack collection, or Chromium tracing occurs

#### Scenario: Enabling and disabling

- **WHEN** the user enables performance logging from Settings or the Help menu
- **THEN** `diagnostics.performance.enabled` is written, periodic samples start, and the preference persists for later launches on this device
- **AND** disabling it writes `diagnostics.performance.disabled` and stops sampling without requiring a relaunch

#### Scenario: Browser host

- **WHEN** the workspace is opened from a browser host
- **THEN** the performance-logging control is not exposed

### Requirement: Performance logging content

While enabled, Desktop main SHALL record a periodic sample of every Electron process Electron reports using only process type, optional service/name labels, CPU percent, idle wakeups, working-set memory, and process-local pids; main-process event-loop delay (min/mean/max and selected percentiles) plus bounded heap/RSS totals; bounded IPC counts since the previous sample grouped by stable channel class (`server-ui-host`, `file`, `secrets`, `terminal`, `test`, or `other`) without raw channel strings, payload bytes, or PTY content; a time-bounded JavaScript call stack from each live renderer main frame when a sample shows elevated CPU or event-loop delay, coalesced so one frame is not stacked on every sample; and occasional Chromium traces written as managed artifacts using Chromium argument filtering, excluding network logs and screenshots, time- and size-bounded, and retained under the same rotation rules as other closed diagnostic artifacts.

#### Scenario: Performance sample contents

- **WHEN** a performance sample is recorded
- **THEN** it records only process type, CPU, memory, event-loop delay, and stable IPC class counts
- **AND** renderer stacks and Chromium traces omit PTY bytes, paths, credentials, and screenshots

#### Scenario: Sustained elevated CPU

- **WHEN** samples repeatedly show elevated CPU or event-loop delay in one renderer frame
- **THEN** stack collection is coalesced so one frame is not stacked on every sample

### Requirement: Performance logging cannot degrade the product

Performance logging SHALL NOT delay startup, shutdown, or recovery. A tracing or stack-collection failure SHALL record a bounded outcome and leave terminals running. The always-on hang collector SHALL continue to record unresponsive renderer stacks independently of this setting. The sample interval and trace cadence SHALL stay bounded so the logger cannot itself become an unbounded CPU source. Intercepting or observing logging SHALL preserve development console output and SHALL NOT install an exception handler that turns a fatal main-process error into continued execution in a potentially corrupt state.

#### Scenario: Trace failure

- **WHEN** a Chromium trace or stack collection fails while performance logging is enabled
- **THEN** a bounded outcome is recorded
- **AND** terminals keep running and startup, shutdown, and recovery are not delayed

#### Scenario: Fatal main-process error

- **WHEN** a fatal main-process error occurs while logging interception is installed
- **THEN** execution does not continue in a potentially corrupt state
- **AND** development console output is preserved

### Requirement: White-screen evidence

A renderer that fails before or during bootstrap SHALL record the load URL class without its path, query, fragment, credentials, or remote host; the load phase; the Electron error code; a bounded safe description; and the associated `WebContents` diagnostic id. Preload failures and renderer exceptions SHALL include a bounded stack after source locations have been reduced to packaged application-relative module names. The shared application root SHALL have an error boundary that emits one bounded failure event and presents its normal recovery UI, with repeated rendering of the same failure deduplicated.

#### Scenario: Bootstrap load failure

- **WHEN** a renderer fails to load before or during bootstrap
- **THEN** the load URL class, load phase, Electron error code, bounded safe description, and `WebContents` diagnostic id are recorded
- **AND** the URL path, query, fragment, credentials, and remote host are not recorded

#### Scenario: Repeated application root failure

- **WHEN** the same application root failure renders repeatedly
- **THEN** one bounded failure event is emitted and the repeats are deduplicated
- **AND** the normal recovery UI is presented

### Requirement: No visual blank-page detection or screenshots

Desktop SHALL NOT claim to detect a visually blank page when Chromium remains responsive and no load, preload, console, or application error occurs. It SHALL NOT capture an automatic screenshot, because the window can contain terminals, files, secrets, or other private content.

#### Scenario: Responsive but blank window

- **WHEN** a window appears visually blank while Chromium is responsive and no load, preload, console, or application error occurred
- **THEN** no blank-page detection event is claimed
- **AND** no automatic screenshot is captured

### Requirement: Hang evidence

When Electron reports a renderer as unresponsive, Desktop SHALL immediately record the transition and bounded process metrics, and SHALL request the main frame's currently running JavaScript call stack where the pinned Electron version supports unresponsive-renderer stack collection. Collection SHALL be time-bounded and asynchronous so an unavailable or never-resolving stack records a bounded outcome and cannot delay the main process, shutdown, or recovery. A matching `responsive` event SHALL record the observed duration, and repeated unresponsive notifications for the same episode SHALL be coalesced.

#### Scenario: Blocked renderer

- **WHEN** a renderer is deliberately blocked and later recovers
- **THEN** one unresponsive episode is recorded with a time-bounded stack-collection outcome and process metrics
- **AND** its duration is recorded when it becomes responsive

#### Scenario: Stack never resolves

- **WHEN** unresponsive-renderer stack collection does not resolve within its bound
- **THEN** a bounded outcome is recorded
- **AND** the main process, shutdown, and recovery are not delayed

### Requirement: No self-diagnosis of a main-process deadlock

Terminay SHALL NOT claim that self-observation can identify a main-process deadlock after the main event loop stops. Automatic operating-system sampling and an out-of-process watchdog SHALL NOT be part of the always-on feature; the readable log SHALL show the last completed operation.

#### Scenario: Main process deadlocks

- **WHEN** the main process is deadlocked and its event loop has stopped
- **THEN** the readable log shows the last completed operation
- **AND** no automatic operating-system sampling or out-of-process watchdog runs

### Requirement: Event and burst bounds

One normalized event SHALL be at most 16 KiB, with oversized messages, stacks, arrays, and objects truncated with an explicit marker rather than rejected or written without a bound. Every main, renderer, child-process, and embedded-server text source SHALL be limited to 100 entries and 256 KiB of encoded text per rolling 10-second window, whichever is reached first. Suppressed bursts SHALL produce one summary with a count rather than consuming unbounded memory, IPC, main-process time, or disk. Low-volume lifecycle events SHALL use an independent bounded channel so a console flood cannot hide a later process-exit event.

#### Scenario: Console flood and oversized cyclic object

- **WHEN** a renderer floods the console and emits an oversized cyclic object
- **THEN** Desktop does not freeze, allocate unbounded memory, forge log lines, or exceed per-event and rotation bounds
- **AND** the suppressed burst produces one summary with a count

#### Scenario: Flood followed by a process exit

- **WHEN** a console flood is immediately followed by an unexpected process exit
- **THEN** the process-exit event is still recorded on its independent bounded lifecycle channel

### Requirement: Rotation and retention

Application logs SHALL rotate at one hour or 10 MiB, whichever happens first. Closed artifacts SHALL expire 24 hours after their creation, with cleanup running before normal startup, after a segment closes, after resume from system sleep, and periodically while Desktop remains open. A 100 MiB aggregate cap SHALL apply to closed application segments, crash artifacts, and performance traces even when they are younger than 24 hours, removing the oldest closed artifacts first. The active segment SHALL never be removed underneath its writer, and rotation SHALL occur before enforcing the aggregate cap when possible. Retention SHALL be based on artifact creation recorded by Terminay, not a renderer-supplied timestamp. No closed artifact SHALL be deliberately preserved as a special "last crash" exception after it expires.

#### Scenario: Aggregate cap exceeded

- **WHEN** closed segments, crash artifacts, and traces together exceed 100 MiB
- **THEN** the oldest closed artifacts are removed first
- **AND** the active segment is preserved

#### Scenario: Resume from sleep

- **WHEN** the device resumes from system suspension that delayed physical deletion
- **THEN** cleanup runs before further normal collection

#### Scenario: Renderer-supplied timestamp

- **WHEN** a renderer supplies a timestamp that differs from the recorded artifact creation time
- **THEN** retention uses the creation time recorded by Terminay

### Requirement: Safe cleanup

Cleanup SHALL operate only on recognized diagnostic artifacts beneath the canonical Diagnostics folder, SHALL never follow symbolic links, and SHALL treat an unfamiliar file as user-owned. A deletion, permission, disk-full, or serialization failure SHALL NOT crash Terminay or prevent a terminal from running; the collector SHALL fall back to a bounded stderr warning when possible and retry only at a bounded cadence.

#### Scenario: Symlink and unfamiliar file present

- **WHEN** cleanup runs and the Diagnostics folder contains a symbolic link and an unfamiliar file
- **THEN** cleanup removes expired managed segments and crash artifacts and enforces the aggregate bound
- **AND** it preserves the active segment and the unfamiliar file and does not traverse the symlink outside the folder

#### Scenario: Disk full during cleanup

- **WHEN** a deletion, permission, disk-full, or serialization failure occurs
- **THEN** Terminay does not crash and terminals keep running
- **AND** the collector falls back to a bounded stderr warning and retries only at a bounded cadence

### Requirement: Access and lifecycle controls

The Desktop Help menu SHALL provide **Performance Logging** as a checkbox that toggles the opt-in collector without a renderer, workspace, or Local server. The same menu SHALL provide **Reveal Diagnostics Folder**, which opens the platform file manager at the canonical directory and remains available when no workspace or server connection is healthy. The same menu SHALL provide **Clear Diagnostics…** with confirmation; clearing SHALL remove closed managed logs, crash artifacts, and performance traces, rotate the current application log, and record only that a clear occurred, without deleting an unrecognized file or requiring a renderer filesystem capability. Diagnostics SHALL be readable after a crash by opening the folder directly or by relaunching Terminay and using the Help menu, and SHALL NOT require a support account, network connection, or developer mode.

#### Scenario: No healthy renderer or server

- **WHEN** no workspace renderer or Local server connection is healthy
- **THEN** **Reveal Diagnostics Folder** and confirmed clearing still work
- **AND** **Performance Logging** can still be toggled

#### Scenario: Clearing diagnostics

- **WHEN** the user confirms **Clear Diagnostics…**
- **THEN** closed managed logs, crash artifacts, and performance traces are removed and the current application log is rotated
- **AND** only the fact that a clear occurred is recorded, and unrecognized files are not deleted

#### Scenario: Access after a crash

- **WHEN** a user investigates after a crash
- **THEN** diagnostics are readable by opening the folder directly or relaunching Terminay and using the Help menu
- **AND** no support account, network connection, or developer mode is required

### Requirement: Diagnostic artifacts are sensitive local data

Diagnostic artifacts SHALL be treated as sensitive local data. Their directory and files SHALL use user-only permissions where the platform supports them. Terminay SHALL NOT upload, sync, attach, or expose them to another client or server without a separate user-authorized feature. Crash annotations SHALL follow the same exclusions as readable logs; a Crashpad minidump SHALL be treated as potentially containing terminal, file, or secret data, kept under the same local retention and permission controls, and never claimed to have redacted contents.

#### Scenario: Ordinary use and remote activity

- **WHEN** a remote connection, pairing, update check, or ordinary application use occurs
- **THEN** no diagnostic artifact is transmitted

#### Scenario: Minidump handling

- **WHEN** a Crashpad minidump is retained
- **THEN** it is kept under the same local retention and permission controls as other artifacts
- **AND** no claim is made that its contents have been redacted

### Requirement: Content exclusions

Normal and failure logging SHALL exclude PTY output, typed or pasted input, terminal scrollback, recordings, and terminal titles derived from commands; file contents, diffs, clipboard contents, dictation audio/transcripts, and screenshots; project roots, current working directories, user-selected filenames, home directory, usernames, hostnames, and environment-variable values; pairing links, URL query strings/fragments, PINs, device private keys, cookies, authorization headers, API keys, vault values, and secret-bearing provider errors; and raw application-protocol, WebRTC, MCP, Git, or network payloads.

#### Scenario: Sensitive fixtures

- **WHEN** fixtures containing terminal text, paths, URL credentials and fragments, authorization values, pairing material, API keys, and provider secrets are exercised
- **THEN** none of those values persist in logs or crash annotations

### Requirement: Untrusted text sanitization and correlation ids

Known errors SHALL be logged as stable event names and bounded error categories. Arbitrary renderer, child-process, and provider text SHALL be treated as untrusted: length-bounded, control-character escaped, and passed through the common secret and path sanitizer before persistence. Sanitization is defence in depth; callers remain responsible for emitting metadata rather than user content. Opaque process-local diagnostic ids MAY correlate a window, `WebContents`, connection, or terminal lifecycle within one launch; durable credentials and raw authority-bearing ids SHALL NOT be diagnostic correlation keys.

#### Scenario: Provider text containing a secret

- **WHEN** provider or child-process text containing a secret or a filesystem path is emitted
- **THEN** it is length-bounded, control-character escaped, and sanitized before persistence

#### Scenario: Correlating a lifecycle

- **WHEN** a window, `WebContents`, connection, or terminal lifecycle is correlated across events in one launch
- **THEN** an opaque process-local diagnostic id is used
- **AND** no durable credential or raw authority-bearing id is used as the correlation key

### Requirement: Diagnostics non-goals

Terminay SHALL NOT perform automatic telemetry, crash upload, hosted log aggregation, or support-bundle submission. It SHALL NOT record terminal sessions or user interaction for reproduction. It SHALL NOT maintain an always-on Chromium network log, packet capture, protocol trace, screenshot, heap snapshot, CPU profile, or verbose Chromium log; argument-filtered Chromium traces and sampled CPU profiles are written only while the user has enabled performance logging on this device. Collecting an error SHALL NOT cause an automatic restart or silent renderer reload. Standalone-server service-manager logging policy is outside this capability.

#### Scenario: Error is collected

- **WHEN** Desktop collects a renderer or main-process error
- **THEN** no automatic restart or silent renderer reload occurs as a consequence

#### Scenario: Collector defaults

- **WHEN** performance logging is disabled
- **THEN** no Chromium network log, packet capture, protocol trace, screenshot, heap snapshot, CPU profile, or verbose Chromium log is produced

### Requirement: Release gate evidence

The macOS release gate SHALL mount the exact signed DMG, launch its contained application with an isolated user-data directory, and wait for the real server workspace to become ready. A preload failure, renderer exception, failed navigation, or unresolved generated asset SHALL fail the release before publication. Generated server UI assets SHALL resolve from both their hosted HTTP origin and the packaged Desktop `file:` entry location, and the dedicated sandboxed preload SHALL be emitted as a self-contained Electron-executable artifact.

#### Scenario: Failing packaged build

- **WHEN** the packaged application produces a preload failure, renderer exception, failed navigation, or unresolved generated asset during the release gate
- **THEN** the release fails before publication

#### Scenario: Asset resolution evidence

- **WHEN** the release gate verifies generated server UI assets
- **THEN** they resolve from both the hosted HTTP origin and the packaged Desktop `file:` entry location
- **AND** a successful Vite compilation alone is not accepted as startup evidence

### Requirement: Test exception reporting

Main and renderer test exceptions SHALL appear once with useful application frames, while existing fatal and recovery behaviour remains unchanged.

#### Scenario: Deliberate test exception

- **WHEN** a main-process or renderer test exception is raised
- **THEN** it appears once with useful application frames
- **AND** the existing fatal and recovery behaviour is unchanged
