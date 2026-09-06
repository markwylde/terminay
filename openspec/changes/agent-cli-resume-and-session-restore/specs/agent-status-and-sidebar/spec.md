## ADDED Requirements

### Requirement: Documented CLI restore commands bind

Every bundled agent CLI that documents a resume, continue, or session-restore
command SHALL bind the restored session to the exact terminal it was restored
in, using that provider's own association, once the CLI is the foreground
process of that terminal.

The documented restore commands, taken from each CLI's own help, SHALL include
at least:

- Claude Code: `--continue` / `-c`; `--resume` / `-r` with a session UUID; `--resume` / `-r` with no value (the session picker).
- Codex: `resume` (picker); `resume --last`; `resume` with a session id.
- Grok: `--continue` / `-c`; `--resume` / `-r` with a session id or title; `--resume` / `-r` with no value.
- OpenCode: `--continue` / `-c`; `--session` with a session id.
- omp: `--continue` / `-c`; `--resume` with an id prefix or path; `--resume` with no value (picker).

An explicit session identity on argv SHALL bind that session. A last-session
shortcut (`--continue`, `resume --last`, omitted `--resume` that the CLI treats
as most-recent) SHALL bind the session the CLI actually restored. A picker
SHALL bind nothing until the user selects a session, and SHALL then bind the
session the CLI restored, even when argv still carries no UUID.

A restored session SHALL appear as the same root when it was already known,
SHALL NOT replay earlier transitions as new activity, and SHALL be `done` when
its last recorded lifecycle fact is a completion. Further work SHALL move that
same root through its states. A provider whose CLI holds no persistent writable
handle on the restored journal SHALL still bind it through that provider's
documented association.

#### Scenario: Resume picker with no UUID on argv

- **WHEN** the user runs the CLI's session picker (`claude --resume`, `codex resume`, `omp --resume`, or Grok `--resume` with no value) and selects a session
- **THEN** that session binds to the terminal and appears in the Agents pane even though argv carries no session UUID

#### Scenario: Last-session shortcut

- **WHEN** the user runs `--continue`, `codex resume --last`, or OpenCode `--continue` in a terminal
- **THEN** the restored session binds to that terminal

#### Scenario: Explicit session id

- **WHEN** the user resumes with an explicit session id the CLI accepts
- **THEN** that session binds and no other session is chosen in its place

#### Scenario: Picker still open

- **WHEN** a restore picker is on screen and no session has been selected
- **THEN** no agent root is created for a guessed session

#### Scenario: Codex resume without a writable handle

- **WHEN** `codex resume --last` restores a session whose process holds no open writable rollout
- **THEN** the session still binds through Codex's documented association

## MODIFIED Requirements

### Requirement: Exact terminal identity binding

For an environment exposing proven native process observation, Terminay SHALL record the spawned shell PID for the immutable `serverId`/`projectId`/`projectEnvironmentId`/`sessionId` terminal identity. When a supported provider becomes the foreground process, that environment's privileged host SHALL obtain the provider's documented terminal identity evidence. Codex and Grok SHALL use an eligible writable journal below the exact PTY process tree, or Grok's pid-keyed `active_sessions.json` registry for that same process tree. OpenCode SHALL use its writable session store held by that same process tree. Claude Code and omp SHALL use their provider-specific terminal or session association. A provider whose CLI holds no persistent writable handle on its own journal SHALL NOT depend on open-handle evidence as its only binding rule. That same rule SHALL apply to a restored session: a resume, continue, or picker command SHALL NOT be refused solely because the restored journal is not held open. Environments without the required evidence SHALL use the terminal-activity fallback.

#### Scenario: Codex journal below the PTY tree

- **WHEN** a writable Codex rollout is held by a process in the exact PTY process tree
- **THEN** that journal is admitted as the terminal's evidence

#### Scenario: Provider that closes its journal between writes

- **WHEN** a provider appends to its journal and closes it rather than holding it open
- **THEN** its binding rests on that provider's own documented association and not on open-handle evidence alone

#### Scenario: Restored session that closes its journal between writes

- **WHEN** a resume or continue command restores a session and the CLI does not hold that journal open
- **THEN** the restored session still binds through that provider's documented association

#### Scenario: Missing evidence

- **WHEN** the environment cannot supply the required identity evidence
- **THEN** the terminal uses terminal-activity fallback

### Requirement: Claude Code mapping

The `terminay-agent-claude-code` package SHALL own the Claude Code mapping under the same zero-injection boundary. It SHALL bind an exact `claude --resume <uuid>` descendant to that UUID's root JSONL below the project directory in `~/.claude/projects`. It SHALL also bind `claude --continue` and `claude --resume` with no value once the CLI has restored a session, using the root journal that process appends after it started, without requiring a UUID on argv and without requiring an open writable handle.

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

#### Scenario: Resume picker

- **WHEN** a `claude --resume` descendant with no session UUID on argv has a session selected
- **THEN** the restored root journal binds and appears in the Agents pane

#### Scenario: Continue most recent

- **WHEN** a `claude --continue` descendant of the registered PTY is observed
- **THEN** the most recently restored root journal for that process binds

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

### Requirement: Codex session roots and home resolution

Codex sessions SHALL live below the effective `CODEX_HOME/sessions` root, and the host account's `.codex/sessions` root SHALL be used when `CODEX_HOME` is unset. Shell snapshots SHALL NOT be lifecycle sources. A rollout SHALL be eligible as the terminal's root only when its initial `session_meta` identifies `originator: codex-tui` and `source: cli`. Provider-native subagent sources SHALL remain in-process children of that root and SHALL NOT compete with root rollouts during process-bound discovery. When one writer holds multiple eligible root rollouts, the most recently modified eligible root SHALL be selected. A `codex resume`, `codex resume --last`, or `codex resume <id>` process SHALL bind the restored root even when it holds no open writable descriptor on that rollout, using Codex's documented association rather than open-handle evidence alone. The `terminay-agent-codex` package SHALL own every Codex executable name, home-root rule, process and journal binding rule, mapping version, fixture, and compatibility test.

#### Scenario: Rollout with a non-CLI originator

- **WHEN** a Codex rollout's `session_meta` does not identify `originator: codex-tui` and `source: cli`
- **THEN** it is not eligible as the terminal's root

#### Scenario: Multiple eligible rollouts

- **WHEN** one writer holds several eligible root rollouts after a resume or branch
- **THEN** the most recently modified eligible root is selected

#### Scenario: Different rollout opened while Codex stays foreground

- **WHEN** the bound process tree opens a different eligible root rollout
- **THEN** the tail switches, the previous root is retired, and the fresh or resumed session is replayed

#### Scenario: Resume last without a writable handle

- **WHEN** `codex resume --last` is the foreground process and holds no open writable rollout
- **THEN** the restored CLI root still binds
