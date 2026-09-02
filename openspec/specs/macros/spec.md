# macros Specification

## Purpose

Macros are reusable terminal automation recipes made from ordered execution steps and optional user-supplied fields, launched from the Command bar and executed by the selected Terminay Server against an exact terminal.

## Requirements

### Requirement: Macro composition and launch flow

A macro SHALL consist of ordered execution steps and optional user-supplied fields. Users SHALL launch macros from the Command bar, supply any required field values, preview the rendered output, and then have the rendered steps typed into the active terminal.

#### Scenario: Launching a macro with fields

- **WHEN** a user launches a macro that declares fields from the Command bar
- **THEN** the client opens a parameter modal, and the rendered steps are typed into the active terminal only after the user submits the form

#### Scenario: Launching a macro without fields

- **WHEN** a user launches a macro that declares no fields
- **THEN** the macro executes without a parameter modal and its rendered steps are typed into the active terminal

### Requirement: Server ownership of macro execution

Macro definitions, normalization, execution scheduling, inactivity waits, and secret interpolation SHALL live in the selected Terminay Server. The client SHALL edit fields and show a safe preview only. Macro commands SHALL be authorized against the exact target terminal and project.

#### Scenario: Client requests execution

- **WHEN** a client submits a macro run
- **THEN** the server authorizes the command against the exact target terminal and project before any PTY write

#### Scenario: Client edits a macro

- **WHEN** a user edits macro fields in the client
- **THEN** the client renders only a safe preview and never receives plaintext secrets in order to write them back to a PTY

### Requirement: Macro writes follow the terminal's project environment

Macro terminal writes SHALL follow the terminal's canonical project environment, and file fields SHALL browse through that environment's filesystem capability. A remote path SHALL never be read from the Terminay Server filesystem.

#### Scenario: File field in a remote environment

- **WHEN** a macro file field is used on a terminal whose project environment is not the Terminay Server host
- **THEN** the field browses through that environment's filesystem capability rather than the server filesystem

#### Scenario: Missing provider capability

- **WHEN** the terminal's project environment does not advertise the required filesystem capability
- **THEN** the field or action is unavailable
- **AND** the operation never falls back to another machine

### Requirement: Eta template syntax for type steps

Type steps SHALL support Eta templates configured for plain terminal text. Eta tags such as `<% if (message === 'one') { %>...<% } %>` SHALL control output and interpolations such as `<%= message %>` SHALL insert values. Field names SHALL be available as top-level identifiers so a user writes `message` rather than `it.message`. XML escaping SHALL be disabled because macro output is terminal input. `{{Field Name}}` placeholders SHALL also render.

#### Scenario: Interpolating a field

- **WHEN** a type step contains `<%= message %>` and the `message` field has a value
- **THEN** the rendered step contains that value without XML escaping

#### Scenario: Brace placeholder

- **WHEN** a type step contains a `{{Field Name}}` placeholder
- **THEN** the placeholder renders from the matching field value

### Requirement: Template rendering is a data-only subset

Server execution SHALL treat Eta as a data-only subset supporting field interpolations and literal equality branches. Arbitrary JavaScript tags SHALL be rejected, and an unsupported tag SHALL fail before any PTY write, so template rendering is not a server process or code execution boundary.

#### Scenario: Unsupported template tag

- **WHEN** a macro step contains an Eta tag outside the supported data-only subset
- **THEN** rendering fails before any bytes are written to the target terminal

#### Scenario: Literal equality branch

- **WHEN** a macro step branches on a literal equality comparison of a field value
- **THEN** the branch is evaluated and the selected output is rendered

### Requirement: Just-in-time rendering of type steps

Terminay Server SHALL render each `type` step immediately before writing it to the target terminal.

#### Scenario: Multi-step macro

- **WHEN** a macro with several `type` steps executes
- **THEN** each step is rendered immediately before its own write rather than all steps being rendered up front

### Requirement: Wait step durations in seconds

Wait steps SHALL store user-facing durations in seconds through `durationSeconds`. Runtime execution SHALL render the duration and convert it to milliseconds only when scheduling the delay or inactivity timer. Saved `durationMs` values SHALL be normalized to seconds.

#### Scenario: Scheduling a wait

- **WHEN** a wait step with `durationSeconds` is executed
- **THEN** the duration is rendered and converted to milliseconds only at the point of scheduling the delay or inactivity timer

#### Scenario: Normalizing a millisecond duration

- **WHEN** a stored macro carries a `durationMs` wait value
- **THEN** normalization converts it to a `durationSeconds` value

### Requirement: Macro field types and modal behaviour

Macro fields SHALL be stored on the macro definition and keyed by `field.name`. The supported field types SHALL be `text`, `textarea`, `select`, `number`, `checkbox`, `emoji`, and `file`. The parameter modal SHALL initialize each field from `defaultValue`, validate required fields before execution, render a live preview, and execute only on submit.

#### Scenario: Opening the parameter modal

