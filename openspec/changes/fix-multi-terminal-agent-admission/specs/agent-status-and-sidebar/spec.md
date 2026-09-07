## MODIFIED Requirements

### Requirement: Immutable scope fencing for agent operations

Publication, acknowledgement, replay, and observation resolution SHALL each require the exact server, project, terminal session, and terminal incarnation issued by the owning authority. Equal project names and reused terminal ids SHALL NOT substitute for a server-instance match. A stale shell foreground transition SHALL revoke the claim, the incarnation, its timers, and every context it owns before any of them can publish, and the extension child SHALL receive that cancellation.

The identifier the privileged host issues for a terminal observation context SHALL be derived from that full identity — server instance, project, terminal session, and incarnation together. Two contexts issued for different terminal sessions SHALL NOT share an identifier, whatever their incarnation counters hold. The identifier SHALL remain opaque to extensions and to clients.

#### Scenario: Reused terminal id

- **WHEN** an operation presents a terminal id that matches by value but belongs to another server instance
- **THEN** the operation is refused

#### Scenario: Foreground transition revokes a claim

- **WHEN** the shell's foreground process changes away from a bound provider
- **THEN** the claim, incarnation, timers, and owned contexts are revoked before any further publication and the extension child is cancelled

#### Scenario: Context identifiers for two terminal sessions

- **WHEN** two terminal sessions are each issued an observation context at the same incarnation
- **THEN** the two contexts carry different identifiers

### Requirement: Exact terminal identity binding

For an environment exposing proven native process observation, Terminay SHALL record the spawned shell PID for the immutable `serverId`/`projectId`/`projectEnvironmentId`/`sessionId` terminal identity. When a supported provider becomes the foreground process, that environment's privileged host SHALL obtain the provider's documented terminal identity evidence. Codex and Grok SHALL use an eligible writable journal below the exact PTY process tree, or Grok's pid-keyed `active_sessions.json` registry for that same process tree. OpenCode SHALL use its writable session store held by that same process tree. Claude Code SHALL use its pid-keyed session file below `.claude/sessions`, joined to the exact `claude` descendant of the PTY. omp SHALL use its terminal-scoped session association. A provider whose CLI holds no persistent writable handle on its own journal SHALL NOT depend on open-handle evidence as its only binding rule. Environments without the required evidence SHALL use the terminal-activity fallback.

Where a provider records which of its sessions a given OS process holds, that record SHALL be the binding evidence for that provider, and no rule that compares files to one another SHALL be consulted beside or beneath it.

#### Scenario: Codex journal below the PTY tree

- **WHEN** a writable Codex rollout is held by a process in the exact PTY process tree
- **THEN** that journal is admitted as the terminal's evidence

#### Scenario: Provider that closes its journal between writes

- **WHEN** a provider appends to its journal and closes it rather than holding it open
- **THEN** its binding rests on that provider's own documented association and not on open-handle evidence alone

#### Scenario: Provider records its own process-to-session mapping

- **WHEN** a provider writes a record naming the session held by an OS pid
- **THEN** the terminal binds through that record joined to its own PTY descendant, and no file-comparison rule is consulted

#### Scenario: Missing evidence

- **WHEN** the environment cannot supply the required identity evidence
- **THEN** the terminal uses terminal-activity fallback

### Requirement: Heuristics never establish binding

CWD, filename timestamps, terminal title, active tab, and closest-match logic SHALL NOT independently establish an authoritative binding. Claude Code SHALL NOT select among journals by creation time, modification time, or append order, whether as a primary rule, a tie-break, or a fallback; where its session file is absent or disagrees with the observed process, nothing SHALL be bound. OMP SHALL use its own terminal-scoped breadcrumb whose terminal ID derives from the PTY TTY running OMP and whose target is validated under OMP's allowed session root. A host that cannot establish provider proof SHALL use terminal fallback.

#### Scenario: Nearest-timestamp candidate

- **WHEN** a candidate journal matches only by timestamp, filename, terminal title, or proximity
- **THEN** it is not admitted as an authoritative binding

#### Scenario: Most recently appended journal in a shared directory

- **WHEN** a Claude Code project directory holds several journals and one of them was appended more recently than the journal the observed process reports
- **THEN** the process's own reported journal is bound and the more recently appended one is not

### Requirement: Claude Code mapping

The `terminay-agent-claude-code` package SHALL own the Claude Code mapping under the same zero-injection boundary.

The Claude Code CLI writes one session file per interactive process at `.claude/sessions/<pid>.json` below the provider home, carrying at least `pid`, `sessionId`, `cwd`, and `startedAt` in epoch milliseconds; it rewrites the file when the process changes session and removes it when the process exits. That file SHALL be the sole binding rule. For each `claude` descendant of the registered PTY that reports a pid, the extension SHALL resolve `.claude/sessions/<pid>.json` beneath `.claude/sessions`, read it bounded, and accept it only when its `pid` equals the process pid, its `cwd` equals the observed process working directory, its `sessionId` is a session UUID, and, where the environment reports a process start time, its `startedAt` lies within a bounded tolerance of that start. The extension SHALL read only `pid`, `sessionId`, `cwd`, `startedAt`, `version`, `status`, and `statusUpdatedAt` from that file, and SHALL NOT read the sibling `.key` file or any socket or name field.

The bound journal SHALL be `<sessionId>.jsonl` below the provider-encoded project directory for the file's `cwd`, under `.claude/projects`, and its first record SHALL carry the same `sessionId`. Exactly one descendant with an accepted session file and a resolvable journal SHALL bind; zero or more than one SHALL bind nothing. The extension SHALL NOT list the project directory to choose a root, SHALL NOT consult open writable handles, and SHALL NOT derive the session from a `--resume` or `--continue` argument; a resumed process's session file already names the resumed session.

