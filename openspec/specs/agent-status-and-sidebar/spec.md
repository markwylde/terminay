# agent-status-and-sidebar Specification

## Purpose

Terminay composes installed coding-agent extension providers with the server's own terminals and reduces their canonical lifecycle events into provider-neutral agent entries that drive terminal-tab status, a project-scoped Agents pane with roots and in-process subagents, and the header activity dropdown.

## Requirements

### Requirement: Provider-neutral canonical agent model

Terminay SHALL reduce session-source snapshots into provider-neutral agent entries. The same canonical model SHALL feed terminal-tab status, the project-scoped **Agents** pane with roots and subagents, and the header activity dropdown. A session SHALL be associated with a Terminay terminal only by process ancestry, and with a project only by its working directory, its repository worktrees, or its bound terminal.

#### Scenario: Provider bound to a PTY

- **WHEN** a session's owning process descends from a server-owned PTY
- **THEN** its entry is bound to that terminal and drives that terminal's tab status

#### Scenario: Evidence not proven

- **WHEN** a session's owning process descends from no server-owned PTY
- **THEN** its entry is external and drives no terminal tab status

### Requirement: Server-owned authorization and client subscription

Terminal and project authorization, canonical validation, ordering, snapshots, acknowledgement, project scoping, and terminal binding SHALL live in Terminay Server. Session detection SHALL live in separately hosted extensions and reach the server only as session-source snapshots through the public Extension API. Connected clients SHALL subscribe to the same ordered reduced snapshot and SHALL NOT read provider files or create competing agent state. A client that holds several connections SHALL subscribe once per connection and SHALL keep each server's ordered reduced snapshot separate. It SHALL NEVER merge two servers' snapshots into one ordered stream, and SHALL NEVER acknowledge an entry through a connection other than the one that published it.

#### Scenario: Client rendering agent state

- **WHEN** a client displays agent status
- **THEN** it renders the server's ordered reduced snapshot and reads no provider file

#### Scenario: Extension observing a provider

- **WHEN** an extension reports sessions
- **THEN** it uses only the public session-source API and performs no terminal or project authorization

#### Scenario: Subscriptions on several connections

- **WHEN** a client attaches two servers that each publish agent entries
- **THEN** it holds one subscription per connection, keeps each snapshot ordered by its own server, and acknowledges each entry on the connection that published it

### Requirement: Provider journal privacy boundary

Provider journals and stores SHALL be private privileged inputs read only inside the extension that reports sessions. Raw records, responses, instructions, reasoning, tool arguments, and tool output SHALL never cross the extension boundary and SHALL never be logged by the integration. A session snapshot SHALL carry only bounded display metadata: title, model, working directory, current tool name, waiting description, and last error message. A title derived from a user's first prompt SHALL be bounded like any other title.

#### Scenario: Journal containing conversation content

- **WHEN** a provider journal contains responses, reasoning, tool arguments, or tool output
- **THEN** none of that content appears in a session snapshot or in logs

#### Scenario: Oversized title

- **WHEN** a source reports a title longer than the snapshot bound
- **THEN** the title is truncated to the bound before it crosses the extension boundary

### Requirement: Zero-configuration discovery outcomes

Running a CLI whose harness is enabled in an installed session source SHALL be discovered without editing provider configuration or installing hooks, wrappers, or global integrations. Agent state SHALL remain associated with the exact terminal the user can activate whenever the session runs inside one. Provider file formats and versions SHALL stay out of Server Core, client components, and stores. A harness the source does not support, or cannot read, SHALL produce no entry and SHALL leave the terminal on terminal-activity signalling.

#### Scenario: Running a supported CLI

- **WHEN** a user runs a supported agent CLI in a Terminay terminal
- **THEN** it is discovered without provider configuration edits or global integrations, and its state is bound to that exact terminal

#### Scenario: Unsupported CLI

- **WHEN** a user runs an agent CLI that no enabled source supports
- **THEN** no agent entry appears and the terminal uses terminal-activity signalling

#### Scenario: Malformed journal

- **WHEN** a supported harness's own files are missing, malformed, or unreadable
- **THEN** the source reports no session for them and the terminal uses terminal-activity signalling

### Requirement: Provider ids are extension contributions

