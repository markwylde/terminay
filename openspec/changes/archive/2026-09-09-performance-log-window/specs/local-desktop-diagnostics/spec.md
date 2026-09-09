# local-desktop-diagnostics Delta

## ADDED Requirements

### Requirement: Startup phase timeline

Terminay Desktop main SHALL record an ordered timeline of named startup phases for every launch, covering at minimum Electron readiness, startup-window creation and first paint, workspace restoration, embedded-server composition, workspace initialization, vault unlock, native menu construction, and the handoff to the verified server UI. Each phase SHALL carry a stable identifier, a monotonic start offset from process start, and a duration, and each SHALL be closed when the phase ends or when startup fails. The timeline SHALL be held in memory for the life of the process, SHALL cost no more than one timestamp per phase boundary, and SHALL NOT be written to the Diagnostics folder. Recording SHALL be always on and SHALL NOT depend on the opt-in performance-logging preference.

#### Scenario: Successful launch

- **WHEN** Desktop finishes starting and presents the workspace
- **THEN** the timeline holds every phase from Electron readiness to the server-UI handoff with a stable identifier, start offset, and duration
- **AND** no timeline artifact has been written to the Diagnostics folder

#### Scenario: Startup fails part way

- **WHEN** startup fails before the server-UI handoff
- **THEN** the phase that was running is closed and marked as the phase in which startup failed
- **AND** the phases that completed before it retain their recorded durations

#### Scenario: Collector is not opt-in

- **WHEN** performance logging has never been enabled on the device
- **THEN** the startup phase timeline is still recorded

### Requirement: Lightweight always-on runtime metrics

Terminay Desktop main SHALL maintain a lightweight runtime metrics collector that is distinct from the opt-in performance-logging collector. It SHALL sample, at a bounded interval no more frequent than once per second, only the per-process type, service or name label, CPU percent, and working-set memory that Electron reports for its own processes, plus main-process event-loop delay and bounded heap and RSS totals. It SHALL NOT collect renderer call stacks, Chromium traces, CPU profiles, heap snapshots, or IPC channel strings. Samples SHALL be retained in a bounded in-memory ring covering the current process only, SHALL be discarded when Desktop exits, and SHALL NOT be written to the Diagnostics folder or to any other file. Sampling SHALL stop while no Performance Log window is open.

#### Scenario: Sample contents

- **WHEN** a lightweight sample is taken
- **THEN** it records only process type and label, CPU percent, working-set memory, event-loop delay, and bounded heap and RSS totals
- **AND** no call stack, Chromium trace, CPU profile, heap snapshot, or IPC channel string is collected

#### Scenario: Nothing reaches disk

- **WHEN** lightweight samples have been taken and Desktop exits
- **THEN** no lightweight sample or startup timeline was written to the Diagnostics folder
- **AND** the retained samples are gone

#### Scenario: Idle cost

- **WHEN** no Performance Log window is open
- **THEN** lightweight sampling is not running

### Requirement: Per-terminal local resource sampling

While a Performance Log window is open, Desktop main SHALL sample per-terminal resource usage for terminal sessions backed by the embedded Local server, reporting CPU percent, resident memory, and cumulative disk bytes read and written for each session's shell process tree, keyed by the server, project, and session identity the requesting window already holds. Sampling SHALL be bounded and SHALL fail closed: a session whose process tree cannot be read SHALL report an unavailable outcome rather than a substituted or stale value. A terminal session routed to an SSH or other remote project environment SHALL report an unavailable outcome with a stable reason, and Desktop SHALL NOT introduce a resource-reporting protocol surface into project-environment adapters. Terminal titles, command lines, arguments, working directories, environment values, and PTY bytes SHALL NOT be collected or reported.

#### Scenario: Local terminal

- **WHEN** a terminal session backed by the embedded Local server is sampled
- **THEN** its CPU percent, resident memory, and cumulative disk bytes read and written are reported for its shell process tree
- **AND** no title, command line, argument, working directory, environment value, or PTY byte is reported

#### Scenario: Remote project environment

- **WHEN** a terminal session routed to an SSH or other remote project environment is sampled
- **THEN** it reports an unavailable outcome with a stable reason
- **AND** no resource-reporting request is made to the project-environment adapter

#### Scenario: Unreadable process tree

- **WHEN** a local session's shell process tree cannot be read
- **THEN** that session reports an unavailable outcome
- **AND** no substituted or stale value is presented as a measurement

### Requirement: Performance Log window

The Desktop Help menu SHALL provide **Performance Log**, which opens or focuses a native auxiliary window in the same presentation family as Settings, Macros, and Recordings, bound to the embedded Local profile. The window SHALL present the startup phase timeline as a proportional breakdown whose phases can be expanded to their recorded sub-phases, the live process and event-loop samples, and a per-terminal table of CPU, memory, and disk that names sessions from the workspace state the window already holds. The window SHALL make the phase that dominated startup identifiable without reading a log file. Opening it SHALL NOT enable the opt-in performance-logging collector, and its content SHALL remain available while that collector is off.

