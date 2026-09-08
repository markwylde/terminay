# agent-status-and-sidebar Specification

## Purpose

Terminay composes installed coding-agent extension providers with project environments and reduces their canonical lifecycle events into provider-neutral agent entries that drive terminal-tab status, a project-scoped Agents pane with roots and in-process subagents, and the header activity dropdown.

## Requirements

### Requirement: Provider-neutral canonical agent model

Terminay SHALL reduce provider lifecycle events into provider-neutral agent entries. The same canonical model SHALL feed terminal-tab status, the project-scoped **Agents** pane with roots and in-process subagents, and the header activity dropdown. A native source SHALL be authoritative only after Terminay binds it to the exact server-owned PTY through that provider's documented terminal identity evidence.

#### Scenario: Provider bound to a PTY

- **WHEN** a provider's documented terminal identity evidence is proven for an exact server-owned PTY
- **THEN** its native records become an authoritative source for that terminal's agent entries

#### Scenario: Evidence not proven

- **WHEN** a provider is running but its terminal identity evidence is not proven
- **THEN** that native source is not authoritative and terminal activity remains the signal

### Requirement: Server-owned authorization and client subscription

Terminal and project authorization, environment routing, canonical validation, ordering, snapshots, acknowledgement, and terminal/project mapping SHALL live in Terminay Server. Provider-specific discovery, process binding, incremental reading, version selection, and native-record normalization SHALL live in separately hosted extensions using only the public Extension API. Connected clients SHALL subscribe to the same ordered reduced snapshot and SHALL NOT read provider journals or create competing agent state.

#### Scenario: Client rendering agent state

- **WHEN** a client displays agent status
- **THEN** it renders the server's ordered reduced snapshot and reads no provider journal

#### Scenario: Extension observing a provider

- **WHEN** an extension observes a provider
- **THEN** it uses only the public Extension API and does not perform terminal or project authorization

### Requirement: Provider journal privacy boundary

Provider journals and stores SHALL be private privileged inputs. Their raw records, prompts, responses, instructions, reasoning, tool arguments, and tool output SHALL never cross the server boundary and SHALL never be logged by the integration.

#### Scenario: Journal containing conversation content

- **WHEN** a provider journal contains prompts, responses, reasoning, tool arguments, or tool output
- **THEN** none of that content crosses the server boundary or is written to logs

### Requirement: Agent extension observation environment

Foreground-process and journal discovery SHALL be public project-environment capabilities. Agent extensions SHALL be ordinary trusted Node.js programs that, on **This server**, combine the host-issued terminal context including the PTY shell PID with Node process and filesystem APIs through the public observation helpers. Those helpers run in the extension child, SHALL NOT be described as a sandbox, and SHALL NOT round-trip local process-listing snapshots through host IPC. The child SHALL inherit a bounded host environment covering `PATH`, `HOME`, and locale so the same process-inspection binaries still resolve, and installer-style sterile `NODE_OPTIONS` SHALL NOT be applied to agent observation.

#### Scenario: Observing on the server host

- **WHEN** an agent extension observes a terminal on **This server**
- **THEN** it inspects processes and files in its own child using the host-issued terminal context, without routing those snapshots through host IPC

#### Scenario: Child environment

- **WHEN** the extension child is spawned for agent observation
- **THEN** it inherits a bounded `PATH`, `HOME`, and locale and is not given sterile `NODE_OPTIONS`

### Requirement: Non-local environments use the observation broker

SSH and other non-local environments SHALL NOT use the server host's process tree or home directory. They SHALL use the environment-routed observation broker when the environment advertises that capability; otherwise observation SHALL be unavailable.

#### Scenario: SSH environment advertising observation

- **WHEN** a project's SSH environment advertises the observation capability
- **THEN** agent observation is routed through the environment-routed observation broker

#### Scenario: Environment without the capability

- **WHEN** a non-local environment does not advertise the observation capability
- **THEN** agent observation is unavailable for its terminals and the server host's process tree is not used

### Requirement: Foreground process matching

Process-name matching SHALL be a prompt rather than proof. `codex` and `codex-tui` SHALL bind Codex and `grok` SHALL bind Grok, while an unmatched `node` or `bun` wrapper SHALL try every capable provider until one proves a writer-held journal. Observation SHALL also inspect the PTY shell PID itself so an `exec`'d CLI still has its open files examined. The Grok CLI's `agent` symlink SHALL NOT be a Grok process matcher because Cursor owns the `agent` executable name.

#### Scenario: Recognized provider name

- **WHEN** the terminal's foreground process is named `codex` or `codex-tui`
- **THEN** the Codex provider is attempted for binding

#### Scenario: Generic wrapper name

- **WHEN** the terminal's foreground process is a `node` or `bun` wrapper
- **THEN** every capable provider is tried until one proves a writer-held journal

#### Scenario: Exec'd CLI

- **WHEN** a CLI replaces the shell through `exec`
- **THEN** observation inspects the PTY shell PID's own open files

#### Scenario: Grok launched as `agent`

- **WHEN** a process appears under the `agent` executable name
- **THEN** it does not match Grok

### Requirement: Zero-configuration discovery outcomes

Running a CLI supplied by an enabled agent extension normally in an interactive Terminay terminal SHALL be discovered without editing provider configuration or installing global integrations. Agent state SHALL remain associated with the exact terminal the user can activate. Provider file formats and versions SHALL stay out of client components and stores. Newer compatible provider versions SHALL reuse the latest known mapping. Unsupported, missing, malformed, or ephemeral journals SHALL degrade safely to terminal activity.

#### Scenario: Running a supported CLI

- **WHEN** a user runs a supported agent CLI normally in a Terminay terminal
- **THEN** it is discovered without provider configuration edits or global integrations, and its state is bound to that exact terminal

#### Scenario: Malformed journal

- **WHEN** a provider journal is unsupported, missing, malformed, or ephemeral
- **THEN** the terminal degrades to terminal-activity signalling rather than showing agent state

### Requirement: Failed terminal admission falls back without interrupting the terminal

If a running provider is matched and its terminal admission subsequently fails, Terminay SHALL release that provider claim and replay the same foreground change through terminal activity. This SHALL be treated as a fallback rather than a successful agent observation. The privileged host SHALL record one `agent-admission-failed` diagnostic containing the provider id, opaque terminal identity, coarse failure class, and the error the provider reported. That diagnostic SHALL be recorded on every failed admission rather than being merely available to record. It SHALL NOT contain journal records, prompts, tool inputs or results, or paths belonging to the observed project.

#### Scenario: Admission failure after a match

- **WHEN** a matched provider's terminal admission fails
- **THEN** the provider claim is released, the foreground change is replayed through terminal activity, and the terminal is not interrupted

#### Scenario: Admission diagnostic content

- **WHEN** an `agent-admission-failed` diagnostic is recorded
- **THEN** it contains the provider id, opaque terminal identity, coarse failure class, and reported error, and no journal record, prompt, tool input, tool result, or observed-project path

#### Scenario: Every failure is recorded

