# terminal-activity-signals Specification

## Purpose

Terminal activity signals describe activity in any terminal — shells, builds, and agents without authoritative journals — by parsing structured terminal escape sequences, foreground-process evidence, and raw output on the server, without competing with journal-backed canonical agent status.

## Requirements

### Requirement: Two distinct activity systems

Agent status SHALL describe the lifecycle of a recognized AI agent, with a process-bound provider journal as its authoritative source. Terminal activity SHALL describe activity in any terminal, including shells, builds, and agents for which authoritative journals are unavailable. Terminal escape sequences and raw PTY output are fallback evidence and SHALL never overwrite, synthesize transitions for, or otherwise compete with an authoritative journal-backed agent entry.

#### Scenario: Fallback evidence on a journal-backed agent

- **WHEN** a terminal with an authoritative journal-backed agent entry emits escape sequences or raw output
- **THEN** that evidence does not overwrite or synthesize a transition for the agent entry

#### Scenario: Terminal with no journal

- **WHEN** a shell or build tool runs in a terminal with no journal-backed agent entry
- **THEN** terminal activity describes it from structured signals and raw output

### Requirement: Environment-scoped signal sources

PTY-byte signals SHALL work at the server-owned terminal stream boundary for Local, SSH, and Puzed-backed sessions. Native foreground-process and journal signals SHALL be used only when the exact project environment advertises and proves those capabilities. The Terminay Server's local SSH client process SHALL never be treated as the remote terminal's foreground process.

#### Scenario: SSH-backed session

- **WHEN** a session runs through an SSH-backed environment
- **THEN** PTY-byte signals are parsed at the server-owned stream boundary
- **AND** the local SSH client process is not reported as that terminal's foreground process

#### Scenario: Environment without proven native capability

- **WHEN** an environment does not advertise and prove native foreground-process or journal capability
- **THEN** those signals are not used for that session

### Requirement: Authority and fallback order

For a terminal session Terminay SHALL use the first available source in order: process-bound provider journals for a recognized Codex session, which produce canonical agent events and are the sole source of that agent's operational state; structured terminal signals (`OSC 9;4` progress, `OSC 133`/`633` shell command markers, notifications, `BEL`, and foreground-process changes) when no journal-backed agent entry exists; and recent raw output only when neither an authoritative agent entry nor a claimed structured-signal interpreter is available.

#### Scenario: Journal available

- **WHEN** a process-bound provider journal exists for a recognized session
- **THEN** its canonical agent events are the sole source of that agent's operational state

#### Scenario: No journal but structured signals present

- **WHEN** no journal-backed agent entry exists and structured terminal signals are present
- **THEN** the structured signals determine fallback activity

#### Scenario: Neither journal nor interpreter

- **WHEN** neither an authoritative agent entry nor a claimed structured-signal interpreter is available
- **THEN** recent raw output determines fallback activity

### Requirement: Session-scoped authority

Authority SHALL be scoped by the exact Terminay terminal session ID. A journal-backed agent in one terminal SHALL NOT suppress fallback activity detection in another terminal.

#### Scenario: Agent in one terminal, shell in another

- **WHEN** one terminal has a journal-backed agent and another runs an ordinary shell
- **THEN** each uses its own source independently

### Requirement: Rendering alongside authoritative state

Once a terminal has an authoritative agent entry, spinner frames, status-bar repaints, terminal bells, and notification escape sequences SHALL still render normally but SHALL NOT change the agent's canonical state. The terminal-activity UI MAY omit a duplicate fallback item for that session. Fallback state SHALL NOT be presented as provider-authoritative agent status.

#### Scenario: Bell on a journal-backed agent terminal

- **WHEN** a terminal with an authoritative agent entry rings a bell
- **THEN** the bell renders normally and the agent's canonical state is unchanged

#### Scenario: Duplicate fallback item

- **WHEN** a session already has an authoritative agent entry
- **THEN** the terminal-activity UI may omit a duplicate fallback item for it

