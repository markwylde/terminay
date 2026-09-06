## MODIFIED Requirements

### Requirement: Provider ids are extension contributions

Provider ids SHALL be namespaced extension contributions rather than a closed core union. Terminay SHALL bundle enabled-by-default Codex, Claude Code, Cursor Agent, Grok, OpenCode, and omp providers. A third-party provider SHALL appear through the same validated manifest, hosted runtime, canonical event, Settings, and disablement contracts. Persisted unknown or disabled provider ids SHALL remain bounded metadata and SHALL NOT cause provider code to load in a client.

#### Scenario: Third-party provider

- **WHEN** a third-party agent provider extension is installed
- **THEN** it participates through the same manifest, runtime, canonical event, Settings, and disablement contracts as the bundled providers

#### Scenario: Unknown persisted provider id

- **WHEN** persisted state references an unknown or disabled provider id
- **THEN** it remains bounded metadata and no provider code loads in a client

### Requirement: Exact terminal identity binding

For an environment exposing proven native process observation, Terminay SHALL record the spawned shell PID for the immutable `serverId`/`projectId`/`projectEnvironmentId`/`sessionId` terminal identity. When a supported provider becomes the foreground process, that environment's privileged host SHALL obtain the provider's documented terminal identity evidence. Codex and Grok SHALL use an eligible writable journal below the exact PTY process tree, or Grok's pid-keyed `active_sessions.json` registry for that same process tree. OpenCode SHALL use its writable session store held by that same process tree. Claude Code and omp SHALL use their provider-specific terminal or session association. A provider whose CLI holds no persistent writable handle on its own journal SHALL NOT depend on open-handle evidence as its only binding rule. Environments without the required evidence SHALL use the terminal-activity fallback.

#### Scenario: Codex journal below the PTY tree

- **WHEN** a writable Codex rollout is held by a process in the exact PTY process tree
- **THEN** that journal is admitted as the terminal's evidence

#### Scenario: Provider that closes its journal between writes

- **WHEN** a provider appends to its journal and closes it rather than holding it open
- **THEN** its binding rests on that provider's own documented association and not on open-handle evidence alone

#### Scenario: Missing evidence

- **WHEN** the environment cannot supply the required identity evidence
- **THEN** the terminal uses terminal-activity fallback

### Requirement: Claude Code mapping

The `terminay-agent-claude-code` package SHALL own the Claude Code mapping under the same zero-injection boundary. It SHALL bind an exact `claude --resume <uuid>` descendant to that UUID's root JSONL below the project directory in `~/.claude/projects`.

For a new `claude` process the primary rule SHALL be the provider-encoded project directory for the exact descendant process working directory: Terminay SHALL observe that directory and admit a root journal that appeared there after that process started. An open writable root journal SHALL remain an eligible fallback applied only after the primary rule finds no candidate, because the Claude Code CLI appends to its journal and closes it and so normally holds no writable handle.

One `claude` process writes a new root journal for each conversation it holds, so several post-process-start roots for one process SHALL be expected rather than treated as unresolvable. Among them the bound root SHALL be the one currently receiving appends, under the renewable root binding rules, and a root that stops receiving appends while another begins SHALL be retired in favour of it. Ambiguity SHALL bind nothing only where two candidates are being appended concurrently. Journals below a root session's `subagents/` directory and unrelated history SHALL NOT be eligible roots.

It SHALL use explicit `ai-title` records for the root label, the bounded `last-prompt` text and then the provider display name until such a record exists, assistant model metadata, and bounded tool lifecycle. Meta and local-command user records, tool-result content, assistant text, and reasoning SHALL never be projected.

Claude Code writes `mode`, `permission-mode`, `atis-latch`, `bridge-session`, and `last-prompt` records at the start of every turn, not only at session start. These SHALL be treated as turn header records: the first SHALL start the session, and a subsequent one SHALL NOT restart the session, clear active tools, or return a working entry to `idle`. The turn header SHALL open a turn as `working` and the `system` record with subtype `turn_duration` SHALL close it as `done`. Between a `turn_duration` and the next turn header the entry SHALL be `idle`.

Claude Code flushes an assistant record and its corresponding `tool_result` together once the tool has completed, so its journal never shows an outstanding tool call and writes nothing at all while a permission prompt is open. The entry SHALL therefore remain `working` across a silent tool run on the strength of the turn boundary, and `AskUserQuestion` SHALL NOT be treated as a live `waiting` signal, because its record appears only after the question has already been answered.

#### Scenario: Turn header after the first