Session source ids SHALL be namespaced extension contributions rather than a closed core union, and every entry SHALL carry the source id and the harness name the source reported. Terminay SHALL bundle one enabled-by-default session source reporting Claude Code, Codex, Grok, and oh-my-pi sessions. A third-party source SHALL participate through the same validated manifest, hosted runtime, snapshot, Settings, and disablement contracts. Persisted unknown or disabled source ids SHALL remain bounded metadata and SHALL NOT cause extension code to load in a client.

#### Scenario: Third-party provider

- **WHEN** a third-party session source extension is installed
- **THEN** it participates through the same manifest, runtime, snapshot, Settings, and disablement contracts as the bundled source

#### Scenario: Unknown persisted provider id

- **WHEN** persisted state references an unknown or disabled source id
- **THEN** it remains bounded metadata and no extension code loads in a client

### Requirement: Canonical agent states

An agent entry SHALL carry one of five states. `working` means the agent is processing a turn or performing tool or subagent work and SHALL be indicated in yellow or amber with restrained motion, including on the focused terminal. `waiting` means the provider explicitly requests approval, an answer, or other user input and SHALL be indicated in red while unacknowledged. `blocked` means a supported record explicitly reports a blocking condition and SHALL be indicated in red with an accessible label distinct from waiting while unacknowledged. `done` means the current turn or agent run completed, failed, or was cancelled and SHALL be indicated in green while unacknowledged. `idle` means the live session exists without active work or a pending result and SHALL be neutral or hidden on compact surfaces. Viewing the bound terminal SHALL hide the waiting, blocked, and done tab indicators without rewriting those states. The Agents pane SHALL continue to present operational state independently of acknowledgement.

#### Scenario: Approval requested

- **WHEN** a provider record explicitly requests approval or user input
- **THEN** the entry is `waiting` and is indicated in red

#### Scenario: Blocking condition

- **WHEN** a supported record explicitly reports a blocking condition
- **THEN** the entry is `blocked` and carries an accessible label distinct from waiting

#### Scenario: Turn completes

- **WHEN** a turn completes, fails, or is cancelled
- **THEN** the entry is `done` and is indicated in green while unacknowledged

#### Scenario: Viewing a done agent

- **WHEN** the user views a terminal whose bound agent is `done`
- **THEN** the tab's green indicator is hidden and the entry remains `done`

### Requirement: Acknowledgement independent of state

Acknowledgement SHALL be independent of operational state. Interacting with a terminal — clicking its tab, clicking into it, or typing — SHALL clear its unread treatment without rewriting its provider-derived state, and a later meaningful transition SHALL be able to make it unread again. Activating the project SHALL NOT clear unread treatment. A terminal the user is already interacting with when a meaningful `done`, `waiting`, or `blocked` transition arrives SHALL be treated as viewed for that transition.

#### Scenario: Viewing an entry

- **WHEN** the user clicks the bound terminal tab, clicks into that terminal, or types into it
- **THEN** its unread treatment clears and its provider-derived state is unchanged

#### Scenario: Activating the project does not acknowledge an agent

- **WHEN** a bound agent is `done` or needs attention and the user activates its project without interacting with that terminal
- **THEN** the entry stays unread and the tab indicator remains

#### Scenario: New transition after acknowledgement

- **WHEN** a meaningful transition occurs after an entry was acknowledged
- **THEN** the entry becomes unread again

#### Scenario: Done while already viewing

- **WHEN** a bound agent becomes `done` on the terminal the user is already clicking or typing in
- **THEN** the entry is acknowledged, remains `done`, and no green tab or project activity indicator is shown for it

#### Scenario: Waiting while already viewing

- **WHEN** a bound agent becomes `waiting` or `blocked` on the terminal the user is already clicking or typing in
- **THEN** the entry is acknowledged, its operational state is unchanged, and no red tab or project activity indicator is shown for it

### Requirement: Roots and children

A root SHALL represent one live session reported by a source. A subagent the source reports for that session SHALL be represented beneath that root and SHALL activate the same terminal when the root is bound. Source-supplied session and subagent ids SHALL be the identity keys, and display text SHALL never be an identity key. Child transitions SHALL NOT replace root state, and a child ending SHALL update only that child.

#### Scenario: Child transition