- **WHEN** admission fails for any matched provider on any terminal
- **THEN** exactly one such diagnostic is recorded for that failure

### Requirement: Provider ids are extension contributions

Provider ids SHALL be namespaced extension contributions rather than a closed core union. Terminay SHALL bundle enabled-by-default Codex, Claude Code, Cursor Agent, Grok, OpenCode, and omp providers. A third-party provider SHALL appear through the same validated manifest, hosted runtime, canonical event, Settings, and disablement contracts. Persisted unknown or disabled provider ids SHALL remain bounded metadata and SHALL NOT cause provider code to load in a client.

#### Scenario: Third-party provider

- **WHEN** a third-party agent provider extension is installed
- **THEN** it participates through the same manifest, runtime, canonical event, Settings, and disablement contracts as the bundled providers

#### Scenario: Unknown persisted provider id

- **WHEN** persisted state references an unknown or disabled provider id
- **THEN** it remains bounded metadata and no provider code loads in a client

### Requirement: Canonical agent states

An agent entry SHALL carry one of five states. `working` means the agent is processing a turn or performing tool or subagent work and SHALL be indicated in yellow or amber with restrained motion. `waiting` means the provider explicitly requests approval, an answer, or other user input and SHALL be indicated in red. `blocked` means a supported record explicitly reports a blocking condition and SHALL be indicated in red with an accessible label distinct from waiting. `done` means the current turn or agent run completed, failed, or was cancelled and SHALL be indicated in green. `idle` means the live session exists without active work or a pending result and SHALL be neutral or hidden on compact surfaces.

#### Scenario: Approval requested

- **WHEN** a provider record explicitly requests approval or user input
- **THEN** the entry is `waiting` and is indicated in red

#### Scenario: Blocking condition

- **WHEN** a supported record explicitly reports a blocking condition
- **THEN** the entry is `blocked` and carries an accessible label distinct from waiting

#### Scenario: Turn completes

- **WHEN** a turn completes, fails, or is cancelled
- **THEN** the entry is `done` and is indicated in green

### Requirement: Acknowledgement independent of state

Acknowledgement SHALL be independent of operational state. Viewing an entry SHALL clear its unread treatment without rewriting its provider-derived state, and a later meaningful transition SHALL be able to make it unread again.

#### Scenario: Viewing an entry

- **WHEN** the user views an agent entry
- **THEN** its unread treatment clears and its provider-derived state is unchanged

#### Scenario: New transition after acknowledgement

- **WHEN** a meaningful transition occurs after an entry was acknowledged
- **THEN** the entry becomes unread again

### Requirement: Roots and children

A root SHALL represent one live provider session bound to a Terminay PTY. A provider-native child SHALL be represented beneath that root and SHALL normally activate the same terminal. Stable native session, turn, child, and agent IDs SHALL be used when available, and display text SHALL never be an identity key. Child transitions SHALL NOT replace root state, and a child stop SHALL update only that child.

#### Scenario: Child transition

- **WHEN** a provider-native child changes state
- **THEN** only that child's entry updates and the root's state is unchanged

#### Scenario: Identity keys

- **WHEN** entries are correlated across records
- **THEN** stable native ids are used and display text is not treated as an identity key

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

### Requirement: Heuristics never establish binding

CWD, filename timestamps, terminal title, active tab, and closest-match logic SHALL NOT independently establish an authoritative binding. Claude Code SHALL use its exact descendant process CWD to establish the native project journal directory and post-process-start root writes to select the active session. OMP SHALL use its own terminal-scoped breadcrumb whose terminal ID derives from the PTY TTY running OMP and whose target is validated under OMP's allowed session root. A host that cannot establish provider proof SHALL use terminal fallback.

#### Scenario: Nearest-timestamp candidate

- **WHEN** a candidate journal matches only by timestamp, filename, terminal title, or proximity
- **THEN** it is not admitted as an authoritative binding

### Requirement: Renewable root binding within an immutable process boundary

The terminal and process-tree boundary SHALL be immutable for one live provider-process incarnation while its root-session binding SHALL be renewable. Provider-native `/resume` or session switching SHALL move authority to the root journal receiving the newest current-session activity, retire the previous root, and replay the new root in the same activation terminal. A resumed provider session that reopens the same journal in another terminal SHALL create a new binding incarnation and activation terminal, and stale events from the previous incarnation SHALL NOT mutate it.

#### Scenario: Resuming a session in the same terminal

- **WHEN** a provider resumes or switches sessions in a bound terminal
- **THEN** authority moves to the newest-active root journal, the previous root is retired, and the new root is replayed in the same activation terminal

#### Scenario: Same journal reopened elsewhere

- **WHEN** a resumed session reopens the same journal in a different terminal
- **THEN** a new binding incarnation and activation terminal are created and stale events from the previous incarnation do not mutate it

### Requirement: Discovery windows and retries

Every transition away from the shell SHALL start a new bounded journal-discovery window even when the foreground name is not a recognized provider, so a resumed session launched long after terminal startup can bind its reopened journal without treating the wrapper as an agent. Discovery SHALL be retried briefly after terminal startup and whenever the shell loses foreground. A blank or unknown process name SHALL NOT be a leave-shell edge and SHALL NOT start discovery. A provider that reports `not-bound`, or whose observation throws before a journal is proven, SHALL be retried at most ten times at a 100 ms debounce while that exact foreground incarnation remains current. After that fast window, topology polling SHALL keep discovery armed until the incarnation is bound or returns to the shell, and SHALL re-admit on the first sample after the fast window rather than only when a later signature changes. An empty process snapshot SHALL be treated as ordinary transient evidence rather than a reason to give up.

#### Scenario: Not-bound provider

- **WHEN** a provider reports `not-bound` for the current foreground incarnation
- **THEN** discovery retries at most ten times at a 100 ms debounce while that incarnation remains current

#### Scenario: Journal appears after the fast window

- **WHEN** a provider opens its writable journal only after the fast discovery window ends
- **THEN** topology polling re-admits it on the first sample after that window

#### Scenario: Blank foreground name

- **WHEN** the foreground process name is blank or unknown
- **THEN** no leave-shell discovery window starts

#### Scenario: Empty process snapshot

- **WHEN** a process snapshot returns empty
- **THEN** it is treated as transient evidence and discovery continues

### Requirement: Repeated provider match handling

A repeated match for the same provider SHALL keep an active root observer intact, and SHALL start a fresh binding incarnation when that terminal's canonical root has already exited. Foreground sampling MAY miss a brief return to the shell between an exited session and a resume command, and the contract SHALL still bind the resumed session.

#### Scenario: Resume after the previous root exited

- **WHEN** the same provider matches again in a terminal whose canonical root has already exited
- **THEN** a fresh binding incarnation starts

#### Scenario: Repeated match with a live root

- **WHEN** the same provider matches again while its root observer is active
- **THEN** the existing observer is kept intact

### Requirement: Immediate root materialization

Once an extension proves a terminal-scoped binding, Server Core SHALL materialize the root session immediately. The first provider-native `session.started` record SHALL refine that root as metadata, so a slow watcher or optional enrichment cannot hide a proven active session from the Agents pane.