- **WHEN** a `permission-mode` or `mode` record is written at the start of a later turn
- **THEN** the session is not restarted, active tools are not cleared, and the entry opens a turn as `working`

#### Scenario: Between turns

- **WHEN** a `turn_duration` record is followed by no further records
- **THEN** the entry is `done` and then `idle` at the next turn header

#### Scenario: Silent tool run

- **WHEN** Claude Code runs a tool and writes nothing until it completes
- **THEN** the entry remains `working` for the whole run

#### Scenario: Resumed Claude Code session

- **WHEN** a `claude --resume <uuid>` descendant of the registered PTY is observed
- **THEN** it binds to that UUID's root JSONL below the project directory

#### Scenario: New Claude Code process

- **WHEN** a new `claude` process starts in a terminal
- **THEN** only a root journal that appeared in that exact working directory's project directory after the process started is admitted

#### Scenario: CLI holds no writable handle

- **WHEN** a running `claude` process holds no open writable handle on its root journal
- **THEN** the primary post-process-start rule still binds the session

#### Scenario: One process, several conversations

- **WHEN** one `claude` process has written several root journals and is appending to one of them
- **THEN** the journal receiving appends is bound and the others are not

#### Scenario: Conversation switched

- **WHEN** appends move from the bound root to another post-process-start root of the same process
- **THEN** the previous root is retired and the newly active one is bound in the same terminal

#### Scenario: Subagent journal offered as root

- **WHEN** a `subagents/` journal or unrelated history file is a candidate
- **THEN** it is not eligible as a root

#### Scenario: Named child

- **WHEN** an `Agent` tool use records a subagent launch
- **THEN** a named child entry starts beneath the root at that launch and completes on its own journal's completion or the parent's task notification for that `agentId`

### Requirement: Claude Code subagent journals

Claude Code SHALL record each subagent beneath a root session in its own journal at `<root-session-uuid>/subagents/agent-<agentId>.jsonl`, below that root's provider-encoded project directory. Every record in such a journal carries `isSidechain: true` and the child's `agentId`.

The extension SHALL list and follow that bounded, root-scoped `subagents/` directory through the public observation broker while the root is bound, so children created after the root binds are admitted live. A journal SHALL be a child of the bound root only because it lies in that root session's own `subagents/` directory; timestamp, path proximity, and display text SHALL NOT establish the relationship. A `subagents/` journal SHALL never be an eligible root.

The parent journal SHALL supply the child's identity and label: an `Agent` tool use records the `agentId` and a bounded `description`, and a task notification record for that same `agentId` records its completion and outcome. A subagent launch SHALL be projected when the launch is recorded, without waiting for the child to finish, because Claude Code records an asynchronous launch immediately.

Each child's own state SHALL come from its own journal: `working` while that journal is being appended, `done` on its recorded completion or on the parent's task notification for its `agentId`. A child completing SHALL NOT complete its root, and the root SHALL remain `working` while any child is working. Child prompts, assistant text, reasoning, and tool payloads SHALL never be projected.

#### Scenario: Subagent journal admitted

- **WHEN** a journal appears in the bound root session's `subagents/` directory
- **THEN** it is admitted as a child of that root and followed live

#### Scenario: Asynchronous launch

- **WHEN** an `Agent` tool use records a launch that returns immediately
- **THEN** the child is projected at the launch with its recorded description as its label

#### Scenario: Child completion

- **WHEN** the child's journal records completion, or the parent records a task notification for that `agentId`
- **THEN** that child is `done` and its root is unchanged

#### Scenario: Sidechain journal offered as a root

- **WHEN** a `subagents/` journal is a root candidate
- **THEN** it is not eligible

#### Scenario: Root waits for its children

- **WHEN** any child of a root is working
- **THEN** the root remains `working`

### Requirement: Claude Code input-request and fault inference

Claude Code records no permission request and no explicit blocking condition, so
`waiting` and `blocked` SHALL be derived from its session journal under the
journal-derived inference rules.

**Waiting.** Within an open turn — after a turn header and before that turn's
`turn_duration` — an entry SHALL become `waiting` when the journal has been
quiescent for longer than the Claude Code input-request window, and the writer
process is alive, and the session's most recent `permission-mode` record carries
a mode that can prompt. A `permissionMode` of `bypassPermissions` SHALL suppress
the inference entirely, because such a session never prompts. The inference
SHALL also be withheld while a descendant of the provider process is performing
work, so a long silent tool run is not mistaken for a prompt. Any appended
record SHALL end the wait and return the entry to `working`.

