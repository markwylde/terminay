## MODIFIED Requirements

### Requirement: Claude Code mapping

The `terminay-agent-claude-code` package SHALL own the Claude Code mapping under the same zero-injection boundary.

The Claude Code CLI writes one session file per interactive process at `.claude/sessions/<pid>.json` below the provider home, carrying at least `pid`, `sessionId`, `cwd`, and `startedAt` in epoch milliseconds; it rewrites the file when the process changes session or working directory and removes it when the process exits. That file SHALL be the sole binding rule. For each `claude` descendant of the registered PTY that reports a pid, the extension SHALL resolve `.claude/sessions/<pid>.json` beneath `.claude/sessions`, read it bounded, and accept it for binding only when its `pid` equals the process pid, its `cwd` equals the observed process working directory, its `sessionId` is a session UUID, and, where the environment reports a process start time, its `startedAt` lies within a bounded tolerance of that start. The extension SHALL read only `pid`, `sessionId`, `cwd`, `startedAt`, `version`, `status`, and `statusUpdatedAt` from that file, and SHALL NOT read the sibling `.key` file or any socket or name field.

The bound journal SHALL be the `<sessionId>.jsonl` that names the accepted session file's `sessionId` in its own first record. It SHALL be resolved below the provider-encoded project directory for that file's `cwd` under `.claude/projects` where it exists there, and otherwise by one bounded lookup for that exact filename below `.claude/projects`, because the CLI keeps a resumed conversation's journal under the directory the conversation originated in. Exactly one descendant with an accepted session file and a resolvable journal SHALL bind; zero or more than one SHALL bind nothing, and a lookup yielding more than one candidate or stopped by a host listing limit SHALL bind nothing. The extension SHALL NOT choose a root by creation time, modification time, append order, or proximity, SHALL NOT consult open writable handles, and SHALL NOT derive the session from a `--resume` or `--continue` argument; a resumed process's session file already names the resumed session.

While bound, the extension SHALL watch the process's session file and SHALL accept every rewrite of it whose `pid` and `startedAt` still agree with the observed process, whatever `cwd` it now reports: the bind-time cwd rule identifies the process the file was accepted for, and a later `cwd` is that same process reporting where it now is. When its `sessionId` changes, the current root SHALL be retired and the newly named journal bound in the same terminal under the renewable root binding rules. When its `cwd` changes for the same `sessionId`, the bound journal SHALL be resolved again for the new `cwd` by the same rule as at binding and followed from its start under the same root, because the CLI moves the journal, with its history, to the project directory for the new working directory. The mapping state SHALL be kept across that relocation, so the replayed history restarts no session, relabels nothing an `ai-title` has named, and re-opens no subagent already completed. A journal that cannot be resolved for the new `cwd` SHALL NOT stop the session file from being read. The file's `status` SHALL be authoritative for the root: when it is `idle`, at binding or later, an open turn SHALL close as cancelled and every subagent still open beneath the root SHALL complete as cancelled, and no record written at or before that `statusUpdatedAt` SHALL open a turn, tool, wait, or subagent, because the CLI's own word outranks a journal whose end was never written, journals are replayed in no fixed order, and a long replay must not paint finished turns as live. A root journal record of `[Request interrupted by user]` SHALL close the open turn as cancelled. A subagent journal ending on a `[Request interrupted by user]` record SHALL complete that subagent as cancelled. Journals below a root session's `subagents/` directory and unrelated history SHALL NOT be eligible roots.

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

- **WHEN** `claude --resume <uuid>` starts in a terminal while another terminal's `claude` is live in the same directory and appending to its own journal
- **THEN** the resumed terminal binds the journal its own session file names, which is the resumed UUID, and the other terminal's binding does not move

#### Scenario: Resume picker

- **WHEN** a `claude --resume` descendant with no session UUID on argv has a session selected
- **THEN** the restored root journal binds and appears in the Agents pane

#### Scenario: Continue most recent

- **WHEN** a `claude --continue` descendant of the registered PTY is observed
- **THEN** the most recently restored root journal for that process binds

#### Scenario: New Claude Code process

- **WHEN** a new `claude` process starts in a directory whose project directory already holds journals of other sessions, some of them live in other terminals
- **THEN** the terminal binds the journal named by that process's own session file and none of the others

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

- **WHEN** a session file offered for binding reports a `cwd` that differs from the observed process working directory, or its `sessionId` names a journal whose first record carries a different session id
- **THEN** it is rejected and nothing is bound

#### Scenario: Working directory changed while bound

- **WHEN** the bound process's session file comes to report a different `cwd` for the same `sessionId`, and the CLI has moved that session's journal, with its history, to the project directory for the new `cwd`
- **THEN** the file is still accepted, the journal is followed at its new location under the same root, records appended there after the move are projected, and a later `idle` in the file completes the root

#### Scenario: Working directory changed before the journal moved

- **WHEN** the bound process's session file comes to report a different `cwd` and no journal for its `sessionId` can yet be resolved for that `cwd`
- **THEN** the session file continues to move the root between working, waiting and done, and the journal is resolved again on the file's next change

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