#### Scenario: Binding proven before the session header is read

- **WHEN** an extension proves a terminal-scoped binding but the provider session header has not yet been read
- **THEN** the root session appears in the Agents pane immediately and is refined by the later `session.started` record

### Requirement: Process-scoped live projection

Live Agents projection SHALL be scoped to one running Terminay process rather than a durable `serverId`. Each process SHALL mint an ephemeral `processInstanceId` at boot and stamp it on every snapshot it emits, and a client connected to that process SHALL render only that snapshot. Observation SHALL stay bound only while the journal writer remains a descendant of a PTY shell that process spawned, and SHALL drop the observer as soon as that writer leaves its PTY tree.

#### Scenario: Two processes sharing files

- **WHEN** two Terminay processes share project names, session ids, or provider journal files
- **THEN** neither populates the other's Agents pane

#### Scenario: Writer leaves the PTY tree

- **WHEN** the journal writer is no longer a descendant of a PTY shell this process spawned
- **THEN** this process drops the observer

### Requirement: Agent extension observation runtime contract

An agent extension observation runtime SHALL obtain provider-specific terminal-to-journal identity evidence beneath the effective provider home; prove that evidence belongs to the registered PTY shell process or its terminal TTY; read a bounded initial window and then only appended bytes; buffer an incomplete final JSONL line until it is completed; detect truncation, atomic replacement, provider session switch, writer exit, and process-incarnation change; keep raw records inside its isolated extension host and emit only validated canonical lifecycle events; and stop all file and process observation when the terminal, integration, or server stops.

#### Scenario: Partial trailing line

- **WHEN** the journal's final line is incomplete
- **THEN** it is buffered until completed rather than parsed

#### Scenario: Journal truncated or replaced

- **WHEN** the journal is truncated or atomically replaced
- **THEN** the runtime detects it and re-establishes reading rather than emitting corrupt events

#### Scenario: Terminal stops

- **WHEN** the terminal, integration, or server stops
- **THEN** all file and process observation for it stops

### Requirement: Bounded and defensive journal handling

Expensive open-file and process inspection SHALL be used for initial binding and not for every appended record. Local open-file snapshots SHALL prefer journal paths such as `.jsonl` entries and `/sessions/` directories and SHALL stay bounded for the provider. Optional enrichment after a proven bind, such as a session-name index, child directory listing, or provider home variable, SHALL NOT fail admission. Symlinks, non-regular files, paths outside the canonical sessions root, oversized records, invalid JSON, and unbounded growth SHALL be handled defensively.

#### Scenario: Appended record

- **WHEN** a new record is appended to a bound journal
- **THEN** it is read without repeating open-file or process inspection

#### Scenario: Enrichment failure

- **WHEN** optional enrichment after a proven bind fails
- **THEN** the binding remains admitted

#### Scenario: Unsafe journal candidate

- **WHEN** a candidate is a symlink, a non-regular file, or outside the canonical sessions root
- **THEN** it is rejected

### Requirement: Public versioned driver contract

The public driver abstraction SHALL be identified by `(provider, mappingVersion)`. A driver SHALL recognize session metadata, map a strict allowlist of native records to canonical lifecycle events, and read only bounded lifecycle and display metadata. A driver SHALL NOT focus UI, assert project or terminal authorization, read outside broker-issued capabilities, mutate the canonical store directly, import a private Terminay module, or expose raw records.

#### Scenario: Record outside the allowlist

- **WHEN** a native record is not in the driver's allowlist
- **THEN** it produces no canonical lifecycle event

#### Scenario: Driver attempting privileged action

- **WHEN** a driver attempts to focus UI, assert authorization, mutate the canonical store, or read outside broker-issued capabilities
- **THEN** the action is not available to it

### Requirement: Mapping version selection

Mapping versions SHALL describe Terminay parsers, and provider CLI versions SHALL be normalized to major and minor. The registry SHALL choose the greatest mapping version less than or equal to the running provider version. A provider newer than all known mappings SHALL use the newest mapping optimistically, and one older than all mappings SHALL use the oldest. Unknown records SHALL be ignored so additive provider changes remain compatible.

#### Scenario: Newer provider version

- **WHEN** the running provider version is newer than every known mapping
- **THEN** the newest mapping is used

#### Scenario: Older provider version

- **WHEN** the running provider version is older than every known mapping
- **THEN** the oldest mapping is used

### Requirement: Extension-owned mappings and compatibility testing

Each extension package SHALL own its mappings, bounded fixtures, documentation, and contract tests. A compatibility script SHALL run a candidate provider-version fixture against the mapping the registry would select. Passing SHALL mean no new mapping is required; semantic failure SHALL require a new mapping and fixtures without changing earlier mappings.

#### Scenario: Compatibility check passes

- **WHEN** a candidate provider-version fixture passes against the selected mapping
- **THEN** no new mapping version is required

#### Scenario: Compatibility check fails semantically

- **WHEN** a candidate fixture fails semantically
- **THEN** a new mapping and fixtures are added and earlier mappings are left unchanged

### Requirement: Canonical sequencing of provider records

Sequence numbers SHALL come from accepted record order within one binding incarnation. Provider timestamps SHALL be used only when valid. Replayed initial windows and repeated records SHALL NOT rewind an entry. Tool arguments, tool output, assistant text, reasoning, chat history, and provider protocol updates SHALL never be projected.

#### Scenario: Replayed initial window

- **WHEN** an initial window is replayed or a record is seen again
- **THEN** the entry's state is not rewound

#### Scenario: Record carrying model output

- **WHEN** a mapped record carries assistant text, reasoning, tool arguments, or tool output
- **THEN** none of that content is projected into agent entries

### Requirement: Codex session roots and home resolution

Codex sessions SHALL live below the effective `CODEX_HOME/sessions` root, and the host account's `.codex/sessions` root SHALL be used when `CODEX_HOME` is unset. Shell snapshots SHALL NOT be lifecycle sources. A rollout SHALL be eligible as the terminal's root only when its initial `session_meta` identifies `originator: codex-tui` and `source: cli`. Provider-native subagent sources SHALL remain in-process children of that root and SHALL NOT compete with root rollouts during process-bound discovery. When one writer holds multiple eligible root rollouts, the most recently modified eligible root SHALL be selected. The `terminay-agent-codex` package SHALL own every Codex executable name, home-root rule, process and journal binding rule, mapping version, fixture, and compatibility test.

#### Scenario: Rollout with a non-CLI originator

- **WHEN** a Codex rollout's `session_meta` does not identify `originator: codex-tui` and `source: cli`
- **THEN** it is not eligible as the terminal's root

#### Scenario: Multiple eligible rollouts

- **WHEN** one writer holds several eligible root rollouts after a resume or branch
- **THEN** the most recently modified eligible root is selected

#### Scenario: Different rollout opened while Codex stays foreground

- **WHEN** the bound process tree opens a different eligible root rollout
- **THEN** the tail switches, the previous root is retired, and the fresh or resumed session is replayed