- **WHEN** a subagent's status changes
- **THEN** only that child's entry updates and the root's state is unchanged

#### Scenario: Identity keys

- **WHEN** entries are correlated across snapshots
- **THEN** source-supplied ids are used and display text is not treated as an identity key

### Requirement: Process-scoped live projection

Live Agents projection SHALL be scoped to one running Terminay process rather than a durable `serverId`. Each process SHALL mint an ephemeral `processInstanceId` at boot and stamp it on every snapshot it emits, and a client connected to that process SHALL render only that snapshot. A terminal binding SHALL hold only while the session's owning process remains a descendant of a PTY shell that process spawned, and the entry SHALL become external as soon as it does not.

#### Scenario: Two processes sharing files

- **WHEN** two Terminay processes observe the same machine-wide sessions
- **THEN** each binds sessions only to its own PTYs and neither's snapshot contains the other's terminal bindings

#### Scenario: Writer leaves the PTY tree

- **WHEN** a session's owning process is no longer a descendant of a PTY shell this process spawned
- **THEN** this process drops the terminal binding and the entry becomes external

### Requirement: Deterministic root label before a provider title

Every root SHALL carry a label from the moment it is created. Until the source reports a title, the label SHALL be the harness display name. A reported title SHALL replace that label in place on the existing root. It SHALL NOT create another root, replay lifecycle, or change `working`, `waiting`, `blocked`, `done`, or child state.

#### Scenario: Root created before a title exists

- **WHEN** a session appears and the source reports no title
- **THEN** the entry carries the harness display name

#### Scenario: Explicit title arrives

- **WHEN** the source later reports a title
- **THEN** the existing root's label is replaced in place and its state is unchanged

### Requirement: Agents pane presentation

The **Agents** pane SHALL be the Agents sidebar group's collapsible pane. It SHALL show the roots that belong to the current project on that project's own server, keyed by the pair of server and project, and SHALL nest children beneath them. Bound and external roots SHALL be listed together in one stable ordering, with external rows carrying the **External** marker. Rows SHALL use the existing tree geometry. Missing metadata SHALL be omitted. A generic terminal tab name SHALL NOT be used as the agent title: an untitled root SHALL use the harness label until the source reports a title. The harness label SHALL come from the source's declared harness display names, and the Agents UI SHALL NOT keep a hardcoded map of provider ids.

How an entry's display name, provider and model metadata, and prompt are resolved from a snapshot entry SHALL be one rule shared by every surface that presents an agent, so the same agent SHALL NEVER be named one thing in the Agents pane and another thing on another surface. A surface that presents agents outside one project SHALL apply that same rule rather than its own.

#### Scenario: Root in another project

- **WHEN** a session's working directory is outside the current project and its repository worktrees, and it is not bound to one of the project's terminals
- **THEN** it is not shown in the current project's Agents pane

#### Scenario: Untitled root

- **WHEN** a root has no reported title
- **THEN** it displays the harness display name rather than a generic terminal tab name

#### Scenario: Same project id on another attached server

- **WHEN** another attached server holds a project whose id equals the current project's id and has a root
- **THEN** that root is not shown in the current project's Agents pane

#### Scenario: One agent on two surfaces

- **WHEN** the same bound root is presented in the Agents pane and on a surface that spans projects
- **THEN** both resolve the same display name, the same provider and model metadata, and the same prompt from the same entry

### Requirement: Row activation

Activating a bound row SHALL activate its exact project and terminal panel, focus the terminal, and acknowledge that entry without changing operational state. Activating an external row SHALL do nothing. No approximate terminal SHALL be focused when a row has no binding.

#### Scenario: Activating a bound row

- **WHEN** the user activates an agent row bound to a terminal
- **THEN** its exact project and terminal panel activate, the terminal is focused, and the entry is acknowledged without changing its state

#### Scenario: Binding unavailable

- **WHEN** the user activates a row that is not bound to a terminal
- **THEN** no terminal is focused

### Requirement: Agent status setting

**Settings → AI → Agents → Agent status and sidebar** SHALL be persisted and enabled by default. It SHALL control every session source and the agent UI surfaces. Disabling it SHALL stop every source, clear bindings and the reduced snapshot, and prevent sources from starting. Re-enabling it SHALL start the sources, which report the sessions live at that moment, and SHALL NOT revive stale entries. Neither setting SHALL install, edit, trust, or remove provider hooks or configuration.