### Requirement: OSC parsing and terminators

An `OSC` sequence starts with `ESC ]` and is terminated by `BEL` or `ST` (`ESC \`). The parser SHALL accept both terminators and SHALL handle sequences split across PTY chunks.

#### Scenario: Sequence split across chunks

- **WHEN** an OSC sequence is split across two PTY chunks
- **THEN** the parser reassembles and interprets it correctly

#### Scenario: Either terminator

- **WHEN** an OSC sequence ends with `BEL` or with `ST`
- **THEN** the parser accepts both terminators

### Requirement: OSC 9;4 progress signal

`ESC ] 9 ; 4 ; <state> [ ; <progress> ] BEL/ST` SHALL always be parsed as progress and never as an `OSC 9` notification. State `0` ends working; states `1` (normal progress, optionally `0`–`100`), `2` (error progress), `3` (indeterminate), and `4` (paused or warning) mean working. An active progress signal SHALL expire after the configured progress-signal timeout, 15 seconds by default, if it is not refreshed, and SHALL be cleared when the PTY exits.

#### Scenario: Indeterminate then removed

- **WHEN** a terminal emits `OSC 9;4;3` and later `OSC 9;4;0`
- **THEN** fallback activity is working and then finished

#### Scenario: Stale progress

- **WHEN** an active progress signal is not refreshed within the configured progress-signal timeout
- **THEN** it expires and no longer pins fallback activity in the working state

#### Scenario: PTY exit with active progress

- **WHEN** the PTY exits while a progress signal is active
- **THEN** the progress signal is cleared

#### Scenario: OSC 9;4 is never a notification

- **WHEN** a terminal emits `OSC 9;4;...`
- **THEN** it is interpreted as progress and not as an `OSC 9` notification

### Requirement: OSC 133 and OSC 633 command tracking

`ESC ] 133 ; A ST` marks prompt start, `; B` command-line editing, `; C` command executing, and `; D [; exit] ST` command finished. `OSC 633` subcommands `A`, `B`, `C`, and `D` SHALL be aliases and other `633` subcommands SHALL be ignored. `C` without a later `D` or `A` means working; `D` ends working and MAY include an exit code. A `D` immediately after `B` without a `C` SHALL be treated as an aborted command and its exit code SHALL be ignored. Exit codes SHALL be retained for control APIs but SHALL NOT add a separate failed colour to terminal tabs.

#### Scenario: Command executes and finishes

- **WHEN** a terminal emits `OSC 133;C` and later `OSC 133;D;0`
- **THEN** fallback activity is working and then finished, and exit code `0` is captured

#### Scenario: Aborted command

- **WHEN** `OSC 133;D` arrives immediately after `OSC 133;B` with no `C`
- **THEN** the command is treated as aborted and its exit code is ignored

#### Scenario: Unknown 633 subcommand

- **WHEN** a terminal emits an `OSC 633` subcommand other than `A`, `B`, `C`, or `D`
- **THEN** it is ignored

#### Scenario: Failed exit code

- **WHEN** a tracked command finishes with a non-zero exit code
- **THEN** the exit code is available to control APIs and no separate failed colour is added to the terminal tab

### Requirement: Notifications and bell

The fallback parser SHALL recognize terminal `BEL`, `OSC 9;<message>` excluding `OSC 9;4`, and `OSC 777;notify;<title>;<body>`. When no authoritative agent entry exists, these MAY set terminal attention for an unfocused terminal, and attention SHALL remain pending until that terminal is viewed or receives user input. For a journal-backed agent, provider events SHALL determine `waiting` and `blocked`; a bell or OSC notification SHALL NOT be an authoritative agent transition.

#### Scenario: Bell on an unfocused non-authoritative terminal

- **WHEN** an unfocused terminal with no authoritative agent entry rings a bell
- **THEN** sticky fallback attention is set until the terminal is viewed or receives user input

#### Scenario: OSC 777 notification

- **WHEN** a terminal emits `OSC 777;notify;<title>;<body>`
- **THEN** the fallback parser recognizes it as a notification

### Requirement: Foreground-process evidence

The PTY host MAY report whether the foreground process differs from the spawned shell. This SHALL be weak evidence for working, useful for silent commands, and MAY help select a terminal-signal interpreter. A process name alone SHALL NOT create an authoritative agent entry or infer a canonical provider state.

#### Scenario: Silent command running

- **WHEN** a non-shell foreground process runs without producing output
- **THEN** foreground-process evidence indicates working

#### Scenario: Recognized process name

- **WHEN** the foreground process name matches a known agent
- **THEN** no authoritative agent entry is created and no canonical provider state is inferred from the name

### Requirement: Provider process retirement window

For an existing journal-backed Codex session, a recognized provider process returning to the known shell MAY retire the live association after a short confirmation window. A journal event during that window SHALL cancel the retirement.

#### Scenario: Provider process exits

- **WHEN** a recognized provider process returns to the known shell for a journal-backed session
- **THEN** the live association is retired after a short confirmation window

#### Scenario: Journal event during the window

- **WHEN** a journal event arrives during the confirmation window
- **THEN** the retirement is cancelled

### Requirement: foregroundBusy in the activity snapshot

The canonical activity snapshot SHALL expose a `foregroundBusy` boolean that is true only while the PTY host reports that a process other than the spawned shell owns the foreground process group. Unlike the presentation-oriented `working` status, `foregroundBusy` SHALL NOT be suppressed by provider authority, command completion signals, acknowledgement, output timers, or activity-indicator settings. Clients SHALL use it solely for destructive close protection and SHALL NOT infer it from output.

#### Scenario: Non-shell process owns the foreground group

- **WHEN** the PTY host reports a process other than the spawned shell owning the foreground process group
- **THEN** `foregroundBusy` is true regardless of provider authority, completion signals, acknowledgement, output timers, or indicator settings

#### Scenario: Client use of foregroundBusy

- **WHEN** a client evaluates destructive close protection
- **THEN** it uses `foregroundBusy` and does not infer it from terminal output

### Requirement: Foreground observation availability

The activity snapshot SHALL identify foreground observation as `available` or `limited`. `limited` SHALL mean the exact environment cannot provide a current safe foreground answer and SHALL NOT mean that the terminal is idle.

#### Scenario: Environment cannot answer

- **WHEN** the exact environment cannot provide a current safe foreground answer
- **THEN** the snapshot reports `limited` and this is not treated as idle

### Requirement: Session-owned bounded foreground observation

Foreground-process observation SHALL be exact-session, bounded derived state. Each session SHALL own its observation work with at most one sample executing and one latest requested sample pending. Continued output SHALL replace obsolete pending work and SHALL NOT require a terminal to become silent before the current state can settle. A slow, unavailable, or capability-limited observation SHALL be an explicit limited state for that session and SHALL NOT delay activity, commands, workspace mutations, or close protection for another session. Activity snapshots SHALL return the latest committed projection and SHALL NOT wait for live host observation.

#### Scenario: Continuously outputting terminal

- **WHEN** a terminal produces continuous output
- **THEN** obsolete pending observation work is replaced and the current state settles without requiring silence

#### Scenario: Slow observation on one session

- **WHEN** foreground observation is slow or unavailable for one session
- **THEN** it becomes an explicit limited state for that session and does not delay another session's activity, commands, workspace mutations, or close protection

#### Scenario: Snapshot read

- **WHEN** a client reads an activity snapshot
- **THEN** it receives the latest committed projection without waiting for live host observation

### Requirement: Destructive close protection

Destructive close protection SHALL obtain a bounded fresh observation only for its addressed session. If that sample cannot complete it SHALL report the limited state. Close protection SHALL warn only when a non-shell foreground process is known to be running; limited observation without that evidence SHALL NOT prompt and SHALL NOT wait. Helper children of a non-shell foreground process SHALL NOT make the session look idle.

#### Scenario: Known busy terminal closed

- **WHEN** a user closes a terminal whose non-shell foreground process is known to be running
- **THEN** close protection warns

#### Scenario: Limited observation on close

- **WHEN** the bounded fresh observation for the addressed session cannot complete
- **THEN** the limited state is reported, no prompt is shown, and the close does not wait

#### Scenario: Helper child processes

- **WHEN** a non-shell foreground process has helper children
- **THEN** the session is not reported as idle

### Requirement: Fallback interpreter profiles

Fallback interpretation SHALL remain provider-aware only to avoid known false positives and SHALL NOT be the canonical agent-driver layer. The generic interpreter SHALL prioritize active progress, then an executing shell command, then foreground-process evidence, then raw output. The legacy Claude Code interpreter SHALL treat `OSC 9;4` as a turn boundary and ignore cosmetic output after progress clears. The legacy Codex interpreter SHALL treat a notification as a turn boundary and ignore spinner output after the boundary. These profiles SHALL apply only when the session has no authoritative journal-backed agent entry.

#### Scenario: Generic interpreter precedence

- **WHEN** the generic interpreter evaluates a session
- **THEN** it prioritizes active progress, then an executing shell command, then foreground-process evidence, then raw output

#### Scenario: Profile on a journal-backed session

- **WHEN** a session has an authoritative journal-backed agent entry
- **THEN** no interpreter profile applies to it

#### Scenario: Trailing cosmetic output

- **WHEN** progress clears and cosmetic output continues under the Claude Code interpreter
- **THEN** the turn boundary stands and working does not restart

### Requirement: Interpreter claim disables the raw-output timer

An interpreter that claims a session SHALL disable the raw-output timer for that session, preventing continuously repainting TUIs from oscillating between working and finished.

#### Scenario: Repainting TUI

- **WHEN** an interpreter has claimed a session and the TUI repaints continuously
- **THEN** the raw-output timer is disabled and the session does not oscillate between working and finished

### Requirement: Fallback activity display language

Terminal fallback activity SHALL use the existing tab-activity language: amber or yellow for working or recent activity, green for finished unviewed activity, red for fallback attention, and no indicator after acknowledgement. Canonical agent RAG indicators SHALL use the same broad colour vocabulary but SHALL remain a different model, in which an agent's operational state and its acknowledgement flag are orthogonal and viewing an agent acknowledges it without changing `working`, `waiting`, `blocked`, `done`, or `idle`.

#### Scenario: Working fallback activity

- **WHEN** a terminal has fallback working or recent activity
- **THEN** its tab shows the amber or yellow indicator

#### Scenario: Viewing an agent

- **WHEN** a user views a terminal with a canonical agent entry
- **THEN** the agent is acknowledged and its operational state is unchanged

### Requirement: Fallback acknowledgement

For terminal fallback activity, viewing the terminal or typing into it SHALL clear the pending terminal indicator. Selecting a terminal through the Dockview tab lifecycle SHALL report the same server-owned acknowledgement as programmatic focus; focus styling alone SHALL NOT leave fallback shell noise counted as unviewed. Late fallback lifecycle output produced while switching projects SHALL be part of the same viewing acknowledgement for the terminal that was visible at handoff. Structured completion SHALL remain eligible for the finished indicator even when the terminal is active.

#### Scenario: Viewing clears the indicator

- **WHEN** a user views or types into a terminal with a pending fallback indicator
- **THEN** the indicator clears

#### Scenario: Tab selection acknowledgement

- **WHEN** a terminal is selected through the Dockview tab lifecycle
- **THEN** it reports the same server-owned acknowledgement as programmatic focus

#### Scenario: Project switch handoff

- **WHEN** late fallback lifecycle output is produced while switching projects
- **THEN** it belongs to the same viewing acknowledgement for the terminal that was visible at handoff

### Requirement: Server-side parsing pipeline

Structured terminal parsing SHALL run in Terminay Server independently of client mounting, native windows, and xterm view lifecycle. The terminal signal parser SHALL parse PTY bytes with a headless xterm parser and emit typed protocol signals; signal interpreters SHALL reduce those signals to a `SemanticActivity` snapshot; the server SHALL publish ordered changes through the application protocol; and the canonical activity reducer SHALL combine fallback activity with scoped focus, acknowledgement, and recent-input facts.

#### Scenario: No client attached

- **WHEN** no client is mounted for a terminal
- **THEN** structured terminal parsing still runs on the server and publishes ordered changes

### Requirement: PTY stream integrity and ordering

The original data SHALL remain in the PTY stream and parsing SHALL NOT strip escape sequences before xterm receives them. Each chunk SHALL be parsed before its raw bytes are forwarded, so semantic activity state is ordered before client rendering and fallback state cannot flash for one frame.

#### Scenario: Chunk containing an OSC sequence

- **WHEN** a PTY chunk containing escape sequences is processed
- **THEN** it is parsed first and then forwarded unmodified to the client

### Requirement: Agent lifecycle service separation

The agent lifecycle service SHALL be a separate upstream source. The server SHALL choose authoritative agent status for a session whenever such an entry exists and SHALL NOT feed provider journal events through the terminal-signal interpreters.

#### Scenario: Journal event received

- **WHEN** a provider journal event arrives for a session
- **THEN** it sets authoritative agent status and is not routed through the terminal-signal interpreters

### Requirement: Client projection of activity

Clients SHALL render ordered activity events and report scoped focus and input acknowledgement; no renderer SHALL become the fallback authority. Transport-neutral clients SHALL maintain a bounded projection of the server snapshot and SHALL apply only contiguous revisions. A replay gap SHALL request a fresh snapshot, and reload or resync SHALL replace the projection without replaying old transitions as new local activity. A resync is an explicit authority boundary and SHALL therefore accept a lower revision when the server has restarted its revision sequence. Host transport adapters SHALL forward the projection client's resync callback rather than substituting an ordinary refresh, and presentation layers SHALL NOT impose a second revision comparison. Project-scoped projections SHALL advance the global cursor while omitting sessions owned by other projects.

#### Scenario: Replay gap

- **WHEN** a client detects a non-contiguous revision
- **THEN** it requests a fresh snapshot rather than applying the gap

#### Scenario: Server revision sequence restarts

- **WHEN** the server restarts its revision sequence and the client resyncs
- **THEN** the client accepts the lower revision at that explicit authority boundary

#### Scenario: Project-scoped projection

- **WHEN** a projection is scoped to one project
- **THEN** it advances the global cursor and omits sessions owned by other projects

### Requirement: Activity protocol surface

The protocol SHALL expose the projection as `activity.snapshot` and `activity.delta`, SHALL emit canonical `activity` events on the normal ordered event journal, and SHALL accept `activity.acknowledge` only with the exact immutable `projectId` and `sessionId`. Destructive close protection SHALL use `activity.closePreflight` with that same exact project identity and, for a terminal close, the exact session identity. The preflight SHALL return a bounded fresh observation for only those sessions; `activity.snapshot` and `activity.delta` SHALL remain committed projection reads and SHALL never wait for live host inspection. This is the client boundary used by both browser and Desktop hosts, and no `terminal:activity` IPC message is part of the server contract.

#### Scenario: Acknowledge with mismatched ids

- **WHEN** `activity.acknowledge` names a project or session other than the exact immutable pair
- **THEN** the request is not accepted

#### Scenario: Close preflight

- **WHEN** a client calls `activity.closePreflight` for a terminal close
- **THEN** it names the exact project and session identity and receives a bounded fresh observation for only those sessions

#### Scenario: Desktop host activity

- **WHEN** a Desktop host reads terminal activity
- **THEN** it uses the same protocol surface and no `terminal:activity` IPC message

### Requirement: Reducer fencing and stale events

The server reducer SHALL fence every session to its first immutable project binding. An activity or acknowledgement request naming a different project SHALL be ignored without consuming a revision. Events and timeout ticks carrying an older observation time than the current session snapshot SHALL also be ignored, so delayed PTY chunks cannot rewind state or publish a second stale transition.

#### Scenario: Request naming a different project

- **WHEN** an activity or acknowledgement request names a project other than the session's first immutable binding
- **THEN** it is ignored and no revision is consumed

#### Scenario: Delayed PTY chunk

- **WHEN** an event or timeout tick carries an older observation time than the current session snapshot
- **THEN** it is ignored and no stale transition is published

### Requirement: Activity settings

Existing tab-indicator settings SHALL govern fallback terminal activity: **Use terminal signals for activity** enables structured-signal detection, **Progress signal timeout** controls `OSC 9;4` staleness, and **Show indicator for active tabs**, **Show indicator for finished tabs**, and the timing settings control fallback tab indicators. Disabling terminal-signal detection SHALL restore raw-output-based terminal activity and SHALL NOT change the **Agent status and sidebar** setting, provider lifecycle journals, or canonical agent status. The persisted **Agent status and sidebar** setting SHALL govern the agent feature as a whole, including journal discovery and its status surfaces, independently of the terminal-fallback settings.

#### Scenario: Terminal-signal detection disabled

- **WHEN** a user disables **Use terminal signals for activity**
- **THEN** raw-output-based terminal activity is used
- **AND** journal-backed agent status remains unaffected

#### Scenario: Progress timeout changed

- **WHEN** a user changes **Progress signal timeout**
- **THEN** `OSC 9;4` staleness uses the new value

#### Scenario: Independent agent setting

- **WHEN** the **Agent status and sidebar** setting is changed
- **THEN** journal discovery and agent status surfaces change without altering the terminal-fallback settings

### Requirement: Error and recovery behaviour

Malformed or oversized OSC payloads SHALL be ignored without interrupting PTY forwarding. Parser and interpreter failures SHALL stay local to the terminal-activity fallback and SHALL NOT invalidate canonical agent state. A stalled progress signal SHALL expire and a PTY exit SHALL clear its fallback timers. If authoritative journal observation stops, the in-memory entry SHALL retain its last accepted state until another journal event or terminal exit; Terminay MAY additionally show clearly fallback-derived terminal activity but SHALL NOT silently use it to mutate or relabel the canonical entry. If authoritative events later resume for the same terminal and agent identity, they SHALL take precedence immediately.

#### Scenario: Malformed OSC payload

- **WHEN** a malformed or oversized OSC payload arrives
- **THEN** it is ignored and PTY forwarding continues

#### Scenario: Interpreter failure

- **WHEN** a parser or interpreter fails
- **THEN** the failure stays local to the fallback and canonical agent state remains valid

#### Scenario: Journal observation stops

- **WHEN** authoritative journal observation stops for an agent
- **THEN** the in-memory entry retains its last accepted state until another journal event or terminal exit

#### Scenario: Journal events resume

- **WHEN** authoritative events resume for the same terminal and agent identity
- **THEN** they take precedence immediately

### Requirement: Terminal activity non-goals

Terminay SHALL NOT infer canonical agent states from raw text, terminal titles, spinner frames, process names, or escape-sequence message bodies; SHALL NOT treat an exit code as a canonical agent result without a provider event; SHALL NOT render progress percentages or failed-command badges; SHALL NOT install shell-integration scripts; SHALL NOT raise native desktop notifications from OSC payloads; and SHALL NOT expose a public third-party terminal-signal interpreter API.

#### Scenario: Spinner frames in an unrecognized terminal

- **WHEN** a terminal prints spinner frames or an agent-like title
- **THEN** no canonical agent state is inferred from them

#### Scenario: OSC notification received

- **WHEN** a terminal emits an OSC notification payload
- **THEN** no native desktop notification is raised from it

#### Scenario: Progress percentage reported

- **WHEN** `OSC 9;4;1;50` is received
- **THEN** fallback activity is working and no progress percentage is rendered