### Requirement: Codex record mapping

The `(codex, 0.1)` mapping SHALL accept later Codex versions until a divergent mapping is added and SHALL map records as follows: a root `session_meta` with `originator: codex-tui` and `source: cli` produces root `session.started` and `idle`; an `event_msg/item_completed` carrying a `UserMessage`, or a legacy `event_msg/user_message`, makes the first user-facing message the stable root prompt label while raw `response_item` messages are ignored; an `event_msg/item_completed` carrying a `CollabAgentToolCall` or `SubAgentActivity` fans out bounded child identity and state into child lifecycle events; a model-context user item such as `<turn_aborted>` is ignored for naming; `event_msg/task_started` produces root `turn.started` and `working`; a tool or item begin or callable response item produces the corresponding root or child `working`; an execution, patch, or permission approval request produces the corresponding entry `waiting`; an `event_msg/request_user_input` or elicitation request produces `waiting`; a matching response or resolution or subsequent progress finishes the wait and resumes `working`; `event_msg/task_complete` produces `done`; an error or aborted completion produces `done` with an error or cancelled outcome unless explicitly blocking; and `event_msg/shutdown_complete` or a confirmed writer or process exit makes the root inactive.

#### Scenario: Turn start and completion

- **WHEN** Codex writes `event_msg/task_started` and later `event_msg/task_complete`
- **THEN** the root moves to `working` and then to `done`

#### Scenario: Approval request

- **WHEN** Codex writes an execution, patch, or permission approval request
- **THEN** the corresponding entry becomes `waiting` until a matching resolution or subsequent progress resumes `working`

#### Scenario: Aborted completion

- **WHEN** Codex reports an error or aborted completion that is not explicitly blocking
- **THEN** the entry becomes `done` with an error or cancelled outcome

### Requirement: Codex collaboration child mapping

A `collab_agent_spawn_end` record SHALL create the matching child from `new_thread_id` with bounded nickname, role, task, model, and sender parent identity. A collaboration interaction, resume, or path activity SHALL create or resume the matching child, preferring nickname, then role, then the final path segment for its label. A collaboration completion, error, or interruption SHALL mark only the matching child done with a success, error, or cancelled outcome and retain it for acknowledgement. A collaboration close or shutdown SHALL retire only the matching child from the live tree.

#### Scenario: Child spawn

- **WHEN** a `collab_agent_spawn_end` record arrives
- **THEN** a child is created from `new_thread_id` with its bounded nickname, role, task, model, and parent identity

#### Scenario: Child completion

- **WHEN** a collaboration completion, error, or interruption arrives
- **THEN** only the matching child is marked done and retained for acknowledgement

#### Scenario: Child shutdown

- **WHEN** a collaboration close or shutdown arrives
- **THEN** only the matching child is retired from the live tree

### Requirement: Codex session title index

Codex SHALL store an explicit user-edited session title in the effective `CODEX_HOME/session_index.jsonl` file, or `~/.codex/session_index.jsonl` when `CODEX_HOME` is unset. Its matching `id` and bounded non-empty `thread_name` SHALL be display metadata for that same root session. The extension SHALL follow that terminal-scoped index while the rollout is bound so that an initial title, every subsequent rename, and a title recovered after the index is atomically replaced or truncated update the existing root entry in place. A title change SHALL NOT create another root, replay lifecycle events, or change working, waiting, blocked, done, or child state. Where there is no explicit title, the first eligible user message SHALL remain the root label.

#### Scenario: Session renamed

- **WHEN** the session index records a new `thread_name` for the bound root's `id`
- **THEN** the existing root entry's label updates in place with no new root and no lifecycle replay

#### Scenario: Index replaced

- **WHEN** the session index is atomically replaced or truncated
- **THEN** the title is recovered and applied to the existing root entry

#### Scenario: No explicit title

- **WHEN** no explicit title exists for the bound root
- **THEN** the first eligible user message remains the root label

### Requirement: Codex subagent journals

Codex subagents SHALL have separate rollout journals under the same effective sessions root, declaring their native parent in `session_meta.source.subagent.thread_spawn.parent_thread_id` and repeating the bounded parent, session, and display metadata needed for safe projection. The extension SHALL list and follow only a bounded terminal-scoped sessions directory through the public observation broker so children created after the root is bound are admitted live. A journal SHALL be included as a child source only when its native parent id equals the already bound root provider session id, and native child ids SHALL be de-duplicated across the initial listing and later directory snapshots. Timestamp, path proximity, `agent_path`, and display text SHALL NOT establish a child-parent relationship. A discovered child SHALL start, update, complete, and exit beneath the existing root without changing that root's lifecycle or creating a second root binding.

#### Scenario: Child created after the root binds

- **WHEN** a subagent rollout naming the bound root's provider session id appears after binding
- **THEN** it is admitted live as a child beneath that root

#### Scenario: Journal with an unrelated parent id

- **WHEN** a candidate child journal's native parent id does not equal the bound root's provider session id
- **THEN** it is not included as a child source

#### Scenario: Repeated child listing

- **WHEN** the same native child id appears in both the initial listing and a later directory snapshot
- **THEN** it is de-duplicated into a single child entry

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

### Requirement: Cursor Agent binding and privacy

The `terminay-agent-cursor` package SHALL own Cursor executable recognition, process-bound chat-store discovery, transcript mapping, metadata refresh, fixtures, compatibility tests, and its privacy boundary. Cursor Agent CLI chats live below `~/.cursor/chats` and their JSONL transcripts below `~/.cursor/projects`. Terminay SHALL NOT read Cursor's SQLite conversation payloads. It SHALL use only an exact writable `store.db` held by the registered PTY process tree, the bounded adjacent `meta.json` cwd, and the shared session UUID in the chat-store and transcript paths to bind the corresponding transcript, encoding the canonical cwd using Cursor's project directory convention. Paths outside either canonical Cursor root, malformed UUIDs, symlinks escaping those roots, and timestamp or nearest-file matches SHALL NOT be eligible.

#### Scenario: Binding a Cursor transcript

- **WHEN** the registered PTY process tree holds an exact writable `store.db`
- **THEN** the shared session UUID and bounded adjacent `meta.json` cwd bind the corresponding transcript

#### Scenario: Escaping symlink

- **WHEN** a candidate path is a symlink escaping a canonical Cursor root or has a malformed UUID
- **THEN** it is not eligible

#### Scenario: Conversation payloads

- **WHEN** Cursor stores conversation content in SQLite blobs
- **THEN** Terminay does not read them

### Requirement: Cursor Agent record mapping

The first supported Cursor mapping SHALL be `(cursor, 0.1)`. Because Cursor transcripts carry no session header, the process-bound chat-store path SHALL supply the stable provider session ID. A bounded non-empty `meta.json` title SHALL be the root label and SHALL be refreshed while the transcript remains bound so renames update live. Terminay SHALL read only the bounded `lastUsedModel` field from the exact process-bound `store.db` metadata row in read-only mode and SHALL refresh that model metadata while bound. Where no title exists, a user record SHALL start a turn and its bounded `<user_query>` content, excluding Cursor's timestamp wrapper, SHALL become the root label. Assistant records SHALL keep the turn working without projecting assistant text, reasoning, tool arguments, or tool output. A `type: "turn_ended"` record SHALL map its status to a successful, failed, or cancelled `done` result.