#### Scenario: Disabling the setting

- **WHEN** the setting is disabled
- **THEN** every session source stops, bindings and the reduced snapshot clear, and no source runs

#### Scenario: Re-enabling the setting

- **WHEN** the setting is re-enabled
- **THEN** currently live sessions are reported afresh and previously cleared stale entries are not revived

#### Scenario: Provider configuration

- **WHEN** agent status is enabled or disabled
- **THEN** no provider hook or configuration file is installed, edited, trusted, or removed

### Requirement: Independence from the Terminay MCP server

Agent status and the Terminay MCP server SHALL be independent even when one extension contributes both a session source and MCP install targets. MCP registration SHALL NOT supply agent lifecycle facts. Installing, removing, enabling, or disabling MCP SHALL NOT change session reporting or sidebar status. Enabling or disabling agent status SHALL NOT install or configure MCP. Observing any harness SHALL NOT require, install, or invoke MCP.

#### Scenario: MCP enablement changes

- **WHEN** the Terminay MCP server is installed, enabled, or disabled
- **THEN** session reporting and sidebar status are unchanged

#### Scenario: Observing omp

- **WHEN** an oh-my-pi session is observed
- **THEN** MCP is not required, installed, or invoked

### Requirement: Terminal tab and header status surfaces

Bound roots SHALL render the canonical RAG glyph on terminal tabs for `working` always, and for `waiting`, `blocked`, and `done` only while those entries are unacknowledged. The header SHALL aggregate unacknowledged meaningful entries from every attached connection, giving waiting and blocked priority, keeping done until acknowledged, and optionally showing working for navigation. Every aggregated entry SHALL stay keyed by its server and project, and activating one SHALL act on that entry's own server.

#### Scenario: Bound root on a tab

- **WHEN** a terminal has a bound agent root that is working
- **THEN** its tab renders the canonical RAG glyph for working

#### Scenario: Unacknowledged done on a tab

- **WHEN** a background terminal has a bound agent root that is `done` and unacknowledged
- **THEN** its tab renders the green RAG glyph

#### Scenario: Acknowledged done on a tab

- **WHEN** a terminal has a bound agent root that is `done` and acknowledged
- **THEN** its tab does not render a done RAG glyph

#### Scenario: Aggregating in the header

- **WHEN** several unacknowledged entries exist
- **THEN** waiting and blocked entries take priority in the header aggregate and done entries remain until acknowledged

#### Scenario: Entries from two attached servers

- **WHEN** two attached servers each hold an unacknowledged waiting entry
- **THEN** the header aggregate includes both, each row keyed by its server and project, and activating one acts only on that server

### Requirement: Agent authority isolation between server instances

Every agent entry SHALL belong to exactly one server authority. Two concurrent Terminay Server compositions — two isolated Desktop profiles, or two standalone servers — MAY observe the same machine-wide sessions and MAY use the same project names, project ids, terminal session ids, and extension packages. Each authority SHALL admit entries only from its own extension hosts, SHALL bind sessions only to its own PTYs, and SHALL NOT receive or acknowledge another authority's entries. An extension host SHALL publish only through the channel its own server runtime created.

#### Scenario: Identical identifiers in two profiles

- **WHEN** two isolated profiles each open a project containing the same running agent
- **THEN** each profile shows its own entry for it, bound only to its own terminals, and acknowledging it in one leaves the other unread

#### Scenario: Foreign context value

- **WHEN** a publication arrives on a channel not created by the current server runtime
- **THEN** it is refused

### Requirement: Immutable scope fencing for agent operations

Acknowledgement, activation, and replay SHALL each require the exact server, project, and entry issued by the owning authority. Equal project names and reused terminal ids SHALL NOT substitute for a server-instance match. A terminal binding SHALL name the full terminal identity — server instance, project, terminal session, and incarnation — so two terminals never share a binding. When a terminal's foreground returns to its shell, it closes, or its binding is dropped, that terminal's claim on every entry SHALL be revoked before any further tab status is published for it.

#### Scenario: Reused terminal id

- **WHEN** an operation presents a terminal id that matches by value but belongs to another server instance
- **THEN** the operation is refused

