## ADDED Requirements

### Requirement: Typed unavailable outcome when a provider cannot observe

When a provider cannot obtain the evidence it requires for a terminal, it SHALL return a typed unavailable outcome naming a safe reason, and SHALL NOT throw a raw filesystem or provider error into the UI. Terminay SHALL keep generic terminal activity active for that terminal.

#### Scenario: Provider cannot obtain its evidence

- **WHEN** a provider cannot obtain the observation evidence it requires for a terminal
- **THEN** the provider returns a typed unavailable outcome with a safe reason

#### Scenario: Activity continues

- **WHEN** authoritative agent observation is unavailable for a terminal
- **THEN** generic terminal activity stays active for that terminal

## MODIFIED Requirements

### Requirement: Server-owned authorization and client subscription

Terminal and project authorization, canonical validation, ordering, snapshots, acknowledgement, and terminal/project mapping SHALL live in Terminay Server. Provider-specific discovery, process binding, incremental reading, version selection, and native-record normalization SHALL live in separately hosted extensions using only the public Extension API. Connected clients SHALL subscribe to the same ordered reduced snapshot and SHALL NOT read provider journals or create competing agent state.

#### Scenario: Client rendering agent state

- **WHEN** a client displays agent status
- **THEN** it renders the server's ordered reduced snapshot and reads no provider journal

#### Scenario: Extension observing a provider

- **WHEN** an extension observes a provider
- **THEN** it uses only the public Extension API and does not perform terminal or project authorization

### Requirement: Agent extension observation environment

Foreground-process and journal discovery SHALL be observation the server provides for every terminal. Agent extensions SHALL be ordinary trusted Node.js programs that combine the host-issued terminal context including the PTY shell PID with Node process and filesystem APIs through the public observation helpers. Those helpers run in the extension child, SHALL NOT be described as a sandbox, and SHALL NOT round-trip local process-listing snapshots through host IPC. The child SHALL inherit a bounded host environment covering `PATH`, `HOME`, and locale so the same process-inspection binaries still resolve, and installer-style sterile `NODE_OPTIONS` SHALL NOT be applied to agent observation.

#### Scenario: Observing on the server host

- **WHEN** an agent extension observes a terminal
- **THEN** it inspects processes and files in its own child using the host-issued terminal context, without routing those snapshots through host IPC

#### Scenario: Child environment

- **WHEN** the extension child is spawned for agent observation
- **THEN** it inherits a bounded `PATH`, `HOME`, and locale and is not given sterile `NODE_OPTIONS`

### Requirement: Exact terminal identity binding

Terminay SHALL record the spawned shell PID for the immutable `serverId`/`projectId`/`sessionId` terminal identity. When a supported provider becomes the foreground process, the server's privileged host SHALL obtain the provider's documented terminal identity evidence. Codex and Grok SHALL use an eligible writable journal below the exact PTY process tree, or Grok's pid-keyed `active_sessions.json` registry for that same process tree. OpenCode SHALL use its writable session store held by that same process tree together with the `opencode` process's own command line, whose `--session <id>` names the root exactly and whose `--continue` is the CLI's own newest-in-directory rule; with neither proven and no row created after the process started, it SHALL bind nothing. Claude Code SHALL use its pid-keyed session file below `.claude/sessions`, joined to the exact `claude` descendant of the PTY. omp SHALL use its terminal-scoped session association. A provider whose CLI holds no persistent writable handle on its own journal SHALL NOT depend on open-handle evidence as its only binding rule. That same rule SHALL apply to a restored session: a resume, continue, or picker command SHALL NOT be refused solely because the restored journal is not held open. A session without the required evidence SHALL use the terminal-activity fallback.

Where a provider records which of its sessions a given OS process holds, that record SHALL be the binding evidence for that provider, and no rule that compares files to one another SHALL be consulted beside or beneath it.

#### Scenario: Codex journal below the PTY tree

- **WHEN** a writable Codex rollout is held by a process in the exact PTY process tree
- **THEN** that journal is admitted as the terminal's evidence

#### Scenario: Provider that closes its journal between writes

- **WHEN** a provider appends to its journal and closes it rather than holding it open
- **THEN** its binding rests on that provider's own documented association and not on open-handle evidence alone

#### Scenario: Restored session that closes its journal between writes

- **WHEN** a resume or continue command restores a session and the CLI does not hold that journal open
- **THEN** the restored session still binds through that provider's documented association

#### Scenario: Provider records its own process-to-session mapping

- **WHEN** a provider writes a record naming the session held by an OS pid
- **THEN** the terminal binds through that record joined to its own PTY descendant, and no file-comparison rule is consulted

#### Scenario: Missing evidence

- **WHEN** the required identity evidence cannot be obtained for a session
- **THEN** the terminal uses terminal-activity fallback

## REMOVED Requirements

### Requirement: Non-local environments use the observation broker

**Reason:** Project environments are removed; every terminal runs on the server that owns it, so there is no non-local process tree to reach.

**Migration:** None; there are no installed users. Reaching another machine means running a Terminay Server on it and connecting to it.

### Requirement: Typed unavailable outcome for unsupported environments

**Reason:** Project environments are removed, so a provider is never short of an environment capability. Replaced by "Typed unavailable outcome when a provider cannot observe".

**Migration:** None; there are no installed users.
