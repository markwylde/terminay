## ADDED Requirements

### Requirement: Automations are server-owned and workspace-wide

An automation SHALL be a rule of one trigger and one action, owned and executed by one Terminay Server. An automation SHALL NEVER belong to a project: opening, closing, renaming, or removing any project SHALL NOT create, change, disable, or remove an automation, and an automation SHALL fire while the workspace holds no project, only an empty project, or no attached client at all. Automations SHALL be stored with revisioned, server-owned persistence, SHALL survive server restarts, and SHALL NEVER be written to device storage or hosted services.

#### Scenario: Project closed

- **WHEN** every project that was open when an automation was created is closed
- **THEN** the automation is unchanged and still fires on its trigger

#### Scenario: No client attached

- **WHEN** a schedule comes due while no desktop or browser client is attached to the server
- **THEN** the server runs the automation

#### Scenario: Server restart

- **WHEN** the server restarts
- **THEN** every automation, with its enabled state and settings, is restored

### Requirement: Automation definition

An automation SHALL have a name, an enabled state, exactly one trigger, exactly one action, and its run settings: keep terminal after run, record session, and loop-guard cooldown. A disabled automation SHALL NEVER fire on its trigger. Saving an automation SHALL validate its trigger and action together and SHALL refuse a combination the action cannot serve, naming the reason. Edits SHALL apply to runs that start after the edit and SHALL NOT change a run already in progress.

#### Scenario: Disabled automation

- **WHEN** a disabled automation's trigger occurs
- **THEN** no run starts and no run is logged

#### Scenario: Invalid combination

- **WHEN** a user saves a scheduled automation whose action writes text to the subject terminal
- **THEN** the save is refused with a reason saying scheduled triggers have no subject terminal

#### Scenario: Edit during a run

- **WHEN** an automation is edited while one of its runs is in progress
- **THEN** that run continues under the definition it started with

### Requirement: Schedule trigger

A schedule trigger SHALL be a standard five-field cron expression evaluated in the server's local time zone, with a resolution of one minute. The editor SHALL offer presets — every minute, every N minutes, hourly at a minute, daily at a time, on weekdays at a time, weekly on a day at a time — that produce cron expressions, and SHALL accept a raw cron expression. The editor SHALL describe the schedule in plain words and SHALL preview its next five run times before saving. An expression that never matches or cannot be parsed SHALL be refused. A schedule SHALL fire at most once per matching minute, and a run SHALL NOT start while the same automation's previous scheduled run is still in progress; that occurrence SHALL be logged as skipped because the previous run was still running.

#### Scenario: Preset produces an expression

- **WHEN** a user chooses "every hour at minute 0"
- **THEN** the schedule is `0 * * * *`, is described as every hour on the hour, and previews the next five run times

#### Scenario: Unparseable expression

- **WHEN** a user saves the expression `61 * * * *`
- **THEN** the save is refused with a reason naming the invalid field

#### Scenario: Previous run still running

- **WHEN** an hourly automation comes due while its previous run is still running
- **THEN** no new run starts and the occurrence is logged as skipped because the previous run was still running

### Requirement: Missed schedules are skipped and reported

A scheduled occurrence that came due while the server was not running SHALL NOT be run on restart. The server SHALL record each automation that missed at least one occurrence, with the number missed and the time of the latest. The next time a client with authority over automations attaches, it SHALL present a brief, non-alarming notice listing those automations, each with a control to run it now, and a control to dismiss the notice. Dismissing it or running an automation from it SHALL clear that entry for every client. The notice SHALL NEVER run anything on its own.

#### Scenario: Server closed over a scheduled time

- **WHEN** an hourly automation's server is stopped for three hours and then restarted
- **THEN** none of the three occurrences runs, and the automation is recorded as having missed three runs

#### Scenario: Notice on next attach

- **WHEN** a user attaches after automations were missed
- **THEN** a brief notice explains that these automations were scheduled to run while Terminay was closed, lists them, and offers to run each now

#### Scenario: Running from the notice

- **WHEN** the user runs one automation from the notice
- **THEN** that automation runs once and its entry disappears from the notice on every client

### Requirement: Event triggers

An event trigger SHALL fire on exactly one of these Terminay events, observed across every project on the owning server:

- **Agent finished**: an agent entry enters `done`.
- **Agent needs input**: an agent entry enters `waiting`.
- **Agent blocked**: an agent entry enters `blocked`.
- **Terminal needs attention**: a terminal raises the canonical needs-attention signal.
- **Command finished**: a terminal reports a structured command completion.
- **Terminal idle**: a terminal becomes canonically inactive.
- **Project opened** and **Project closed**.
- **Remote device connected**.