#### Scenario: Foreground transition revokes a claim

- **WHEN** a terminal closes, or its foreground returns to the shell after the bound agent exits
- **THEN** the binding is revoked and no further tab status is published for that terminal

#### Scenario: Context identifiers for two terminal sessions

- **WHEN** two terminal sessions each bind a session
- **THEN** each binding names its own full terminal identity and the two never share one

### Requirement: Concurrent agent terminals

Terminay SHALL show every live session a source reports, not only the first. Several sessions of one harness in one project SHALL each hold their own root with their own state, acknowledgement, and lifetime. One session's root SHALL NOT be displaced, retired, or restated by another session's appearance, and closing one SHALL leave the others unchanged.

#### Scenario: Two terminals run one provider

- **WHEN** two terminals in a project each run the same harness
- **THEN** the Agents pane shows a root for each, each bound to its own terminal

#### Scenario: Terminals of different providers

- **WHEN** terminals in a project run different harnesses concurrently
- **THEN** each session holds its own root bound to its own terminal

#### Scenario: One of several terminals quits

- **WHEN** one of several concurrent sessions quits
- **THEN** only its root is retired and every other root is unchanged

#### Scenario: Admission refused for an already-admitted context

- **WHEN** a source reports a session id it has already reported
- **THEN** the existing root is updated and no second root is created

### Requirement: Bounded lifecycle publication flow control

Session-source publication SHALL be flow-controlled per source. A publication batch SHALL be validated in full before the store is mutated, so an invalid snapshot leaves the store and the canonical sequence unchanged. Publications for one source SHALL be serialized, and the queue depth and batch size SHALL be bounded. An acknowledgement deadline SHALL expire a stalled publication and the work queued behind it, after which the source SHALL resend its full live set. An overflowing source SHALL be rejected without a store call and asked to resend its full live set. A publication that arrives after its source was disposed SHALL reach no store. Canonical revisions and sequences SHALL remain monotonic throughout.

#### Scenario: Invalid transition inside a batch

- **WHEN** a publication batch contains an invalid snapshot
- **THEN** the whole batch is rejected and neither the store nor the canonical sequence changes

#### Scenario: Queue overflow

- **WHEN** a source exceeds its bounded publication queue
- **THEN** the publication is rejected without a store call and the source resends its full live set

#### Scenario: Stalled acknowledgement

- **WHEN** a publication is not acknowledged within its deadline
- **THEN** it and the publications queued behind it expire and the source resends its full live set

#### Scenario: Late retry after retirement

- **WHEN** a publication arrives after its source was disposed
- **THEN** it reaches no store

### Requirement: Host-supplied ordering and timestamps

Terminay SHALL supply ordering and occurrence time when a provider has no reliable values. A provider MAY propose a timestamp, and a proposed timestamp SHALL NOT rewind the canonical stream.

#### Scenario: Provider proposes an earlier timestamp

- **WHEN** a provider proposes an occurrence time earlier than the canonical stream has already reached
- **THEN** the canonical stream does not rewind

#### Scenario: No reliable provider time

- **WHEN** a provider record carries no reliable time
- **THEN** Terminay supplies ordering and occurrence time

### Requirement: Metadata-only updates preserve lifecycle state

A snapshot that changes only title, model, working directory, or current tool SHALL preserve the entry's state and acknowledgement and SHALL NOT create a new session or turn.

#### Scenario: Title changes mid-turn

- **WHEN** a source reports a new title while the session is `working`
- **THEN** the title updates and the state stays `working`

#### Scenario: Metadata change is not a new session

- **WHEN** a snapshot changes only metadata
- **THEN** no new root is created

### Requirement: Subagents require stable native identity

A source SHALL report a subagent only with a stable id supplied by the harness, and SHALL report its end only from the harness's own evidence. Array index, title, prompt text, and timing SHALL NOT be used as subagent identity.

#### Scenario: Native child without a stable id

- **WHEN** a harness supplies no stable identity for a subagent
- **THEN** no child is reported

#### Scenario: Child completion evidence

- **WHEN** a source reports a subagent completed, failed, or cancelled
- **THEN** only that child's entry changes

### Requirement: Session identity comes only from provider evidence

