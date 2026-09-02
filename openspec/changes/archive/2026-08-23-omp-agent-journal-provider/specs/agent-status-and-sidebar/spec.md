## ADDED Requirements

### Requirement: omp session roots and data-root resolution
The server SHALL resolve OMP's sessions root from `~/.omp/agent/sessions`,
honouring `PI_CODING_AGENT_DIR`, then `OMP_PROFILE`, then `PI_PROFILE`, and the
Linux XDG location after migration. Only encoded-cwd root `*.jsonl` files below
an allowed sessions root SHALL be admitted as roots; nested
`<parent-stem>/*.jsonl` files SHALL be treated as children.

#### Scenario: Profile environment set
- **WHEN** `PI_CODING_AGENT_DIR`, `OMP_PROFILE`, or `PI_PROFILE` selects another
  data root
- **THEN** the sessions root is resolved from that location in that precedence
  order

#### Scenario: Nested child journal
- **WHEN** a JSONL file exists at `<parent-stem>/<agentId>.jsonl`
- **THEN** it is treated as a child journal and not admitted as a root

### Requirement: omp title slot and session identity
The physical 256-byte `type: "title"` first line of an omp journal SHALL be
skipped before inspection. A journal SHALL be admitted only when its logical
first record is `type: "session"` with a stable `id`. A `type: "title"` line
SHALL NOT be treated as a Codex `session_meta` record.

#### Scenario: Title slot only
- **WHEN** a journal contains only the title slot and no session record
- **THEN** it is rejected and no agent row is created

#### Scenario: Logical session header present
- **WHEN** the record after the title slot is `type: "session"` with a stable id
- **THEN** that id establishes the session identity

### Requirement: omp terminal breadcrumb binding
An omp session SHALL be bound to a terminal only through OMP's terminal
breadcrumb. The terminal id SHALL be derived from the exact PTY TTY, the
breadcrumb SHALL be resolved under the effective OMP root, and its cwd, path,
and `fresh` fields SHALL be validated. Only a materialized root JSONL below an
allowed sessions root SHALL be admitted. Newest mtime, encoded cwd, process
name, or terminal title SHALL NOT establish a binding.

#### Scenario: Two terminals in the same directory
- **WHEN** two `omp` processes run in the same working directory in two
  terminals
- **THEN** each binds through its own TTY-derived breadcrumb and they do not
  share a row

#### Scenario: Fresh breadcrumb before materialization
- **WHEN** the breadcrumb is marked fresh and its target JSONL does not yet
  exist
- **THEN** no session is claimed and the terminal remains on terminal-activity
  fallback until the target materializes

#### Scenario: Missing or malformed breadcrumb
- **WHEN** the breadcrumb is missing or its fields are malformed
- **THEN** the session is not admitted

#### Scenario: `bun`-named process
- **WHEN** the foreground process appears as `bun` rather than `omp`
- **THEN** it is shown only if that exact PTY TTY has a valid OMP breadcrumb
  target

### Requirement: omp durability and state limits
The omp binding SHALL be rechecked while omp remains the foreground process,
rebinding on a session switch, and the tailer SHALL handle atomic JSONL
replacement as well as file shrink and reset. Open file-descriptor sampling
SHALL be treated only as supplementary evidence. Permission prompts SHALL NOT
be projected as `waiting` or `blocked`, since omp writes no journal record for
them.

#### Scenario: Session switched
- **WHEN** omp switches to another session while remaining foreground
- **THEN** the terminal rebinds to the new breadcrumb target

#### Scenario: Atomic journal replacement
- **WHEN** the journal writer atomically replaces and closes the JSONL file
- **THEN** tailing continues against the replacement without losing the binding

### Requirement: omp record mapping
The `(omp, 0.1)` driver SHALL map omp records to the canonical agent model:
the session header to `session.started`; the first user-facing
`message.role === "user"` to `turn.started` with the stable bounded root label;
`customType: "tool_execution_start"` to `tool.started`; assistant tool results
and matching tool calls to `tool.finished`; a completed assistant tail or
terminal `stopReason` to `agent.done`; `session_exit` to `session.stopped`,
marked interrupted when pending tools remain; and child JSONL files to
`subagent.started` and `subagent.stopped`. Unknown record types SHALL be
ignored, and tool arguments, assistant text, and tool output SHALL NOT be
projected.

#### Scenario: Unmatched tool start
- **WHEN** a `tool_execution_start` record has no matching result yet
- **THEN** the agent is projected as working

#### Scenario: Session exit with pending tools
- **WHEN** `session_exit` is recorded while tools remain pending
- **THEN** the session is projected as interrupted rather than still live

#### Scenario: Unknown record type
- **WHEN** a record type the driver does not recognise appears
- **THEN** it is ignored and no state is invented

#### Scenario: Provider display and independence
- **WHEN** an omp agent row is presented
- **THEN** it is labelled `omp` from the provider map, and no MCP installation,
  wrapper, or oh-my-pi change is required for it to appear