- **WHEN** the parameter modal opens for a macro
- **THEN** each field is initialized from its `defaultValue` and a live preview of the rendered output is shown

#### Scenario: Missing required field

- **WHEN** the user submits the modal with a required field empty
- **THEN** validation fails and the macro does not execute

### Requirement: Field detection from steps

`Sync from Steps` SHALL detect `{{Field}}` placeholders and common Eta identifiers inside template tags, and SHALL additionally detect single-brace fields such as `{Delay}` for wait durations. Detection is a convenience for creating fields; explicit fields SHALL be preserved on save even when they are not currently detected in any step.

#### Scenario: Syncing fields from steps

- **WHEN** the user runs `Sync from Steps` on a macro whose steps reference `{{Name}}` and an Eta identifier
- **THEN** matching fields are proposed for the macro

#### Scenario: Explicit field not referenced by any step

- **WHEN** a macro with an explicitly defined field that no step references is saved
- **THEN** that field is preserved

#### Scenario: Wait duration field

- **WHEN** a wait step references a single-brace field such as `{Delay}`
- **THEN** detection proposes a field for that duration

### Requirement: Select option editing and validation

Select options SHALL be edited as raw textarea text, and the editor SHALL NOT parse or rewrite that text on each keystroke because incomplete input such as `First|` is valid while typing. On save, each non-empty line SHALL be either `label|value` or a single label; `label|value` lines SHALL include both sides; duplicate values SHALL be rejected; a select field SHALL have at least one option; and a default value that does not match a saved option SHALL be reset to the first option value. Parsed options SHALL be persisted as `{ label, value }[]` and transient raw editor text SHALL NOT be persisted.

#### Scenario: Typing incomplete option text

- **WHEN** the user has typed `First|` into the select options textarea
- **THEN** the editor leaves the raw text unchanged and does not rewrite or reformat it

#### Scenario: Duplicate option values

- **WHEN** a select field is saved with two lines that produce the same value
- **THEN** the save is rejected

#### Scenario: Select field with no options

- **WHEN** a select field is saved with no non-empty option lines
- **THEN** the save is rejected

#### Scenario: Default no longer matches an option

- **WHEN** a select field is saved and its existing default value matches none of the saved options
- **THEN** the default is reset to the first option's value

#### Scenario: Persisting options

- **WHEN** a select field is saved
- **THEN** the parsed `{ label, value }` pairs are persisted and the raw editor text is not

### Requirement: Macro step editor

The multiline text step editor SHALL use an Eta-oriented language definition that highlights Eta delimiters and output tags; JavaScript keywords, identifiers, comments, strings, numbers, and operators inside Eta tags; and `{{Field}}` placeholders. `Cmd/Ctrl+Enter` SHALL apply the text and `Escape` SHALL cancel the editor. Inline single-line type-step editing SHALL remain available for quick edits.

#### Scenario: Applying editor text

- **WHEN** the user presses `Cmd/Ctrl+Enter` in the multiline step editor
- **THEN** the edited text is applied to the step

#### Scenario: Cancelling the editor

- **WHEN** the user presses `Escape` in the multiline step editor
- **THEN** the editor closes without applying changes

#### Scenario: Highlighting a step

- **WHEN** a step contains Eta tags and a `{{Field}}` placeholder
- **THEN** the editor highlights the Eta delimiters, the code inside the tags, and the placeholder

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

### Requirement: Bounded macro run execution

The macro runner SHALL execute bounded steps against an exact server, project, and session target, including server-side secret resolution, time and inactivity waits, cancellation, and output and concurrency limits.

#### Scenario: Executing a run

- **WHEN** a macro run starts
- **THEN** its steps execute against the exact server, project, and session target under the configured output and concurrency limits

#### Scenario: Cancelling a run

- **WHEN** a running macro is cancelled
- **THEN** its remaining steps do not execute

### Requirement: Clipboard paste step is rejected

A clipboard `paste` step SHALL be rejected until a server-authorized clipboard boundary is provided, and SHALL never be silently delegated to a client.

#### Scenario: Macro containing a paste step

- **WHEN** a macro run reaches a clipboard `paste` step
- **THEN** the step is rejected and the operation is not delegated to a client

### Requirement: Launching-client disconnect policy

Each run SHALL record a launching-client policy. The `cancel` policy SHALL be the default and SHALL abort the run when the launching client disconnects. The `continue` policy SHALL leave the server-owned run alive and independent of the transport.

#### Scenario: Default policy on disconnect

- **WHEN** the launching client disconnects during a run recorded with the default `cancel` policy
- **THEN** the run is aborted

#### Scenario: Continue policy on disconnect

- **WHEN** the launching client disconnects during a run recorded with the `continue` policy
- **THEN** the server-owned run continues to completion independently of that transport

### Requirement: Macro run queue

Finished macro runs SHALL remain visible in the run queue until the user clears them.

#### Scenario: Clearing finished runs

- **WHEN** the user clears finished runs from the macro queue
- **THEN** those completed entries are removed from the queue