A session's identity SHALL be the session id its source reports. A display title, working directory, timestamp, or filename SHALL NOT be a session identity. Working directory SHALL decide only which projects a session belongs to.

#### Scenario: Binding from a title or path

- **WHEN** two sessions share a working directory or report the same title
- **THEN** they remain two entries distinguished by their source-reported ids

#### Scenario: Handle provenance checked

- **WHEN** a source publishes a session id
- **THEN** the id is namespaced by that source and cannot name another source's session

### Requirement: Header Notifications control

The header SHALL present exactly one Notifications control: an icon button named **Notifications** that is always visible, whether or not anything is listed. The control SHALL carry a single red count badge whose number is the count of notifications — terminals that need attention plus terminals with finished unviewed activity — across every attached connection. Working terminals SHALL NOT contribute to the number. The badge SHALL be hidden when the number is zero. The badge SHALL be a circle of one fixed size regardless of the number it displays, with the number centred, the font size stepping down as the digit count grows, and counts above 99 displayed as `99+`. The control's accessible name SHALL state the number of notifications.

#### Scenario: Notifications of both kinds

- **WHEN** one terminal needs attention and two terminals have finished unviewed activity
- **THEN** the header shows one Notifications icon with a single red badge reading `3`

#### Scenario: Working terminals are not counted

- **WHEN** four terminals are working and nothing needs attention or has finished unviewed
- **THEN** the Notifications icon is visible with no badge

#### Scenario: Nothing at all

- **WHEN** no terminal is working, needs attention, or has finished unviewed activity
- **THEN** the Notifications icon is still visible with no badge, and it can be opened

#### Scenario: Counting across attached servers

- **WHEN** one attached server has two finished unviewed terminals and another has one terminal needing attention
- **THEN** the badge reads `3`

#### Scenario: Count capped at 99+

- **WHEN** more than 99 terminals have finished unviewed activity
- **THEN** the badge reads `99+` and its width still equals its height

### Requirement: Notifications list

Opening the Notifications control SHALL show the list of notifications, attention before finished, newest first within each, each row keyed by its server and project. A row SHALL read as a notification: its status dot, a headline saying what happened in that terminal (an agent finishing, waiting, or blocked; a command finishing; a terminal needing attention), the terminal's title and its project, and how long ago it happened when that time is known. Working terminals SHALL NOT appear in the list. When there are no notifications the list SHALL show an empty state reading that there are no notifications. Activating a row SHALL select that terminal on its own server, as selecting its tab does, and close the list. The list's contents SHALL be governed by the **Show indicator for active tabs** and **Show indicator for finished tabs** settings.

#### Scenario: Order and contents

- **WHEN** one terminal needs attention, one has finished unviewed, and one is working
- **THEN** the list shows the attention row, then the finished row, and no row for the working terminal

#### Scenario: A row says what happened

- **WHEN** an agent in the terminal titled `Terminal 1` of the project `Project 2` finished 23 seconds ago and stays unacknowledged
- **THEN** its row reads `Agent finished`, names `Terminal 1` and `Project 2`, and says `23 seconds ago`

#### Scenario: Newest first

- **WHEN** two terminals have finished unviewed activity at different times
- **THEN** the more recent one is listed above the older one

#### Scenario: Only working terminals

- **WHEN** two terminals are working and there are no notifications
- **THEN** the list shows only the empty state

#### Scenario: Activating a notification

- **WHEN** a user activates a finished row for a terminal in a background project on another attached server
- **THEN** that project is activated, that terminal is selected on its own server, the list closes, and the notification clears as it would on clicking that terminal's tab

#### Scenario: Rows from two attached servers

- **WHEN** two attached servers each hold a terminal needing attention
- **THEN** the list shows both rows, each naming its own server and project

### Requirement: Dismissing notifications

Each notification row SHALL carry a dismiss control, and the list SHALL carry a **Clear all** control whenever at least one notification is listed. Dismissing a notification SHALL acknowledge that terminal on its own server exactly as selecting its tab does, without selecting the terminal or activating its project, so that its terminal tab dot, its project dot, and the header number clear together on every attached client. **Clear all** SHALL do the same for every listed notification on every attached connection. **Clear all** SHALL NOT affect working terminals, whose tab and project dots remain. The list SHALL stay open after a dismissal.

#### Scenario: Dismissing one notification