While bound, the extension SHALL watch the process's session file. When its `sessionId` changes, the current root SHALL be retired and the newly named journal bound in the same terminal under the renewable root binding rules. The file's `status` SHALL be authoritative for the root: when it is `idle`, at binding or later, an open turn SHALL close as cancelled and every subagent still open beneath the root SHALL complete as cancelled, and no record written at or before that `statusUpdatedAt` SHALL open a turn, tool, wait, or subagent, because the CLI's own word outranks a journal whose end was never written, journals are replayed in no fixed order, and a long replay must not paint finished turns as live. A root journal record of `[Request interrupted by user]` SHALL close the open turn as cancelled. A subagent journal ending on a `[Request interrupted by user]` record SHALL complete that subagent as cancelled. Journals below a root session's `subagents/` directory and unrelated history SHALL NOT be eligible roots.

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

#### Scenario: New Claude Code process

- **WHEN** a new `claude` process starts in a directory whose project directory already holds journals of other sessions, some of them live in other terminals
- **THEN** the terminal binds the journal named by that process's own session file and none of the others

#### Scenario: Resumed Claude Code session

- **WHEN** `claude --resume <uuid>` starts in a terminal while another terminal's `claude` is live in the same directory and appending to its own journal
- **THEN** the resumed terminal binds the journal its own session file names, which is the resumed UUID, and the other terminal's binding does not move

#### Scenario: CLI holds no writable handle

- **WHEN** a running `claude` process holds no open writable handle on its root journal
- **THEN** its session file still binds the session, and open handles are not consulted

#### Scenario: One process, several conversations

- **WHEN** one `claude` process has written several root journals over its lifetime
- **THEN** only the journal its session file currently names is bound

#### Scenario: Session file not yet written

- **WHEN** a `claude` descendant is observed before its session file exists
- **THEN** nothing is bound and discovery keeps retrying under the bounded discovery window until the file appears or the process leaves the foreground

#### Scenario: Session file left by a dead process

- **WHEN** the session file for a pid reports a `startedAt` outside the tolerance of the observed process's start time
- **THEN** it is rejected and nothing is bound

#### Scenario: Session file disagrees with the process

- **WHEN** the session file's `cwd` differs from the observed process working directory, or its `sessionId` names a journal whose first record carries a different session id
- **THEN** it is rejected and nothing is bound

#### Scenario: Journal older than the process

- **WHEN** the journal named by the session file was created before the observed process started
- **THEN** it is bound, because the file, not the journal's age, is the evidence

#### Scenario: Conversation switched

- **WHEN** the bound process's session file comes to name a different `sessionId`
- **THEN** the previous root is retired and the newly named journal is bound in the same terminal

#### Scenario: Subagent stopped before it finished

- **WHEN** a subagent's journal ends on a `[Request interrupted by user]` record with no completion after it
- **THEN** that subagent completes as cancelled and does not hold the root `working`

#### Scenario: Session file reports idle with a subagent open

- **WHEN** the bound process's session file comes to report `status: "idle"` while a subagent beneath the root is still open
- **THEN** that subagent completes as cancelled

#### Scenario: CLI reports idle while its journal replays

- **WHEN** a terminal binds a session whose file reports `status: "idle"` and whose journal holds completed turns before that mark
- **THEN** the root is shown idle with its title from the moment it binds, and no historical turn is replayed as live

#### Scenario: Root turn stopped by the user

- **WHEN** the root journal records `[Request interrupted by user]` while a turn is open and no `turn_duration` follows
- **THEN** the turn closes as cancelled

#### Scenario: Session file already idle when the terminal binds

- **WHEN** the session file reports `status: "idle"` at binding and a subagent's launch and journal records all predate its `statusUpdatedAt`
- **THEN** that subagent is not shown as working, whatever order the journals replay in

#### Scenario: Two claude descendants with valid session files

- **WHEN** more than one `claude` descendant of one PTY carries an accepted session file
- **THEN** nothing is bound

#### Scenario: Subagent journal offered as root

- **WHEN** a `subagents/` journal or unrelated history file is a candidate
- **THEN** it is not eligible as a root

#### Scenario: Named child

- **WHEN** an `Agent` tool use records a subagent launch
- **THEN** a named child entry starts beneath the root at that launch and completes on its own journal's completion or the parent's task notification for that `agentId`

## ADDED Requirements

### Requirement: Concurrent agent terminals

Terminay SHALL observe every terminal running a provider's CLI, not only the first. Where several terminals of one project each run the same provider, each SHALL be admitted, SHALL bind its own provider session, and SHALL hold its own root entry in the Agents pane with its own state, acknowledgement, and lifetime. One terminal's root SHALL NOT be displaced, retired, or restated by another terminal's admission, and closing or quitting one SHALL leave the others bound.

A terminal SHALL NOT be refused admission because another terminal is already observed. Admission refusal SHALL be reserved for a context whose own identity is already admitted — a repeat of the same terminal at the same incarnation — and SHALL NOT be reachable through two distinct terminals.

#### Scenario: Two terminals run one provider

- **WHEN** two terminals in a project each run the same provider's CLI
- **THEN** both are admitted and the Agents pane shows a root for each

#### Scenario: Terminals of different providers

- **WHEN** terminals in a project run different providers' CLIs concurrently
- **THEN** each terminal is admitted by its own provider and holds its own root

#### Scenario: One of several terminals quits

- **WHEN** one of several concurrently observed terminals quits its CLI
- **THEN** that terminal's root becomes inactive and every other terminal stays bound with its state unchanged

#### Scenario: Admission refused for an already-admitted context

- **WHEN** admission is attempted for a context identity that is already admitted
- **THEN** it is refused, and that refusal is not reachable from two distinct terminal sessions
