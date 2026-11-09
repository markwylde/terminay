## Purpose

Terminay accepts native macOS folder opens and directory launch arguments, creates server-owned terminals in the requested local folders, and presents them without changing remote windows or existing sessions.

## ADDED Requirements

### Requirement: Native macOS folder registration

The packaged macOS application SHALL advertise itself as an alternate handler for local folders through Launch Services. Installation and startup MUST NOT change the user's default application associations.

#### Scenario: Folder offered to the application
- **WHEN** macOS opens a folder with Terminay, including `open -a Terminay /path/to/folder`
- **THEN** Terminay accepts the folder as a local terminal launch request

#### Scenario: Existing defaults
- **WHEN** Terminay is installed or launched
- **THEN** existing default folder and terminal application associations remain unchanged

### Requirement: Folder launch arguments

Terminay SHALL accept positional directory paths, `--working-directory PATH`, `--working-directory=PATH`, local `file:` URLs, and `--` before literal paths. It SHALL preserve operands literally and resolve relative paths against the invoking process's working directory. It MUST NOT evaluate shell syntax. Invalid options, URLs, and nondirectory operands SHALL fail visibly without creating a terminal for the invalid request. Runtime-injected switches SHALL NOT become folder operands.

#### Scenario: Literal path
- **WHEN** an invocation supplies a folder containing spaces, Unicode, quotes, or shell metacharacters
- **THEN** a terminal opens in that exact folder and no path text is executed

#### Scenario: Relative path and explicit option
- **WHEN** a second process launched from `/work` supplies `--working-directory project`
- **THEN** the original instance opens a terminal in `/work/project`

#### Scenario: Invalid argument
- **WHEN** a request names a missing directory, a regular file, or an unsupported option
- **THEN** Terminay reports the problem and creates no terminal for that invalid request

#### Scenario: Multiple operands and delimiter
- **WHEN** an invocation supplies multiple directory operands, including a leading-dash directory after `--`
- **THEN** each operand is handled in order as a literal folder request

### Requirement: Launch delivery across application lifecycle

Terminay SHALL capture macOS folder opens before application readiness and retain requests until the local server and workspace are ready. Initial arguments, native open events, and forwarded second-instance arguments SHALL use one validated launch operation. Each accepted request SHALL create one new terminal. No-folder launches SHALL retain normal startup and focus behavior.

#### Scenario: Cold native launch
- **WHEN** a folder-open event arrives before application readiness
- **THEN** it is processed after local startup and its terminal is visible

#### Scenario: Already running
- **WHEN** an already-running Terminay receives a native folder-open event or another invocation with a directory argument
- **THEN** the primary instance opens and presents a new terminal in that directory

### Requirement: Local project and terminal authority

A folder launch SHALL use the embedded server's canonical filesystem, project, shell-profile, and terminal authority. It SHALL reuse or create a project at the canonical folder root, create a terminal at that exact cwd, and present its panel locally. It MUST NOT change existing terminal directories or remote windows, or route local paths to a remote server. Failure SHALL be visible and leave no live terminal without a panel.

#### Scenario: Remote window is focused
- **WHEN** a local folder is opened while a remote-server window is focused
- **THEN** a local workspace window presents the requested terminal and the remote window retains its server

#### Scenario: Existing project and terminals
- **WHEN** the requested folder already has a project with running terminals
- **THEN** that project receives a new terminal in the requested folder and its other terminals remain unchanged

#### Scenario: Explicit directory overrides policy
- **WHEN** Home folder, Project folder, or Current terminal or panel policy would choose another directory
- **THEN** the folder launch opens in its explicitly requested directory through normal server launch validation

### Requirement: Invocation ordering and rejection scope

Each positional operand and working-directory option SHALL append one folder request in argument order, including repeated options. A syntactically invalid invocation SHALL be rejected before any of its folders open. Filesystem failures SHALL reject only the affected folder, allowing subsequent valid requests to proceed.

#### Scenario: Mixed and repeated forms
- **WHEN** an invocation supplies `--working-directory A B --working-directory=C`
- **THEN** it opens A, B, and C in that order

#### Scenario: Syntax failure is atomic
- **WHEN** an invocation supplies `A --unknown B`
- **THEN** it reports the unsupported option and opens neither A nor B

#### Scenario: Filesystem failure is isolated
- **WHEN** a missing folder request is followed by an existing folder
- **THEN** the missing folder is reported and the existing folder still opens

### Requirement: Bounded launch delivery

The launch queue SHALL admit at most 64 outstanding folders with operands bounded to 4096 characters. Overflow SHALL be reported without dropping accepted requests. Bootstrap failure SHALL reject queued requests visibly. Presentation SHALL wait at most ten seconds for its addressed client, with failure releasing the queue for later requests. Warm secondary processes SHALL acknowledge submission only; completion errors SHALL appear in the primary application's native UI and stderr.

#### Scenario: Queue overflow
- **WHEN** an invocation exceeds available queue capacity
- **THEN** that invocation is rejected visibly without partially enqueuing it

#### Scenario: Startup fails
- **WHEN** bootstrap fails while folder requests are pending
- **THEN** those requests are rejected visibly rather than silently discarded

### Requirement: Launch persistence and presentation failures

Terminal creation SHALL retain the server's atomic terminal-and-panel guarantees. If presentation fails after successful creation, the terminal and panel SHALL remain discoverable through the normal terminal list and the failure SHALL be reported. A newly created empty project SHALL remain after terminal creation failure so the user can retry. Existing projects SHALL never be closed as failure cleanup.

#### Scenario: Window closes during presentation
- **WHEN** a requested terminal and panel exist but the target window closes before selection completes
- **THEN** the launch reports a presentation error and the terminal remains listed with its project and panel

### Requirement: Launch lifecycle invariants

Cold argv launches SHALL open their folders after startup. Repeated intentional requests SHALL each open a terminal. Internal updater and recovery relaunches SHALL not replay consumed operands. No-operand invocations SHALL retain normal startup and focus behavior.

#### Scenario: Cold argv launch
- **WHEN** the executable starts with a positional folder
- **THEN** it presents a terminal in that folder after startup

#### Scenario: Repeated folder launch
- **WHEN** the same folder is intentionally opened twice
- **THEN** two fresh terminals exist in its reused project

#### Scenario: Internal relaunch
- **WHEN** an updater or recovery restarts an application initially opened with a folder
- **THEN** no additional folder launch is replayed

#### Scenario: No folder operand
- **WHEN** Terminay starts or receives a second invocation without folder operands
- **THEN** its normal startup or window focus behavior applies

### Requirement: Native launch entry point isolation

Native launch orchestration SHALL be a privileged local-server operation reachable only from main-process operating-system events and process arguments. No renderer IPC, remote protocol operation, MCP caller, or URL SHALL acquire this native launch authority.

#### Scenario: Renderer cannot submit native launch intent
- **WHEN** renderer code attempts to invoke the native launch entry point
- **THEN** no such exposed operation exists and no root or terminal is created
