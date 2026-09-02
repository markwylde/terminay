## ADDED Requirements

### Requirement: Canonical launch resolution snapshot

One privileged server component SHALL resolve a terminal launch into an
immutable snapshot containing the selected profile id and revision, executable
launch descriptor, argument array, working directory, environment, dimensions,
and safe presentation metadata. Every production creation route SHALL invoke
this component; renderer, Electron bootstrap, protocol adapter, and PTY service
code MUST NOT hold an independent shell or working-directory fallback list.
Resolution and spawn SHALL use one settings and workspace snapshot. A concurrent
profile, project, or settings mutation SHALL either precede that snapshot or
affect the next terminal, and MUST NOT produce a mixed launch.

#### Scenario: Concurrent mutation during launch

- **WHEN** a profile, project, or settings mutation commits while a terminal is
  being resolved and spawned
- **THEN** the launch uses one consistent snapshot and the mutation affects only
  the next terminal

#### Scenario: No independent fallback lists

- **WHEN** any production creation route runs
- **THEN** it resolves through the privileged component rather than a
  renderer, bootstrap, adapter, or PTY-service fallback list

#### Scenario: PTY service receives a resolved snapshot

- **WHEN** the PTY service is asked to spawn a terminal
- **THEN** it requires a fully resolved launch snapshot and makes no profile or
  working-directory decision of its own

### Requirement: Every creation route resolves identically

Startup seed, new project, new tab, split, open-at-folder, Desktop
compatibility, browser, local protocol, remote protocol, and standalone MCP
terminal creation SHALL all resolve through the canonical launch component. The
transport SHALL NOT change the resolved executable, profile id, ordered
arguments, or working directory.

#### Scenario: Same request over different transports

- **WHEN** an equivalent terminal creation request is made through embedded
  Desktop, the framed local protocol, and the remote protocol
- **THEN** the resolved executable, profile id, ordered arguments, and working
  directory are identical

#### Scenario: MCP terminal creation

- **WHEN** a standalone MCP `open_terminal` request creates a terminal
- **THEN** it resolves through the same component and its panel is reconciled
  after the spawn

### Requirement: Safe implicit working directories

An implicit working-directory resolution SHALL NOT produce a filesystem root, a
drive root, or the packaged application's own working directory. A project whose
root was explicitly selected as a root path MAY start there. An invalid explicit
path, a stale observed panel working directory, a missing project root, and an
unsafe implicit root SHALL each produce a distinct bounded failure rather than a
silent fallback.

#### Scenario: Implicit request with no usable directory

- **WHEN** a terminal is created implicitly and no safe working directory can be
  resolved
- **THEN** resolution fails with a bounded failure code instead of starting at a
  filesystem root, a drive root, or the packaged application working directory

#### Scenario: Project rooted at home

- **WHEN** a new project is rooted at the user's home directory
- **THEN** its first and every later terminal starts at that home directory

#### Scenario: Explicitly selected root project

- **WHEN** a user has explicitly selected a root path as a project root
- **THEN** its terminals start at that root

#### Scenario: Distinct failure causes

- **WHEN** the explicit path is invalid, the observed panel directory is stale,
  or the project root is missing
- **THEN** each produces its own distinct bounded failure

### Requirement: Project root provenance

A project root carried forward from an earlier workspace snapshot that resolves
to a root-like path SHALL be marked legacy-unverified. Terminal creation for
that project SHALL fail with `unsafe_legacy_root` until an authorized user
confirms or replaces the root. Confirmation SHALL NOT alter project identity,
environment binding, panels, or layout.

#### Scenario: Legacy root-like project

- **WHEN** a terminal is created for a project whose root is legacy-unverified
- **THEN** creation fails with `unsafe_legacy_root`

#### Scenario: Authorized confirmation

- **WHEN** an authorized user confirms or replaces that project's root
- **THEN** terminals launch normally and the project's identity, environment
  binding, panels, and layout are unchanged

### Requirement: Session metadata retention and environment redaction

The resolved profile identity, target summary, working directory, and creation
time SHALL be retained as terminal-session metadata. Environment values MUST NOT
be retained in workspace snapshots, events, recordings, diagnostics, or error
reports.

#### Scenario: Session records what was resolved

- **WHEN** a profile or default changes after a session was created
- **THEN** that session's metadata still records the profile identity, target
  summary, working directory, and creation time resolved at its creation

#### Scenario: Environment values are absent from diagnostics

- **WHEN** a diagnostic, recording, event, or error report is produced
- **THEN** it contains no launch environment values

### Requirement: Server-side authority over client-supplied launch inputs

The renderer MAY contribute active panel identity and an explicit user choice,
but the server SHALL read the authoritative project, profile, and panel records
and SHALL perform final path and executable validation. Local and remote
transports SHALL use the same command and result shape. Terminal create, list,
cwd, attach, resume, input, resize, kill, detach, and inactivity operations
SHALL each be checked against the authenticated project and session claims. A
durable panel SHALL be committed only after a successful spawn.

#### Scenario: Client asserts a panel identity

- **WHEN** the renderer supplies an active panel identity and profile choice
- **THEN** the server resolves the authoritative project, profile, and panel
  records itself and validates path and executable before spawn

#### Scenario: Unauthorized session claim

- **WHEN** a terminal operation addresses a session outside the authenticated
  project and session claims
- **THEN** it is rejected

#### Scenario: Spawn failure

- **WHEN** the spawn fails
- **THEN** neither a live session nor a durable panel exists afterwards

### Requirement: WSL profile constraints

A WSL profile SHALL require an explicit shell for its startup command,
arguments, and environment. `WSLENV` SHALL remain server-controlled and SHALL
NOT be settable through profile environment entries. Protected Windows
environment names SHALL be matched case-insensitively.

#### Scenario: WSL profile without an explicit shell

- **WHEN** a WSL profile omits an explicit shell
- **THEN** it is rejected rather than launched against a distribution default

#### Scenario: Attempt to override a protected Windows name

- **WHEN** a profile environment entry uses a protected Windows name in any
  letter case
- **THEN** the entry is rejected

### Requirement: Launch failure behaviour

An unavailable explicitly named profile SHALL fail with a bounded failure code
and SHALL NOT fall back to another profile. Only the System default profile
SHALL follow its documented platform fallback chain.

#### Scenario: Unavailable named profile

- **WHEN** a terminal is created with an explicitly named profile whose target is
  unavailable
- **THEN** creation fails with a bounded failure code and no substitute shell is
  launched

#### Scenario: System default fallback

- **WHEN** the System default profile's first candidate is unavailable
- **THEN** it follows only its documented platform fallback chain
