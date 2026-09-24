## Context

Home is a per-device selectable view that is not a project
(`workspace-dashboard`). It renders `WorkspaceDashboard.tsx` straight into the
workspace area. The project bar's sidebar toggle is disabled while Home is
selected, because sidebar visibility is per device *and per project*
(`project-sidebar-layout`), and Home has no project.

Nothing server-side runs on a schedule or reacts to workspace events on the
user's behalf. The pieces an automation needs already exist, spread across
`packages/server-core`:

| Need | Existing piece |
| --- | --- |
| Revisioned server-owned persistence | `macroService/repository.ts` over a `MacroBackend` (file backend in `apps/terminay-server/src/cli.ts` and `electron/main.ts`) |
| Run text / a macro against an exact terminal | `macroService/runner.ts` `MacroRunner` with a `MacroTarget {serverId, projectId, sessionId}` and a `MacroExecutionEnvironment` |
| Agent transitions | `activity/agentService.ts` `subscribe`; states `working | waiting | blocked | done | idle`, completion outcome `success | error | cancelled` |
| Command finished / idle | `activity/service.ts` `TerminalActivityService.subscribe`; OSC 133/633 `CommandPhase` with `exitCode` |
| Ordered server events | `events.ts` `OrderedEventJournal` |
| Terminal creation | `terminalService/service.ts` `createResolvedSession`, with `workspace.ts` `terminal.create` / `panel.create` |
| MCP capability | `apps/terminay-server/src/mcp/controlEndpoint.ts` `ControlCapabilityStore.mint(sessionId, projectId, scope)`, enforced in `mcp/terminalAdapter.ts` `targetSession` |
| Recording | `recordingService/service.ts` `RecordingService.start` |

There are three gaps:
- Every terminal must belong to a real project: `requireProject`, and a panel's `projectId` must equal its session's.
- The journal has no typed project-opened, project-closed, or device-connected events. Projects only publish a generic `workspace.changed`, and remote admission has a close hook but no open hook.
- No cron or scheduler dependency exists.