Events SHALL be taken from the same canonical sources the rest of the workspace presents, so an event fires if and only if the matching state change is shown to the user. An event SHALL fire only on a transition into the named state, never on a repeated report of a state already held. A run terminal — the terminal an automation launches to run its command — SHALL NOT raise events, so an automation never triggers on its own runs. Terminals that a run opens through MCP, such as agents spawned by a scheduled script, SHALL raise events like any other terminal.

#### Scenario: Agent finishes in any project

- **WHEN** an agent in any project on the server moves from `working` to `done`
- **THEN** every enabled automation triggered by Agent finished fires once

#### Scenario: Repeated state report

- **WHEN** an agent already in `waiting` reports `waiting` again
- **THEN** no Agent needs input event fires

#### Scenario: Run terminal finishes a command

- **WHEN** a command finishes in a run terminal launched by an automation
- **THEN** no Command finished event fires

#### Scenario: Spawned agent needs input

- **WHEN** an agent in a terminal opened through MCP by a scheduled script enters `waiting`
- **THEN** every enabled automation triggered by Agent needs input fires for it

### Requirement: Event subject and context

Each event SHALL carry a subject: a terminal for agent and terminal events, a project for project events, and a device for the remote-device event. A run started by an event SHALL receive that event's context, and a run started by a schedule or by a user SHALL receive the trigger kind and fire time. Context SHALL be passed to a command as environment variables prefixed `TERMINAY_`, naming at least the event, the fire time, the automation, and, where they apply, the subject terminal's opaque handle and title, its project's title, the agent's provider and state, the command's exit code, and the device's name. Context SHALL NEVER include capability tokens, secrets, terminal output, or provider journal content.

#### Scenario: Context for a command

- **WHEN** an Agent finished event runs a command
- **THEN** the command sees `TERMINAY_EVENT`, the subject terminal's handle and title, its project's title, and the agent's provider and state in its environment

#### Scenario: No sensitive context

- **WHEN** any run's environment is built
- **THEN** it contains no capability token, secret, terminal output, or provider journal content

### Requirement: Run command action

A run-command action SHALL run a user-given command line in a new terminal in the automation terminal space, using a chosen shell profile and a working directory chosen on the automation, which defaults to the user's home directory and never to a project root. The run SHALL end when the command's process exits, and the run's outcome SHALL be the exit code. A run SHALL have a maximum duration set on the automation, with a default of one hour; a run that exceeds it SHALL be stopped and logged as timed out.

#### Scenario: Scheduled script

- **WHEN** an hourly automation runs `~/bin/fix-conflicted-prs.sh`
- **THEN** the script runs in a new automation terminal in the configured working directory and the run is logged with its exit code

#### Scenario: Run exceeds its maximum duration

- **WHEN** a run is still going when its maximum duration elapses
- **THEN** the run is stopped and logged as timed out

### Requirement: Subject terminal actions

For an event whose subject is a terminal, an automation MAY instead run a Macro on the subject terminal or write text into it. Running a Macro SHALL follow the macro run rules for that terminal, and the automation SHALL supply values for the Macro's fields when it is saved; a Macro field that cannot be supplied SHALL make the save fail. Writing text SHALL write the exact configured text, optionally followed by a submit, and MAY use the same template rendering as Macro type steps over the event context. If the subject terminal no longer exists, or has changed identity, when the action would begin, the run SHALL be logged as skipped because the subject was gone and SHALL NOT act on any other terminal. These actions SHALL NEVER be offered for schedule, project, or device triggers.

#### Scenario: Answer an agent that needs input

- **WHEN** an Agent needs input event fires for an automation that writes `continue` and submits
- **THEN** `continue` is written to the subject terminal and submitted

#### Scenario: Subject closed before the action

- **WHEN** the subject terminal is closed before its automation's action begins
- **THEN** nothing is written to any terminal and the run is logged as skipped because the subject was gone

### Requirement: Loop guard

After an automation acts on a subject terminal, it SHALL NOT fire again for that same terminal until its loop-guard cooldown has elapsed; the default cooldown SHALL be one minute and SHALL NEVER be zero for subject-terminal actions. Events suppressed by the guard SHALL be counted in the run log rather than logged individually. The server SHALL also bound how many runs of all automations may be in progress at once, and SHALL log a run that would exceed that bound as skipped.

#### Scenario: Writing text re-triggers the event

- **WHEN** an automation writes text to an agent that then enters `waiting` again within the cooldown
- **THEN** the automation does not fire for that terminal and the suppressed event is counted