#### Scenario: Cursor rename

- **WHEN** the bound chat's `meta.json` title changes
- **THEN** the root label updates live

#### Scenario: No Cursor title

- **WHEN** no `meta.json` title exists
- **THEN** a user record starts a turn and its bounded `<user_query>` content, without the timestamp wrapper, becomes the root label

#### Scenario: Turn ends

- **WHEN** a `type: "turn_ended"` record arrives
- **THEN** the entry becomes `done` with a successful, failed, or cancelled result matching its status

### Requirement: Cursor waiting states and task calls are not projected

Cursor transcripts do not persist an unresolved permission or elicitation record, so they SHALL NOT authoritatively produce `waiting` or `blocked`, and generic terminal activity SHALL remain the fallback while such a prompt is on screen. Cursor persists `Task` tool calls without stable task IDs or matching completion records, so Terminay SHALL NOT project those calls as child agents.

#### Scenario: Cursor permission prompt on screen

- **WHEN** Cursor shows a permission prompt that is not persisted in the transcript
- **THEN** the entry does not become `waiting` or `blocked` and terminal activity remains the fallback signal

#### Scenario: Cursor Task tool call

- **WHEN** Cursor persists a `Task` tool call without a stable id or completion record
- **THEN** no child agent entry is created

### Requirement: omp session roots and data-root resolution

The `terminay-agent-omp` package SHALL own every omp and Bun executable rule, data-root rule, terminal breadcrumb, mapping, title-slot parser, and fixture. omp sessions SHALL live below the effective agent sessions root, which is `~/.omp/agent/sessions` when `PI_CODING_AGENT_DIR` is unset and no named `OMP_PROFILE` or `PI_PROFILE` is active. A named profile SHALL relocate the agent directory, and Linux XDG data relocation after a config migration SHALL be honored. History SQLite, blob stores, debug logs, daemon sockets, RPC/ACP endpoints, and collaboration websockets SHALL NOT be lifecycle sources. A root journal SHALL be a `*.jsonl` file whose parent directory is an encoded-cwd directory under the sessions root rather than a nested artifacts directory of another session file. Child journals SHALL live beside the parent as `<parent-stem>/<agentId>.jsonl`, SHALL be in-process children of that root, and SHALL NOT compete with root journals during process-bound discovery. Where one writer holds multiple eligible root journals, the most recently modified eligible root SHALL be selected.

#### Scenario: Named profile active

- **WHEN** a named `OMP_PROFILE` or `PI_PROFILE` is active
- **THEN** the agent directory is relocated accordingly and sessions are resolved below the relocated root

#### Scenario: Nested artifacts file

- **WHEN** a candidate `*.jsonl` sits in a nested artifacts directory of another session file
- **THEN** it is not a root journal

#### Scenario: Multiple eligible omp roots

- **WHEN** one writer holds several eligible root journals
- **THEN** the most recently modified eligible root is selected

### Requirement: omp title slot and session identity

Physical omp JSONL files SHALL begin with a fixed 256-byte `type: "title"` slot which Terminay SHALL skip before any session-identity check. The logical first record SHALL be `type: "session"` with a stable `id`. A physical first line of `type: "title"` SHALL never be a session-identity record and SHALL never satisfy a Codex `session_meta` check. Title-only slot rewrites do not change file size and SHALL NOT be required for lifecycle. The first supported mapping SHALL be `(omp, 0.1)` and SHALL accept later omp session versions until a divergent mapping is added.

#### Scenario: Reading an omp journal header

- **WHEN** an omp journal is opened
- **THEN** the 256-byte title slot is skipped and the logical first `type: "session"` record supplies the stable provider session id

#### Scenario: Title slot mistaken for a Codex header

- **WHEN** a physical first line of `type: "title"` is evaluated
- **THEN** it does not satisfy a Codex `session_meta` identity check

### Requirement: omp terminal breadcrumb binding

OMP SHALL write a terminal-scoped breadcrumb below its effective agent data root at `terminal-sessions/<terminal-id>`, whose identifier derives from the OMP process's TTY and which records its CWD, exact session-file path, and an optional `fresh` marker. Terminay SHALL derive the same ID from the registered PTY shell's TTY, accept only a bounded well-formed breadcrumb whose target is a validated root JSONL below an allowed OMP sessions root, and recheck it while OMP remains foreground. A `fresh` breadcrumb whose JSONL is not yet materialized SHALL keep terminal-activity fallback until the target exists. A changed breadcrumb SHALL rebind the same terminal to the newly validated root. CWD, filename timestamps, and newest-file heuristics SHALL NOT establish ownership, and open file-descriptor observation SHALL be supplementary evidence only. A `bun` wrapper SHALL be admitted only after the OMP terminal breadcrumb for the exact PTY identifies a validated OMP root JSONL, while an `omp` binary that sets its process title SHALL match `omp` directly.

#### Scenario: Fresh breadcrumb without a file

- **WHEN** the breadcrumb carries a `fresh` marker and its target JSONL does not yet exist
- **THEN** the terminal stays on terminal-activity fallback until the target exists

#### Scenario: Breadcrumb changes

- **WHEN** the breadcrumb for the bound terminal changes to another validated root
- **THEN** the same terminal rebinds to the newly validated root

#### Scenario: Bun wrapper

- **WHEN** the foreground process is a `bun` wrapper
- **THEN** it is admitted only after the OMP breadcrumb for the exact PTY identifies a validated OMP root JSONL

### Requirement: omp durability and state limits

A brand-new interactive omp session SHALL remain memory-only until the first assistant message is persisted or the process forces the file onto disk, and the terminal SHALL stay on terminal-activity fallback until that file exists. Streaming tokens are not on disk until the completed message is appended, so the sidebar SHALL report working or done from durable records and SHALL NOT reconstruct token-by-token text. omp has no approval or elicitation journal record, so `waiting` and `blocked` SHALL be used only where a supported record explicitly requests user input, and permission prompts SHALL remain `working` while the process is alive.

#### Scenario: Session not yet on disk

- **WHEN** a new omp session has not yet persisted its file
- **THEN** the terminal uses terminal-activity fallback rather than reporting a binding failure

#### Scenario: omp permission prompt

- **WHEN** omp shows a permission prompt with no corresponding journal record
- **THEN** the entry remains `working` while the process is alive

### Requirement: omp record mapping