- **WHEN** a user dismisses a finished notification for a terminal in a background project
- **THEN** the row leaves the list, the header number drops by one, that terminal's tab dot clears, the active project and selected terminal are unchanged, and the list stays open

#### Scenario: Dismissing the last notification of a project

- **WHEN** a user dismisses the only notification in a project that has no working terminal
- **THEN** that project's tab dot hides

#### Scenario: Clear all

- **WHEN** three notifications are listed across two attached servers and one terminal is working, and the user presses **Clear all**
- **THEN** all three notifications are acknowledged on their own servers, the header badge hides, the empty state shows, and the working terminal's tab still shows its working dot

#### Scenario: Dismissal reaches other clients

- **WHEN** two clients are attached to the same server and one dismisses a notification
- **THEN** the notification clears on the other client as well

#### Scenario: Clear all with nothing to clear

- **WHEN** there are no notifications
- **THEN** no **Clear all** control is shown

### Requirement: Machine-wide session sources

Agent sessions SHALL come from extension-contributed session sources that report every live coding-agent session on the Terminay Server's machine, whether or not it was started in a Terminay terminal. A live session SHALL be one the source reports with an owning OS process id. Terminay SHALL NOT sample process tables, read provider journals, or infer agent state in Server Core; every session fact SHALL come from a source snapshot.

#### Scenario: Agent started outside Terminay

- **WHEN** a supported agent CLI is started in another terminal emulator on the server's machine
- **THEN** its session is reported by the session source and becomes a candidate for every project's Agents pane

#### Scenario: Session without a process

- **WHEN** a source knows a session only from history and reports no owning process id
- **THEN** it does not appear as an agent entry

#### Scenario: Server Core infers nothing

- **WHEN** an agent CLI writes to its own files
- **THEN** Server Core reads none of them and changes agent state only from source snapshots

### Requirement: Project scoping by directory and repository worktrees

A live session SHALL belong to a project when its reported working directory, canonicalised, is the project root or a descendant of it at any depth, or is any worktree of the Git repository that contains the project root, or a descendant of such a worktree. The set of worktrees SHALL be the repository's own worktree list, including the main worktree and every linked worktree wherever it is on disk. That set SHALL be refreshed when the repository's worktree metadata changes, observed by a filesystem watch and never by a timer. A session with no reported working directory SHALL belong to no project. One session MAY belong to several projects whose roots overlap. Changing a session's working directory SHALL re-evaluate its projects.

#### Scenario: Session in a subdirectory

- **WHEN** a session's working directory is `packages/api` below the project root
- **THEN** it appears in that project's Agents pane

#### Scenario: Session in a linked worktree outside the project root

- **WHEN** a session runs in a linked worktree of the project's repository that lives outside the project root
- **THEN** it appears in that project's Agents pane

#### Scenario: Session in a worktree added after startup

- **WHEN** a new linked worktree is added to the repository and an agent starts in it
- **THEN** the worktree set is refreshed by the metadata watch and the session appears without any timer running

#### Scenario: Session in an unrelated directory

- **WHEN** a session's working directory is outside the project root and outside every worktree of its repository
- **THEN** it does not appear in that project's Agents pane

#### Scenario: Project that is not a Git repository

- **WHEN** the project root is not inside a Git repository
- **THEN** only sessions at or below the project root belong to it

### Requirement: Terminal binding by process ancestry

Terminay SHALL bind a live session to a terminal when the session's owning process is that terminal's PTY shell process or a descendant of it, and SHALL NOT bind by working directory, title, focus, or timing. Binding SHALL be re-evaluated when the session is first reported, when its owning process changes, and when a terminal's foreground process changes. Process ancestry SHALL be read on those edges only and never on a timer. A bound session SHALL activate and acknowledge through exactly that terminal. A session bound to a terminal SHALL appear in that terminal's project even when its working directory is outside the project.

#### Scenario: Agent launched in a Terminay terminal

- **WHEN** a session's owning process is a descendant of a Terminay terminal's shell
- **THEN** the session is bound to that terminal and its tab shows the agent's status

#### Scenario: Two terminals in one directory

- **WHEN** two Terminay terminals in the same directory each run an agent
- **THEN** each session binds to the terminal whose process tree owns it, regardless of their shared working directory