**Blocked.** An assistant record carrying `isApiErrorMessage` SHALL make the
entry `blocked` when it halts a turn with no `turn_duration` following, and
SHALL be `done` with an error outcome when the turn completes.

The input-request window SHALL exceed the longest quiet interval Claude Code
produces during ordinary uninterrupted work by a stated margin, and the
measurement SHALL be recorded with it.

#### Scenario: Permission prompt left outstanding

- **WHEN** a turn is open, the journal is quiescent beyond the input-request window, no descendant is performing work, and the session's permission mode can prompt
- **THEN** the entry is `waiting` and records that the state was inferred

#### Scenario: Bypass permissions session

- **WHEN** the session's most recent `permission-mode` record is `bypassPermissions`
- **THEN** the input-request inference does not fire

#### Scenario: Long silent tool run

- **WHEN** the journal is quiescent beyond the window while a descendant of the provider process is performing work
- **THEN** the inference is withheld and the entry stays `working`

#### Scenario: Prompt answered

- **WHEN** any record is appended while the entry is inferred `waiting`
- **THEN** the entry returns to `working`

#### Scenario: API error halts a turn

- **WHEN** an assistant record carries `isApiErrorMessage` and no `turn_duration` follows
- **THEN** the entry is `blocked`

### Requirement: Grok replay, summary metadata, and subagents

Replay SHALL follow the events journal to the last complete JSONL record, and follow chunks SHALL stay small enough to fit the extension IPC message cap after JSON number-array encoding. A resumed idle TUI whose latest lifecycle record is `turn_ended` SHALL be `done` rather than `working`. Title and model SHALL come from the sibling `summary.json` while the root is bound: the first document names the row even before a native turn, and a later rewrite updates that same row in place. A hanging or rotating summary watcher SHALL NOT stall or abort event replay.

Grok records per-child lifecycle in the bound root's own events journal. A `subagent_progress` record SHALL enumerate that child beneath the root, labelled from the bounded agent label Grok records for it, and a `subagent_finished` record SHALL complete it with its outcome. A child SHALL be attached only because a record on the bound root's own journal names it; a session elsewhere in the sessions tree SHALL NOT become a child, and timestamp, path proximity, and display text SHALL NOT establish the relationship.

A completion for a child whose progress was never observed SHALL still land beneath the root rather than being dropped. A child completing SHALL NOT complete its root, and the root SHALL remain `working` while any child is working. Child prompts, tool arguments, tool output, and reasoning SHALL never be projected.

#### Scenario: Resumed idle session

- **WHEN** a Grok session is resumed and its latest lifecycle record is `turn_ended`
- **THEN** the entry is `done`

#### Scenario: Summary rewrite

- **WHEN** `summary.json` is rewritten while the root is bound
- **THEN** the same root row's title and model update in place

#### Scenario: Stalled summary watcher

- **WHEN** the summary watcher hangs or rotates
- **THEN** event replay continues unaffected

#### Scenario: Grok subagent spawn

- **WHEN** Grok records `subagent_progress` for a child on the bound root's journal
- **THEN** a named child is admitted beneath that root and the root remains `working`

#### Scenario: Grok subagent progress and completion

- **WHEN** Grok records `subagent_progress` and later `subagent_finished` for a child
- **THEN** that child is `working` and then completes with its outcome, and its root is unchanged

#### Scenario: Unrelated session in the sessions tree

- **WHEN** a session exists in the sessions tree that no record on the bound root's journal names
- **THEN** it is not attached as a child

#### Scenario: Resuming a Grok journal in a new process

- **WHEN** a Grok session is quit, clearing the Agents pane, and the same writer-held journal is resumed in a new `grok --resume` process
- **THEN** the pane shows Grok again moving through working and done, with a live title update from `summary.json`

## ADDED Requirements

### Requirement: OpenCode session store and binding

The `terminay-agent-opencode` package SHALL own every OpenCode executable name, data-root rule, binding rule, mapping version, fixture, and compatibility test. OpenCode state SHALL live in the SQLite session store `opencode.db` below the effective OpenCode data root, which is `~/.local/share/opencode` when `XDG_DATA_HOME` is unset and the platform default otherwise. Snapshot repositories, tool-output files, logs, and the auth and account stores SHALL NOT be lifecycle sources.

Binding SHALL require the exact writable `opencode.db`, or its write-ahead log, held by a process in the registered PTY process tree. The bound root SHALL be the `session` row whose `directory` matches that descendant process's working directory and which has no `parent_id`, and its `id` SHALL be the provider session ID. Where one writer holds several eligible root sessions, the most recently updated eligible root SHALL be selected. Directory, timestamp, slug, and title SHALL never be identity on their own.