The omp mapping SHALL map records as follows: a logical `type: "session"` header after the title slot produces root `session.started` and `idle` with the header `id` as the provider session ID; the physical `type: "title"` slot is ignored for identity while its bounded text may seed the display name; a `type: "message"` with `message.role === "user"` makes the first user-facing text the stable root prompt label and starts a turn as `working`; a `type: "custom"` with `customType: "tool_execution_start"` produces a `working` tool start using `data.toolCallId` and `data.toolName`; an assistant message tool call produces a `working` tool start when no start marker already exists for that call; an assistant message tool result finishes the corresponding tool; an assistant completion with no unanswered tools or a terminal `stopReason` produces `done`; a `type: "custom"` with `customType: "session_exit"` makes the root inactive and interrupted when `pendingToolCalls` is present; a child `<parent-stem>/<agentId>.jsonl` produces matching child start and stop under the parent root; a `type: "model_change"` produces bounded model metadata only; and unknown `type` or `customType` values are ignored.

#### Scenario: Tool execution

- **WHEN** omp writes a `tool_execution_start` custom record and later a matching assistant tool result
- **THEN** a tool start and finish are recorded for the corresponding entry

#### Scenario: Session exit with pending tools

- **WHEN** a `session_exit` custom record carries `pendingToolCalls`
- **THEN** the root becomes inactive and interrupted

#### Scenario: Unknown omp record

- **WHEN** an unknown `type` or `customType` value is read
- **THEN** it is ignored

### Requirement: Grok session roots and binding

The `terminay-agent-grok` package SHALL own every Grok executable name, home-root rule, process and journal binding rule, mapping version, fixture, and compatibility test. Grok sessions SHALL live below the effective `GROK_HOME/sessions` root, or the host account's `.grok/sessions` root when `GROK_HOME` is unset, grouped by a URL-encoded working directory and named with Grok's session UUID. The lifecycle journal SHALL be that directory's `events.jsonl`; `chat_history.jsonl`, `updates.jsonl`, `signals.json`, memtrace, and MCP logs SHALL NOT be lifecycle sources. Because the journal carries no session-header record, the process-bound `events.jsonl` path SHALL supply the stable provider session ID after the host canonicalizes the writable handle. Home-relative containment SHALL NOT be required for that writer proof. Grok also writes `active_sessions.json` with `{session_id, pid, cwd}` rows for live processes, and where a descendant of the issued PTY has that exact pid the extension SHALL bind the corresponding journal even if the process is not holding `events.jsonl` open. CWD in that registry SHALL never be identity. A `turn_started.session_id` that does not equal the bound id SHALL be ignored. Where one writer holds multiple eligible root journals, the most recently modified eligible root SHALL be selected, and a journal whose first `turn_started` reports a `session_relationship` other than `primary` SHALL NOT be an eligible root.

#### Scenario: Binding via the active sessions registry

- **WHEN** `active_sessions.json` lists a pid that is a descendant of the issued PTY
- **THEN** the corresponding journal binds even when that process does not hold `events.jsonl` open

#### Scenario: Missing HOME in process environment

- **WHEN** a login shell omits `HOME` from process-environment observation
- **THEN** the live Grok journal is still admitted because home-relative containment is not required for writer proof

#### Scenario: Non-primary session relationship

- **WHEN** a journal's first `turn_started` reports a `session_relationship` other than `primary`
- **THEN** it is not an eligible root

#### Scenario: Foreign session id

- **WHEN** a `turn_started.session_id` differs from the bound provider session id
- **THEN** the record is ignored

### Requirement: Grok record mapping

The first supported Grok mapping SHALL be `(grok, 0.1)` and SHALL accept later Grok versions until a divergent mapping is added. It SHALL map records as follows: the first eligible `turn_started` with `session_relationship: primary` produces root `session.started` and `idle` then `turn.started` and `working`, with the model taken from a bounded `model_id`; a later `turn_started` produces the corresponding `turn.started` and `working`; a bounded `summary.json` `generated_title` or `session_summary` provides root title metadata and a rename updates the existing root in place; `tool_started` produces a `working` tool start keyed by a session-local ordinal on `tool_name` because Grok omits a native call id on start; `permission_requested` produces `waiting` and `permission_resolved` finishes the wait and resumes `working`; `tool_completed` finishes the tool using the matching start ordinal and Grok's `outcome`; `mcp_tool_call_started` and `mcp_tool_call_completed` produce tool start and finish using the native `call_id`; `turn_ended` produces `done` mapping `completed` to success, cancel or abort to cancelled, and error or fail to error; later `mcp_*` records after `turn_ended`, including resume and re-init, are ignored and SHALL NOT return the root to `working`; and unknown `type` or `phase` values are ignored.

#### Scenario: Permission cycle

- **WHEN** Grok writes `permission_requested` and later `permission_resolved`
- **THEN** the entry becomes `waiting` and then resumes `working`

#### Scenario: MCP records after a turn ends

- **WHEN** `mcp_*` records arrive after `turn_ended`, including on resume or re-init
- **THEN** they are ignored and the root does not return to `working`

#### Scenario: Turn outcome mapping

- **WHEN** `turn_ended` reports `completed`, a cancel or abort, or an error or fail
- **THEN** the entry becomes `done` with a success, cancelled, or error outcome respectively

### Requirement: Grok replay, summary metadata, and subagents

Replay SHALL follow the events journal to the last complete JSONL record, and follow chunks SHALL stay small enough to fit the extension IPC message cap after JSON number-array encoding. A resumed idle TUI whose latest lifecycle record is `turn_ended` SHALL be `done` rather than `working`. Title and model SHALL come from the sibling `summary.json` while the root is bound: the first document names the row even before a native turn, and a later rewrite updates that same row in place. A hanging or rotating summary watcher SHALL NOT stall or abort event replay.

Grok SHALL record each subagent at `<session>/subagents/<subagent_id>/meta.json` below the same sessions root, written when the child is spawned and rewritten in place as it runs. The extension SHALL follow that bounded, root-scoped directory while the root is bound, so children spawned after the root binds are admitted live.

A child SHALL be attached to the bound root only because its own `parent_session_id` equals that root's provider session id. A session elsewhere in the sessions tree SHALL NOT become a child, and timestamp, path proximity, and display text SHALL NOT establish the relationship.

Each child SHALL carry its own state from its own record: a `running` status SHALL keep that child `working` and a terminal status SHALL complete it with the corresponding outcome, so children spawned together complete independently. A child completing SHALL NOT complete its root, and the root SHALL remain `working` while any child is working. The child's `prompt` field and its sibling `output.json` are conversation content and SHALL never be read or projected; only the bounded `description` SHALL label the child.

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

- **WHEN** a child's `meta.json` appears under the bound root's `subagents/` directory declaring that root as its parent
- **THEN** a named child is admitted beneath that root and the root remains `working`

#### Scenario: Grok subagent progress and completion

- **WHEN** a child's record moves from `running` to a terminal status
- **THEN** that child is `working` and then completes with its outcome, and its root is unchanged

#### Scenario: Unrelated session in the sessions tree

- **WHEN** a candidate child declares a `parent_session_id` other than the bound root
- **THEN** it is not attached as a child

#### Scenario: Resuming a Grok journal in a new process

- **WHEN** a Grok session is quit, clearing the Agents pane, and the same writer-held journal is resumed in a new `grok --resume` process
- **THEN** the pane shows Grok again moving through working and done, with a live title update from `summary.json`

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