#### Scenario: Bound agent changes directory

- **WHEN** a bound session reports a working directory outside its terminal's project
- **THEN** it remains bound and shown in its terminal's project

### Requirement: External sessions

A session that belongs to a project but is bound to no terminal on the owning server SHALL be shown in that project's Agents pane with an **External** marker. Activating an external row SHALL do nothing. An external session SHALL carry no unread treatment. It SHALL NOT contribute to terminal tab indicators, project activity counts, or the header activity aggregate. When an external session later binds to a terminal, the same entry SHALL become a bound entry without being recreated.

#### Scenario: External row activation

- **WHEN** the user activates a row marked External
- **THEN** no terminal is focused and nothing else changes

#### Scenario: External session finishes a turn

- **WHEN** an external session's turn completes
- **THEN** its row shows `done`, and no tab indicator, project count, or header entry is added for it

### Requirement: Session snapshot mapping to canonical state

Terminay SHALL map each source snapshot to a canonical entry as follows:

- A source status of `running` SHALL be `working`.
- `waiting` SHALL be `waiting`, carrying the bounded `waitingFor` description when present.
- `blocked` SHALL be `blocked`.
- `idle` SHALL be `done` when the snapshot's last turn ended after the entry was created and after it was last acknowledged, and `idle` otherwise, so a session that was already idle when first reported is never shown as a fresh completion.
- A last turn reported as failed SHALL be `done` with an error outcome and the bounded error text.
- A last turn reported as interrupted SHALL be `done` with a cancelled outcome.
- A snapshot with no status SHALL leave the entry's state unchanged.

The session title, model, current tool name, and open-subagent count SHALL be display metadata. They SHALL NOT change state. A session the source reports closed SHALL retire its entry and its children.

#### Scenario: Turn completes while unacknowledged

- **WHEN** a session goes from `running` to `idle` with its last turn completed
- **THEN** the entry is `done` and unread

#### Scenario: Idle session reported at startup

- **WHEN** a session whose last turn ended before Terminay started is first reported `idle`
- **THEN** the entry is `idle`, not `done`

#### Scenario: Agent waits on a permission prompt

- **WHEN** a source reports a session `waiting` with a `waitingFor` description
- **THEN** the entry is `waiting` and shows the bounded description

#### Scenario: Failed turn

- **WHEN** a session's last turn is reported failed with an error message
- **THEN** the entry is `done` with an error outcome and the bounded message

#### Scenario: Agent quits

- **WHEN** a source reports a session closed
- **THEN** its entry and its children are retired and no longer shown

### Requirement: Disabled agent integration performs no observation

While the agent-integration setting is off, the server SHALL perform no agent
observation of any kind: no topology polling, no process enumeration, no
open-file inspection, and no journal reads. Disabling the setting SHALL cancel
observation already scheduled, not merely stop new work being admitted, so a
terminal that was being polled when the setting changed stops being polled.

Re-enabling the setting SHALL resume observation for the terminals that are
still alive, without requiring them to be restarted.

The cost of the feature SHALL therefore be zero — measured as child processes
spawned per idle second — for a user who has turned it off.

#### Scenario: Setting turned off while a terminal is being polled

- **WHEN** the agent-integration setting is turned off while topology polling is
  armed for a live terminal
- **THEN** that polling is cancelled
- **AND** no further process or open-file inspection runs for that terminal

#### Scenario: Idle cost while disabled

- **WHEN** the agent-integration setting is off and the window is idle
- **THEN** agent observation spawns no child processes

#### Scenario: Setting turned back on

- **WHEN** the setting is turned on again
- **THEN** observation resumes for terminals that are still alive, without
  restarting them

### Requirement: Topology sampling backs off while nothing changes

Topology sampling for a terminal that keeps finding no new evidence SHALL widen
the interval between samples up to a ceiling rather than sample at its fastest
cadence indefinitely, because each sample spawns a process. New evidence SHALL
reset the interval.

#### Scenario: Nothing changes

- **WHEN** repeated topology samples for a terminal find no change
- **THEN** the interval between samples widens up to a ceiling

#### Scenario: Evidence arrives

- **WHEN** the process topology changes for a terminal that had backed off
- **THEN** the interval resets and sampling resumes promptly