#### Scenario: Opening from the Help menu

- **WHEN** the user chooses **Performance Log**
- **THEN** a native auxiliary window opens, or the existing one is focused
- **AND** the opt-in performance-logging collector is not enabled

#### Scenario: Identifying a slow launch

- **WHEN** a launch was dominated by one startup phase
- **THEN** that phase is identifiable from the window's proportional breakdown without opening a log file

#### Scenario: Heavy collector disabled

- **WHEN** performance logging is off in Settings
- **THEN** the Performance Log window still shows the startup timeline, live samples, and per-terminal usage

### Requirement: Performance Log snapshots stay a bounded main-owned projection

The Performance Log window SHALL receive its content only as a bounded, structured snapshot computed in Desktop main and delivered over the established host action and event bridge. Desktop SHALL NOT give the window a Diagnostics file path, file handle, directory listing, log-reading capability, or general-purpose logging channel, and the window SHALL NOT read or write a diagnostic artifact. The snapshot SHALL contain only the startup timeline, lightweight samples, and per-terminal outcomes this specification permits, SHALL be size-bounded, and SHALL be refused for a window bound to a remote profile or presented by a browser host.

#### Scenario: Renderer capability boundary

- **WHEN** the Performance Log window requests its content
- **THEN** it receives a bounded structured snapshot and no file path, file handle, directory listing, or log-reading capability
- **AND** it cannot read or write a diagnostic artifact

#### Scenario: Remote profile or browser host

- **WHEN** a window bound to a remote profile, or a browser host, requests a performance snapshot
- **THEN** the request is refused

## MODIFIED Requirements

### Requirement: Opt-in performance logging control

Desktop SHALL provide a performance-logging collector that is off by default and performs no periodic sampling, stack collection, or Chromium tracing until enabled on the device. Users SHALL enable or disable it from the Desktop Settings **Diagnostics** category, which SHALL be the single control for it, backed by one device-local preference persisted in Desktop userData. The preference SHALL NOT be a server setting and SHALL NOT be synchronized to other clients. Browser hosts SHALL NOT expose the control. Disabling it SHALL immediately stop sampling and any in-progress trace, and resetting Diagnostics settings SHALL turn it off. The lightweight always-on metrics collector and the startup phase timeline SHALL be unaffected by this preference in either direction.

#### Scenario: First launch default

- **WHEN** Desktop is launched for the first time
- **THEN** performance logging is off and no periodic sampling, stack collection, or Chromium tracing occurs

#### Scenario: Enabling and disabling

- **WHEN** the user enables performance logging from Settings
- **THEN** `diagnostics.performance.enabled` is written, periodic samples start, and the preference persists for later launches on this device
- **AND** disabling it writes `diagnostics.performance.disabled` and stops sampling without requiring a relaunch

#### Scenario: Single control

- **WHEN** the user looks for the performance-logging control
- **THEN** it appears only in the Settings **Diagnostics** category

#### Scenario: Browser host

- **WHEN** the workspace is opened from a browser host
- **THEN** the performance-logging control is not exposed

### Requirement: Access and lifecycle controls

The Desktop Help menu SHALL provide **Performance Log**, which opens or focuses the Performance Log window. It SHALL be presented as unavailable when no local workspace window exists to host it, and the remaining Help items SHALL stay usable in that state. The same menu SHALL provide **Reveal Diagnostics Folder**, which opens the platform file manager at the canonical directory and remains available when no workspace or server connection is healthy. The same menu SHALL provide **Clear Diagnostics…** with confirmation; clearing SHALL remove closed managed logs, crash artifacts, and performance traces, rotate the current application log, and record only that a clear occurred, without deleting an unrecognized file or requiring a renderer filesystem capability. Diagnostics SHALL be readable after a crash by opening the folder directly or by relaunching Terminay and using the Help menu, and SHALL NOT require a support account, network connection, or developer mode.

#### Scenario: No healthy renderer or server

- **WHEN** no workspace renderer or Local server connection is healthy
- **THEN** **Reveal Diagnostics Folder** and confirmed clearing still work
- **AND** **Performance Log** is presented as unavailable rather than opening a window that cannot load

#### Scenario: Clearing diagnostics

- **WHEN** the user confirms **Clear Diagnostics…**
- **THEN** closed managed logs, crash artifacts, and performance traces are removed and the current application log is rotated
- **AND** only the fact that a clear occurred is recorded, and unrecognized files are not deleted

#### Scenario: Access after a crash

- **WHEN** a user investigates after a crash
- **THEN** diagnostics are readable by opening the folder directly or relaunching Terminay and using the Help menu
- **AND** no support account, network connection, or developer mode is required
