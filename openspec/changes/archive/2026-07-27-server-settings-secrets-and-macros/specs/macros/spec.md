## MODIFIED Requirements

### Requirement: Server ownership of macro execution

Macro definitions, normalization, execution scheduling, inactivity waits, and secret interpolation SHALL live in the selected Terminay Server. The client SHALL edit fields and show a safe preview only. Macro commands SHALL be authorized against the exact target terminal and project.

#### Scenario: Client requests execution

- **WHEN** a client submits a macro run
- **THEN** the server authorizes the command against the exact target terminal and project before any PTY write

#### Scenario: Client edits a macro

- **WHEN** a user edits macro fields in the client
- **THEN** the client renders only a safe preview and never receives plaintext secrets in order to write them back to a PTY

### Requirement: Server-owned revisioned macro persistence

Macros SHALL be server-owned, revisioned state loaded, normalized, saved, reset, and executed through the application protocol. Normalization SHALL preserve explicit field definitions, normalize values by type, migrate template-only macros into step-based macros, and derive compatibility fields from the step list. The macro repository SHALL own normalized revisioned definitions and explicit reset, upsert, and remove commands.

#### Scenario: Saving a macro

- **WHEN** a client saves a macro through the application protocol
- **THEN** the server normalizes and stores it as a new revision

#### Scenario: Template-only macro

- **WHEN** a stored macro carries only a template rather than steps
- **THEN** normalization produces an equivalent step-based macro

#### Scenario: Resetting macros

- **WHEN** a client issues the reset command
- **THEN** the repository restores its default macro definitions

### Requirement: Secret interpolation stays inside the server vault boundary

Secret interpolation SHALL stay inside the server vault boundary. Vault status and secret references SHALL be metadata-only protocol values. A resolved secret SHALL be scoped to the server-side execution callback and cleared after use, so a macro preview or a disconnected client cannot receive it.

#### Scenario: Macro preview referencing a secret

- **WHEN** a client renders a preview of a macro step that references a secret
- **THEN** the preview receives only the secret reference metadata and never the plaintext value

#### Scenario: Secret resolved during a run

- **WHEN** the server resolves a secret while executing a macro step
- **THEN** the plaintext is scoped to the server-side execution callback and is cleared after use

### Requirement: Template rendering is a data-only subset

Server execution SHALL treat Eta as a data-only subset supporting field interpolations and literal equality branches. Arbitrary JavaScript tags SHALL be rejected, and an unsupported tag SHALL fail before any PTY write, so template rendering is not a server process or code execution boundary.

#### Scenario: Unsupported template tag

- **WHEN** a macro step contains an Eta tag outside the supported data-only subset
- **THEN** rendering fails before any bytes are written to the target terminal

#### Scenario: Literal equality branch

- **WHEN** a macro step branches on a literal equality comparison of a field value
- **THEN** the branch is evaluated and the selected output is rendered

### Requirement: Launching-client disconnect policy

Each run SHALL record a launching-client policy. The `cancel` policy SHALL be the default and SHALL abort the run when the launching client disconnects. The `continue` policy SHALL leave the server-owned run alive and independent of the transport.

#### Scenario: Default policy on disconnect

- **WHEN** the launching client disconnects during a run recorded with the default `cancel` policy
- **THEN** the run is aborted

#### Scenario: Continue policy on disconnect

- **WHEN** the launching client disconnects during a run recorded with the `continue` policy
- **THEN** the server-owned run continues to completion independently of that transport

### Requirement: Bounded macro run execution

The macro runner SHALL execute bounded steps against an exact server, project, and session target, including server-side secret resolution, time and inactivity waits, cancellation, and output and concurrency limits.

#### Scenario: Executing a run

- **WHEN** a macro run starts
- **THEN** its steps execute against the exact server, project, and session target under the configured output and concurrency limits

#### Scenario: Cancelling a run

- **WHEN** a running macro is cancelled
- **THEN** its remaining steps do not execute