In-force ADRs that constrain this design:
- 0011 (trust-boundary model; the local control socket row).
- 0017 (every project executes on its server).
- 0018 (one workspace bundle, many server connections).
- 0028 (never poll without the owner's approval; supersedes 0022).
- 0002 (the server state repository direction).
- 0003 (secrets stay in the vault).

## Goals / Non-Goals

**Goals:**

- Give Home a sidebar menu (Home, Tabs, Automations) with device-remembered
  visibility and section, and swap the Home glyph for a house.
- Add an overview section built entirely from state clients already receive.
- Add server-owned automations covering the four scenarios we discussed:
  - page me when a terminal needs attention
  - count finished agents in a file
  - an hourly script that spawns agents across projects
  - answer or nudge the terminal that fired an event
- Keep automations independent of projects: they fire with no project open and
  with no client attached.

**Non-Goals:**

- Webhook, HTTP, file-watch, or Git triggers; chaining automations; conditions
  or filters beyond what the command itself can check through its environment.
- A built-in notification action. Scenario 1 is a command calling a CLI.
- Catching up missed schedules.
- Secret interpolation in run-command lines. A script reads its own secrets.
- Per-project automations, and automations that span servers.
- Moving automation-space terminals into a project, or project terminals into
  the automation space.

## Decisions

### D1. Home sidebar is client presentation state

Home sidebar visibility and selected section are two new device-state keys in
`src/workspace/localViewState.ts`. They are kept beside the remembered view mode
and follow the same "hint, never an error" rule. When Home is selected,
`toggleActiveProjectExplorer` and the `toggle-file-explorer-sidebar` command
route to the Home sidebar, and the toggle stops being disabled. The Home sidebar
reuses the project sidebar's container, resize separator, and narrow-layout
drawer, but renders a section menu instead of a pane stack. So it inherits the
drawer's focus and dismissal behaviour and needs no new layout code.

The default section is **Home** (the overview), and the default visibility is
open. The existing dashboard moves under **Tabs** unchanged.
`WorkspaceDashboard.tsx` keeps owning its header, view modes, and filter.

*Alternative:* model Home's sidebar as another sidebar group of the active
project. Rejected: the sidebar's state would follow whichever project was
selected before Home, which contradicts "Home is not a project".

### D2. Overview widgets derive, never aggregate on the server

Widgets are pure functions over the inventory (`workspaceInventory.ts`), agent
presentation (`agentPresentation.ts`), connection state, and the automation
subscription (D4). They go in a new `src/workspace/homeOverviewModel.ts` so the
counts can be unit-tested. No server "stats" endpoint is added, so a count can
never disagree with the surface it summarises. Remote device counts come from
the existing remote status the project bar already reads.

### D3. The automation terminal space is a reserved system project

Each server gets exactly one workspace project of a new kind, `automations`. The
server creates it on first use, and it can never be closed, renamed, reordered,
or selected as a project. Workspace projections to clients carry the kind:
- Every project list, ordering, switcher, tab bar, and inventory consumer filters
  it out.
- The Automations section is its only renderer.

It always executes in the server's own local environment (ADR-0017). Its panels,
sessions, recording, MCP minting, and activity tracking therefore reuse the
existing project-keyed machinery untouched.

*Alternative:* a new session kind with no project. Rejected: `requireProject`,
the panel/session project equality, environment routing, recording metadata, MCP
token resolution, and activity keying all assume a project id. Removing that
assumption means touching every one of those boundaries at once. A reserved
project keeps each boundary's check as it is and adds one filter at the
presentation edge.

*Risk accepted:* a consumer that forgets the filter would show the space as a
project. Mitigation: T-tests assert its absence from every project projection,
and the project list helper filters it at one choke point
(`useProjectCollection.ts`).

### D4. `automationService` mirrors `macroService`

The new module is `packages/server-core/src/automationService/`:

- `repository.ts`: `AutomationRepository` over an `AutomationBackend`, with the
  same envelope as macros: `commandId` idempotency, `expectedRevision` conflicts,
  and `replace/upsert/remove`. File backends go in both `apps/terminay-server/src/cli.ts`
  (`automations.v1.json`) and `electron/main.ts`. This matches how macros,
  settings, and workspace state are stored today. Sitting behind a backend
  interface, it moves with them when the ADR-0002 SQLite repository lands.
- `runLog.ts`: a separate bounded store (`automation-runs.v1.json`) holding a
  ring buffer of 100 entries per automation plus missed-run records. It is
  separate so a busy event automation never rewrites the definitions file.
- `scheduler.ts` (D5), `triggers.ts` (D6), and `executor.ts` (D7).
- `protocol.ts`: operations `automations.get|upsert|remove|setEnabled|run|stop|runs|missed.dismiss`
  and events `automations.changed`, `automations.run.changed`, `automations.missed.changed`.
  Write operations use the terminal-create scope policy (D9).
- Feature capability `automations.v1` in `packages/protocol/src/compatibility.ts`,
  advertised from `capabilities.ts`, and mirrored in `packages/client-core/src/automations.ts`.
  A client talking to an older server hides the Automations section for that
  connection.

### D5. Scheduler: one timer armed to the earliest due time, no polling

Cron expressions are parsed by a small in-house five-field parser in a new
`packages/cron` workspace package. It is shared by the server (next fire times)
and the editor (plain-words description and five-run preview). Supply-chain
policy makes a 200-line parser cheaper than a new dependency. It supports `*`,
lists, ranges, and steps, with standard day-of-month / day-of-week OR semantics.
Evaluation uses the server's local zone:
- A time that falls in a DST gap is skipped.
- A time repeated by a DST overlap fires once.

The scheduler keeps each enabled schedule's next due time and arms **one**
`setTimeout` to the earliest (ADR-0028: a one-shot timeout to a deadline, never a poll). It re-arms
when an automation is edited, enabled, disabled, or removed, after every fire,
and at start.

Clock handling:
- A timer that fires more than 60 s past its due time (the host slept, or the
  clock jumped) treats the occurrences in between as missed, not due.
- Each automation persists `evaluatedThrough`. At start, the occurrences between
  it and now are counted into the missed record (D8) and are not run.

### D6. Triggers subscribe to canonical sources and fire on transitions

`triggers.ts` subscribes once per server and fans out to every enabled
automation:

| Trigger | Source | Transition |
| --- | --- | --- |
| Agent finished / needs input / blocked | `AgentStatusService.subscribe` | previous state ≠ `done` / `waiting` / `blocked`, new state equal |
| Terminal needs attention | the canonical needs-attention signal behind `wait_for_attention` | raised |
| Command finished | `TerminalActivityService` `CommandPhase` → `finished` | per completion, with `exitCode` |
| Terminal idle | `TerminalActivityService` status `working` → `idle` | transition |
| Project opened / closed | **new** typed `project.opened` / `project.closed` journal events emitted by `workspace.ts` `project.create` / `project.close` | per command |
| Remote device connected | **new** `onConnectionAdmitted` hook beside `onConnectionClosed` in `remote/transport.ts`, wired in both hosts | per admitted device |

Mapping from the words we used while exploring:
- "Needs me" is `waiting`.
- "Error/fault" is `blocked`.
- An agent that finished with an error fires Agent finished, with
  `TERMINAY_AGENT_OUTCOME=error`.

Last-known state is kept in memory per (session, agent). After a restart, the
first report only seeds it and does not fire, which is what makes "transition
into" safe across restarts. Events from *run terminals* (tagged at launch by the executor) are dropped
before fan-out. Terminals a run opens through MCP in the automation space are
not tagged, so an agent spawned by the hourly script can still page you when it
needs input; the loop guard covers any feedback that creates.

The two new events are typed facts emitted at the command that causes them, not
inferred by diffing `workspace.changed`. Other consumers can use them later.

### D7. Execution

- **Run command.** `executor.ts` asks the launch resolver for the automation's
  shell profile. It starts that shell *non-interactively* (`-l -c <command>` for
  POSIX shells; the profile's documented equivalent elsewhere) as a new
  panel in the automation space. The PTY's exit is the run's end and the
  command's exit code is its outcome. That makes "keep terminal after run" mean
  keeping an exited terminal's scrollback, not a live shell. The launch
  environment gets the `TERMINAY_*` context variables (validated, bounded,
  newline-free values) and, where MCP is enabled, the control socket and a
  workspace-scope token (D10). A max-duration timer sends the normal terminal
  close path and logs the run as timed out.
- **Run Macro on subject.** Runs through `MacroRunner.start` with an exact
  `MacroTarget` built from the event's session identity and a server-built
  automation authorization (D9). Field values come from the automation
  definition. Launch-client disconnect rules don't apply: there is no launching
  client.
- **Write text to subject.** Uses `terminal.input` on the exact target. Text may
  use the macro type-step Eta subset, rendered just in time over the event
  context.
- **Subject revalidation.** Immediately before acting, the executor re-resolves
  the target session and its incarnation. A mismatch logs the run as skipped
  because the subject was gone, never "closest match".
- **Output tail.** At run end the executor takes a presentation snapshot of the
  last 200 rows (the same bounded snapshot `read_terminal` uses), strips control
  sequences, and stores at most 16 KiB with the run log entry.
- **Recording.** When "record session" is on, the executor calls
  `RecordingService.start(sessionId)` before the command writes output, and
  stores the recording id on the run.

### D8. Loop guard, concurrency, and missed runs

- **Loop guard.** An in-memory map of `(automationId, sessionId) → until`. The
  default cooldown is 60 s, with a minimum of 5 s for subject-terminal actions.
  Suppressed events increment a counter on the automation's latest run entry.
- **Concurrency.** A per-automation "no overlapping scheduled runs" rule, plus a
  server-wide limit of 8 runs in progress, over which a run is logged as
  skipped. The automation space is additionally capped at 50 live terminals.
  `open_terminal` from a workspace-scope caller beyond that cap fails with a
  bounded error, so an hourly spawner cannot grow without limit.
- **Missed runs.** The record is `{automationId, missedCount, latestDueAt}` in
  the run log store. Clients subscribe to `automations.missed.changed` and show
  the notice described in the spec. Dismissing it or running from it are server
  operations, so every client clears together.

### D9. Authority

- **Who may edit and run.** Editing and "run now" require the same scope policy
  as `terminal.create` on that server. A paired remote device that may open
  terminals may manage automations, and a device that may not, may not.
- **Who a run acts as.** Runs execute under a server-internal `automation`
  principal, never under the client that saved the automation, so a run never
  depends on or impersonates a connected client.
- **Audit.** Every run and every definition change is recorded with that
  principal and the editing actor.
- **No MCP route.** MCP has no automation tools, so a spawned agent cannot
  schedule itself or its successors.

This crosses the 0011 "authenticated client → privileged action" boundary.
Actor and scope come from the authenticated transport at save time, and are
revalidated at every write.

### D10. MCP workspace scope

`ControlCapabilityStore.mint` gains a `workspace` scope. The minting site
chooses it from the terminal's canonical project kind (D3) and from nothing
else. With that scope, `terminalAdapter.targetSession` accepts any session on the
same server instead of requiring equal `projectId`. `list_terminals` adds an
opaque project handle and project title per row, and `open_terminal` accepts an
optional project handle; with none, it opens in the automation space. Project
scope is untouched and still never names projects.

Today only Electron supplies the MCP launch-environment hook. On a standalone
server without it, automations still run; their commands just have no MCP.

This is the durable boundary decision recorded in the ADR.

## Risks / Trade-offs

- **[Unattended command execution]** A saved automation runs shell commands with
  the server user's authority while nobody is watching. → It is explicitly
  enabled, audited per run, managed only by terminal-capable clients, bounded in
  concurrency and duration, and never creatable through MCP.
- **[Workspace-scope token leak]** A token copied out of an automation terminal
  reaches every project on that server. → It is bound to its minting terminal and
  revoked on that terminal's exit. Run terminals close by default, so tokens are
  short-lived. The widened scope is limited to terminal control; MCP still
  exposes no filesystem, Git, settings, or secrets.
- **[Feedback loops]** Writing into a terminal can re-raise the event that
  triggered the write. → A per-subject cooldown, and run terminals
  never raise events.
- **[Runaway spawning]** An hourly script that spawns agents can pile up
  terminals. → A 50-terminal cap on the automation space, and a visible list in
  the Automations section.
- **[Reserved project leaks into UI]** → A single filter choke point plus tests
  per projection (D3).
- **[Host sleep and clock jumps]** → Late timers count as missed, not due (D5).
  Behaviour is predictable, and the notice tells the user.
- **[In-house cron parser bugs]** → Table-driven tests against known expressions,
  DST fixtures for the gap and the overlap, and the editor preview shows the next
  five runs before save.

## Migration Plan

This is additive. There is no existing automation data. The reserved project is
created lazily on the first run, so a server that never uses automations never
gets one, and older clients receive a project kind they do not know. To stop old
clients from rendering it as a normal project:
- The server withholds the reserved project from connections that did not
  negotiate `automations.v1`.
- Its terminals are likewise excluded from those connections' inventories.

Rollback: disabling the feature capability hides the section. Leftover
`automations.v1.json` and `automation-runs.v1.json` files are inert.

## Open Questions

- Default Home section: overview (chosen) or Tabs, since Tabs is what Home shows
  today? It's easy to flip, since it's one default in `localViewState.ts`.
- Should the automation space's live terminals also be reachable from the
  activity menu when one of them needs attention, for example a spawned agent
  waiting for input? The proposal keeps them in the Automations section only. An
  attention badge on the Home control may be wanted.
- No in-force ADR needs revisiting.