#### Scenario: Writable store held by the PTY tree

- **WHEN** a descendant of the registered PTY holds `opencode.db` open for writing
- **THEN** its matching parentless `session` row is admitted as the terminal's root

#### Scenario: Store outside the data root

- **WHEN** a candidate store is not below the effective OpenCode data root
- **THEN** it is not eligible

#### Scenario: Several eligible roots

- **WHEN** one writer holds several eligible root sessions
- **THEN** the most recently updated eligible root is selected

### Requirement: OpenCode privacy boundary

Terminay SHALL read only lifecycle and bounded display metadata from the OpenCode store. The `message` and `part` tables carry prompts, responses, reasoning, tool arguments, and tool output; their `data` payloads SHALL never cross the extension boundary and SHALL never be logged. Event records naming a message or part SHALL contribute only bounded lifecycle facts — identity, kind, and completion — and never their content.

#### Scenario: Message payload encountered

- **WHEN** a `message` or `part` row is read for lifecycle purposes
- **THEN** its content payload does not cross the extension boundary and is not logged

### Requirement: OpenCode record mapping

The first supported mapping SHALL be `(opencode, 0.1)` and SHALL accept later OpenCode versions until a divergent mapping is added. It SHALL follow the store's append-only `event` log, ordered by `aggregate_id` and `seq`, and SHALL map records as follows: a `session.created` or first `session.updated` for the bound root produces root `session.started` and `idle`; the session's `slug` seeds the root label and a non-empty `title` replaces it in place on the existing root without creating a second root or changing state; a message record whose role is `user` starts a turn as `working`; a tool part recorded `pending` produces `waiting`, its transition to `running` finishes that wait and produces a `working` tool start keyed by the native `callID`, and `completed` or `error` finishes that tool with the corresponding outcome; a `task` tool part is a named child rather than an ordinary tool, starting and completing beneath the root without completing it; an assistant message carrying a completion produces `done` with its outcome; and unknown event types are ignored so additive OpenCode changes remain compatible.

OpenCode records no explicitly blocking condition, so `blocked` SHALL be derived under the journal-derived inference rules: an assistant message recording an error with no completion SHALL make the entry `blocked`, while an error on a completed message SHALL be `done` with an error outcome.

#### Scenario: Turn runs to completion

- **WHEN** OpenCode records a user message and later an assistant completion
- **THEN** the root is `working` and then `done`

#### Scenario: Permission request

- **WHEN** a tool part is recorded `pending` and later `running`
- **THEN** the root is `waiting` and then resumes `working`

#### Scenario: Child session

- **WHEN** a `task` tool part starts and completes
- **THEN** a named child starts and completes beneath that root and no second root binds

#### Scenario: Unknown event type

- **WHEN** an event carries an unrecognized type
- **THEN** it is ignored

#### Scenario: Error halts a turn

- **WHEN** OpenCode records an error and no completion event follows for that turn
- **THEN** the entry is `blocked` and records that the state was inferred

### Requirement: Grok fault inference

Grok records `permission_requested` and `permission_resolved` explicitly and
SHALL map them directly to `waiting` and back to `working`. Grok records no
explicitly blocking condition, so `blocked` SHALL be derived under the
journal-derived inference rules: a `turn_ended` whose outcome is an error, or a
recorded fault that halts a turn with no `turn_ended` following, SHALL make the
entry `blocked` where it reports a condition needing intervention, and `done`
with an error outcome otherwise.

#### Scenario: Permission request

- **WHEN** Grok records `permission_requested` and later `permission_resolved`
- **THEN** the entry is `waiting` and then resumes `working`

#### Scenario: Fault halts a turn

- **WHEN** a recorded Grok fault halts a turn with no `turn_ended` following
- **THEN** the entry is `blocked` and records that the state was inferred

### Requirement: Deterministic root label before a provider title

Every bound root SHALL carry a label from the moment it is created. Until the provider records an explicit title, the label SHALL be the provider display name, or the provider's own deterministic pre-title identifier where it records one. An explicit provider title SHALL replace that label in place on the existing root and SHALL NOT create another root, replay lifecycle events, or change `working`, `waiting`, `blocked`, `done`, or child state.

#### Scenario: Root created before a title exists

- **WHEN** a root binds and the provider has recorded no explicit title
- **THEN** the entry carries the provider display name or the provider's deterministic pre-title identifier

#### Scenario: Explicit title arrives

- **WHEN** the provider later records an explicit title
- **THEN** the existing root's label is replaced in place and its state and lifecycle history are unchanged