The first supported mapping SHALL be `(opencode, 0.1)` and SHALL accept later OpenCode versions until a divergent mapping is added. It SHALL follow the store's append-only `event` log, ordered by `aggregate_id` and `seq`, and SHALL map records as follows: a `session.created` or first `session.updated` for the bound root produces root `session.started` and `idle`; the session's `slug` seeds the root label and a non-empty `title` replaces it in place on the existing root without creating a second root or changing state; a message record whose role is `user` starts a turn as `working`; a tool part recorded `pending` is the state every tool part is first written in and SHALL NOT be treated as a permission wait (OpenCode persists no permission request in the store), its transition to `running` produces a `working` tool start keyed by the native `callID`, and `completed` or `error` finishes that tool with the corresponding outcome; a `task` tool part is a named child rather than an ordinary tool, starting and completing beneath the root without completing it; an assistant message carrying a completion produces `done` with its outcome; and unknown event types are ignored so additive OpenCode changes remain compatible.

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

- **WHEN** OpenCode records an assistant error that is not an abort and no completion follows for that turn
- **THEN** the entry is `blocked` and records that the state was inferred

#### Scenario: User aborts a turn

- **WHEN** OpenCode records an abort or cancellation error for a turn
- **THEN** the entry is `done` with a cancelled outcome and is not `blocked`

### Requirement: Grok waiting and completion outcomes

Grok records `permission_requested` and `permission_resolved` explicitly and
SHALL map them directly to `waiting` and back to `working`.

Grok records no fault distinct from a turn outcome: a failed turn is a
`turn_ended` carrying an error. That SHALL be `done` with an error outcome, and
Grok SHALL NOT produce `blocked`. No blocking state SHALL be synthesized from a
completion outcome, an unanswered permission request, or terminal output.

#### Scenario: Permission request

- **WHEN** Grok records `permission_requested` and later `permission_resolved`
- **THEN** the entry is `waiting` and then resumes `working`

#### Scenario: Failed turn

- **WHEN** Grok records a `turn_ended` carrying an error outcome
- **THEN** the entry is `done` with an error outcome and is not `blocked`

### Requirement: Deterministic root label before a provider title

Every bound root SHALL carry a label from the moment it is created. Until the provider records an explicit title, the label SHALL be the provider display name, or the provider's own deterministic pre-title identifier where it records one. An explicit provider title SHALL replace that label in place on the existing root and SHALL NOT create another root, replay lifecycle events, or change `working`, `waiting`, `blocked`, `done`, or child state.

#### Scenario: Root created before a title exists

- **WHEN** a root binds and the provider has recorded no explicit title
- **THEN** the entry carries the provider display name or the provider's deterministic pre-title identifier

#### Scenario: Explicit title arrives

- **WHEN** the provider later records an explicit title
- **THEN** the existing root's label is replaced in place and its state and lifecycle history are unchanged

### Requirement: Agents pane presentation

The **Agents** pane SHALL be the Agents sidebar group's collapsible pane. It SHALL show only roots whose exact activation terminal belongs to the current project and SHALL nest children beneath them. Rows SHALL use stable ordering and the existing tree geometry. Missing metadata SHALL be omitted and prompts SHALL be bounded. A generic terminal tab name SHALL NOT be used as the agent title: an untitled bound root SHALL use the provider label until a provider title, custom terminal name, or prompt is available. The provider label SHALL be the extension contribution `displayName`, and the Agents UI SHALL NOT keep a hardcoded map of provider ids.

#### Scenario: Root in another project

- **WHEN** a bound root's activation terminal belongs to a different project
- **THEN** it is not shown in the current project's Agents pane

#### Scenario: Untitled root

- **WHEN** a bound root has no provider title, custom terminal name, or prompt
- **THEN** it displays the provider's extension contribution `displayName` rather than a generic terminal tab name

### Requirement: Row activation

Activating a row SHALL activate its exact project and terminal panel, focus the terminal, and acknowledge that entry without changing operational state. No approximate terminal SHALL be focused when the binding is unavailable.

#### Scenario: Activating a bound row

- **WHEN** the user activates an agent row whose binding is available
- **THEN** its exact project and terminal panel activate, the terminal is focused, and the entry is acknowledged without changing its state

#### Scenario: Binding unavailable

- **WHEN** the row's terminal binding is unavailable
- **THEN** no approximate terminal is focused

### Requirement: Agent status setting

**Settings → AI → Agents → Agent status and sidebar** SHALL be persisted and enabled by default, SHALL control journal discovery and agent UI surfaces, and SHALL never install, edit, trust, or remove provider hooks or configuration. Disabling SHALL stop watchers, clear live bindings and the reduced snapshot, and prevent discovery. Re-enabling SHALL discover subsequently foregrounded providers and MAY rescan currently live ones, and SHALL NOT revive stale entries.

#### Scenario: Disabling the setting

- **WHEN** the setting is disabled
- **THEN** watchers stop, live bindings and the reduced snapshot clear, and discovery does not run

#### Scenario: Re-enabling the setting

- **WHEN** the setting is re-enabled
- **THEN** subsequently foregrounded providers are discovered and previously cleared stale entries are not revived

#### Scenario: Provider configuration

- **WHEN** agent status is enabled or disabled
- **THEN** no provider hook or configuration file is installed, edited, trusted, or removed

### Requirement: Independence from the Terminay MCP server

The agent status setting and observation pipeline SHALL be independent from the Terminay MCP server. MCP MAY register terminal-control tools with Codex, Claude Code, Cursor, Gemini, Grok, or OpenCode, but it SHALL NOT supply agent lifecycle events and SHALL NOT register omp. MCP installation and enablement SHALL NOT change journal discovery or sidebar status, and agent-status enablement SHALL NOT install or configure MCP. Observing `omp` or `grok` SHALL NOT require, install, or invoke MCP.

#### Scenario: MCP enablement changes

- **WHEN** the Terminay MCP server is installed, enabled, or disabled
- **THEN** journal discovery and sidebar status are unchanged

#### Scenario: Observing omp

- **WHEN** an omp session is observed
- **THEN** MCP is not required, installed, or invoked

### Requirement: Terminal tab and header status surfaces

Bound roots SHALL render the canonical RAG glyph on terminal tabs. The header SHALL aggregate unacknowledged meaningful entries, giving waiting and blocked priority, keeping done until acknowledged, and optionally showing working for navigation.

#### Scenario: Bound root on a tab

- **WHEN** a terminal has a bound agent root
- **THEN** its tab renders the canonical RAG glyph for that root's state

#### Scenario: Aggregating in the header

- **WHEN** several unacknowledged entries exist
- **THEN** waiting and blocked entries take priority in the header aggregate and done entries remain until acknowledged

### Requirement: Agent authority isolation between server instances

Every agent lifecycle entry SHALL belong to exactly one server authority. Two concurrent Terminay Server compositions — two isolated Desktop profiles, or two standalone servers — MAY use the same project display name, project id, terminal session id, provider session id, and extension package, and an entry admitted by one authority SHALL NOT appear in the other authority's snapshot or subscription. An extension host SHALL accept only a context minted by its own selected server runtime; a matching context value from another server or profile SHALL NOT publish, observe, cancel, or subscribe across that runtime.