#### Scenario: Different terminal inside the cooldown

- **WHEN** a different terminal raises the same event inside another terminal's cooldown
- **THEN** the automation fires for the different terminal

### Requirement: Automation terminal space

Terminals launched by automations, and terminals that automation commands open through MCP, SHALL live in an automation terminal space on the owning server. That space SHALL NOT be a project: it SHALL NEVER appear in project ordering, project tabs, the switcher, or the Tabs section, and SHALL persist independently of every project. Its terminals SHALL be shown in the Automations section, grouped by run, where a user can view, focus, type into, and close them as ordinary terminals. When a run ends, its terminal SHALL close unless the automation's "keep terminal after run" setting is on; terminals opened by a run through MCP SHALL remain open until closed.

#### Scenario: Run terminal closes by default

- **WHEN** a run of an automation with "keep terminal after run" off exits
- **THEN** its terminal closes and the run log keeps its outcome and output tail

#### Scenario: Keep terminal after run

- **WHEN** a run of an automation with "keep terminal after run" on exits
- **THEN** its terminal stays open in the Automations section until the user closes it

#### Scenario: Agent spawned by a scheduled script

- **WHEN** a scheduled script opens a terminal through MCP and starts an agent in it
- **THEN** that terminal appears in the Automations section under the run that opened it and stays open after the script exits

#### Scenario: Not a project

- **WHEN** projects are listed, ordered, or shown in the Tabs section
- **THEN** the automation terminal space is absent

### Requirement: Run log

The server SHALL keep a bounded log of automation runs, retaining at least the most recent 100 runs per automation and dropping the oldest first. Each entry SHALL record the automation, the trigger kind and fire time, the subject, whether it was started by a trigger or by a user, the outcome — succeeded, failed with exit code, timed out, stopped, or skipped with a reason — the duration, and a bounded tail of the run terminal's final output. The log SHALL be server-owned, SHALL survive restart, and SHALL be available to clients that have authority over automations.

#### Scenario: Output tail after the terminal closed

- **WHEN** a user opens a finished run whose terminal has closed
- **THEN** the run's outcome, exit code, duration, and final output tail are shown

#### Scenario: Log bound

- **WHEN** an automation has run 150 times
- **THEN** its oldest runs are dropped and at least its latest 100 remain

### Requirement: Optional session recording for runs

An automation's "record session" setting, off by default, SHALL record each run's terminal through the existing session recording feature, subject to that feature's storage, consent, and privacy rules, and SHALL link the recording from the run's log entry. A recording failure SHALL NOT fail the run.

#### Scenario: Recorded run

- **WHEN** an automation with "record session" on runs
- **THEN** its terminal is recorded and the run's log entry links to the recording

### Requirement: Automations section

The Automations section of Home SHALL list the automations of the selected server with each one's name, enabled state, trigger in plain words, next scheduled run where it has one, and last run outcome. When more than one connection is attached, the section SHALL offer a server selector, as the Macros surface does. From it a user SHALL be able to create, edit, duplicate, enable, disable, delete, and run an automation now; see its run history and open any run; and see the automation terminal space's terminals. Running now SHALL start an ordinary logged run marked as started by a user; for a subject-terminal action it SHALL ask the user to choose a subject terminal. Deleting an automation SHALL stop none of its runs already in progress and SHALL ask for confirmation.

#### Scenario: Creating a scheduled automation

- **WHEN** a user creates an automation with a daily-at-09:00 schedule that runs a command, and saves it enabled
- **THEN** it is listed with its trigger described in plain words and its next run time

#### Scenario: Run now

- **WHEN** a user runs a scheduled automation now
- **THEN** a run starts at once and is logged as started by a user

#### Scenario: Two servers attached

- **WHEN** two connections are attached
- **THEN** the section offers a server selector and lists only the selected server's automations

### Requirement: Automation authority

Creating, editing, enabling, running, and deleting automations SHALL require the same authority on the owning server as creating a terminal there, and SHALL be refused to any client, device, MCP caller, or extension without it. An automation SHALL NEVER be created, edited, or enabled through MCP. The server SHALL revalidate authority on every request and SHALL NEVER infer it from UI focus or renderer state.

#### Scenario: MCP caller attempts to create an automation

- **WHEN** a process with an MCP capability asks to create or enable an automation
- **THEN** no such operation exists and nothing is created

#### Scenario: Client without terminal authority

- **WHEN** a client without authority to create terminals on a server attempts to save an automation there
- **THEN** the request is refused