#### Scenario: Identical identifiers in two profiles

- **WHEN** two isolated profiles open identically named projects with identical terminal and provider session ids and each admits an agent
- **THEN** each profile's Agents surface renders only its own lifecycle state

#### Scenario: Foreign context value

- **WHEN** an extension presents a context value minted by another server runtime or profile
- **THEN** it cannot publish, observe, cancel, or subscribe through the current runtime

### Requirement: Immutable scope fencing for agent operations

Publication, acknowledgement, replay, and observation resolution SHALL each require the exact server, project, terminal session, and terminal incarnation issued by the owning authority. Equal project names and reused terminal ids SHALL NOT substitute for a server-instance match. A stale shell foreground transition SHALL revoke the claim, the incarnation, its timers, and every context it owns before any of them can publish, and the extension child SHALL receive that cancellation.

#### Scenario: Reused terminal id

- **WHEN** an operation presents a terminal id that matches by value but belongs to another server instance
- **THEN** the operation is refused

#### Scenario: Foreground transition revokes a claim

- **WHEN** the shell's foreground process changes away from a bound provider
- **THEN** the claim, incarnation, timers, and owned contexts are revoked before any further publication and the extension child is cancelled

### Requirement: Bounded lifecycle publication flow control

Canonical lifecycle publication SHALL be flow-controlled per context. A publication batch SHALL be validated in full before the store is mutated, so an invalid transition leaves the store and the canonical sequence unchanged. Publications for one context SHALL be serialized, the queue depth and batch size SHALL be bounded, and an acknowledgement deadline SHALL expire a stalled publication and the work queued behind it. An overflowing context SHALL be rejected without a store call. A retried publication id SHALL be coalesced to one acknowledgement, and a retry that arrives after retirement SHALL reach neither the store nor an unrelated provider. Canonical revisions and sequences SHALL remain monotonic throughout.

#### Scenario: Invalid transition inside a batch

- **WHEN** a publication batch contains an invalid transition
- **THEN** the whole batch is rejected and neither the store nor the canonical sequence changes

#### Scenario: Queue overflow

- **WHEN** a context exceeds its bounded publication queue
- **THEN** the publication is rejected without a store call

#### Scenario: Stalled acknowledgement

- **WHEN** a publication is not acknowledged within its deadline
- **THEN** it and the publications queued behind it expire

#### Scenario: Late retry after retirement

- **WHEN** a retried publication arrives after its context is retired
- **THEN** it reaches neither the canonical store nor any unrelated provider

### Requirement: Provider callbacks are scoped to one terminal and one incarnation

An agent provider SHALL expose a foreground-match callback receiving bounded safe process metadata and an observation callback receiving a context for one exact terminal and one process incarnation. A foreground match SHALL only ask Terminay to start a bounded observation attempt and SHALL NOT itself establish session ownership. The observation callback SHALL bind a provider session only through evidence obtained from the context it was given.

#### Scenario: Foreground match

- **WHEN** a provider's foreground-match callback returns a match
- **THEN** Terminay starts a bounded observation attempt and the match alone does not prove session ownership

#### Scenario: Evidence from another terminal

- **WHEN** a provider binds a session using evidence not obtained from the issued terminal context
- **THEN** the binding is refused

### Requirement: Semantic lifecycle publisher

Canonical lifecycle events SHALL be published through named publisher methods for session start, turn start, tool start, wait start, completion, metadata change, subagent start, and subagent completion, rather than through one unrestricted emit call. The publisher SHALL validate required ids, value bounds, allowed states, and metadata before anything crosses IPC, and SHALL be bound to the validated provider session it was issued for.

#### Scenario: Invalid event rejected before IPC

- **WHEN** a provider publishes an event missing a required id, exceeding a bound, or naming a state that is not allowed
- **THEN** it is rejected at the publisher before crossing IPC

#### Scenario: Publisher session scope

- **WHEN** a provider publishes through a publisher issued for one validated provider session
- **THEN** the event is attributed to that session and cannot name another

### Requirement: Host-supplied ordering and timestamps

Terminay SHALL supply ordering and occurrence time when a provider has no reliable values. A provider MAY propose a timestamp, and a proposed timestamp SHALL NOT rewind the canonical stream.

#### Scenario: Provider proposes an earlier timestamp

- **WHEN** a provider proposes an occurrence time earlier than the canonical stream has already reached
- **THEN** the canonical stream does not rewind

#### Scenario: No reliable provider time

- **WHEN** a provider record carries no reliable time
- **THEN** Terminay supplies ordering and occurrence time

### Requirement: Metadata-only updates preserve lifecycle state

A metadata change publishing a title or model SHALL preserve working, waiting, done, and active-tool state and SHALL NOT synthesise a new session or a new turn.

#### Scenario: Title changes mid-turn

- **WHEN** a provider publishes a metadata change while a turn is working with an active tool
- **THEN** the title and model update and the working, waiting, done, and active-tool state are unchanged

#### Scenario: Metadata change is not a new session

- **WHEN** a provider publishes only a metadata change
- **THEN** no new session and no new turn are created

### Requirement: Subagents require stable native identity

A provider SHALL publish a child only when its native data supplies a stable child identity, and SHALL publish a child's completion only from matching authoritative evidence. Array index, title, prompt text, and timing SHALL NOT be used as child identity.

#### Scenario: Native child without a stable id

- **WHEN** a provider's native data supplies no stable identity for a child
- **THEN** no child is published

#### Scenario: Child completion evidence

- **WHEN** a provider publishes a child's completion
- **THEN** it does so from matching authoritative evidence rather than from position, title, prompt, or timing

### Requirement: Typed unavailable outcome for unsupported environments

When a terminal's project environment does not advertise an observation capability a provider requires, the provider SHALL return a typed unavailable outcome naming a safe reason, and SHALL NOT throw a raw SSH, filesystem, or provider error into the UI. Terminay SHALL keep generic terminal activity active for that terminal.

#### Scenario: Missing environment capability

- **WHEN** a required observation capability is absent from a terminal's environment
- **THEN** the provider returns a typed unavailable outcome with a safe reason

#### Scenario: Activity continues

- **WHEN** authoritative agent observation is unavailable for a terminal
- **THEN** generic terminal activity stays active for that terminal

### Requirement: Session identity comes only from provider evidence

A display title, current working directory, timestamp, or nearest filename SHALL NOT be a provider session identity. A provider SHALL bind a session from evidence its own native data makes authoritative, and Terminay SHALL validate that every handle that evidence references was issued by the terminal context performing the binding.

#### Scenario: Binding from a title or path

- **WHEN** a provider offers a title, working directory, timestamp, or nearest filename as session identity
- **THEN** the binding is not admitted

#### Scenario: Handle provenance checked

- **WHEN** a provider binds a session referencing file or process handles
- **THEN** Terminay validates each handle was issued by that terminal context
>>>>>>> origin/main
