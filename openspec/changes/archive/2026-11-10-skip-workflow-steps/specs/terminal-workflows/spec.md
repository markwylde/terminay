## MODIFIED Requirements

### Requirement: Step status rules

A step's status SHALL be one of `not_started`, `running`, `done`, `failed`, `needs_input`, or `skipped`, and any step MAY move to any status. `skipped` SHALL record that a step was deliberately not carried out. A step SHALL be settled when it is `done` or `skipped`. At most one step of a workflow SHALL be `running` or `needs_input` at a time. Setting a step to `running` or `needs_input` while a different step holds either status SHALL fail with `step_active`, which names the active step's id, and change nothing. A note SHALL be one line of at most 200 characters. An update that carries a note SHALL replace the step's note, an empty note SHALL clear it, and an update without a note SHALL keep it. A workflow SHALL be unfinished while any step is not settled, and finished when every step is settled. Wherever Terminay counts a workflow's steps done, shows its progress, or decides whether it is finished, a skipped step SHALL count as done.

#### Scenario: Two steps active

- **WHEN** step 5 is running and an agent sets step 6 to running
- **THEN** the call fails with `step_active` naming step 5's id, and both steps keep their status

#### Scenario: Marking a step done with a note

- **WHEN** an agent sets step 5 to done with the note "codex: 3 findings (P1, P2, P3)"
- **THEN** step 5 is done and its note is shown in the panel

#### Scenario: A failed step leaves the workflow unfinished

- **WHEN** every step is done except step 7, which failed
- **THEN** the workflow is unfinished and Resume is offered for that terminal

#### Scenario: Skipping a step that does not apply

- **WHEN** an agent sets step 6 to skipped with the note "not a visual change, no screenshots"
- **THEN** step 6 is skipped, its note is shown in the panel, and it is not shown as done

#### Scenario: Skipped steps finish a workflow

- **WHEN** every step of a workflow is done except step 6, which is skipped
- **THEN** the workflow is finished, its tab counts every step, and the Command Bar does not list Resume workflow

### Requirement: Step times

A step SHALL record when it started and when it ended. Moving a step to `running` or `needs_input` from `not_started`, `done`, `failed`, or `skipped` SHALL set its start time to now and clear its end time. Moving between `running` and `needs_input` SHALL keep both times. Moving to `done`, `failed`, or `skipped` from any other status SHALL set its end time to now, and SHALL also set its start time to the same instant when it had none. An update that leaves the status unchanged SHALL change no time. Moving a step to `not_started` SHALL clear both times and its note. A step's duration SHALL be its end time minus its start time.

#### Scenario: Retrying a failed step

- **WHEN** a failed step is set to running again
- **THEN** its start time is now, it has no end time, and the panel shows its running time

#### Scenario: Needs input after done

- **WHEN** a done step is set to needs_input
- **THEN** its start time is now and it has no end time

#### Scenario: Done without running

- **WHEN** a step that was not started is set straight to done
- **THEN** its start and end times are equal and its duration is zero

#### Scenario: Repeated final status

- **WHEN** a done step is set to done again with a new note
- **THEN** its note changes and its times do not

#### Scenario: Skipping a step that was not started

- **WHEN** a step that was not started is set to skipped
- **THEN** its start and end times are equal

### Requirement: Collapsed workflow rail

Collapsed, the panel SHALL be a narrow rail of one marker per step, in step order, joined by a line. A marker SHALL show the step's icon, or, when the step has none, a check for `done`, a dot for `running`, a cross for `failed`, an exclamation mark for `needs_input`, a dash for `skipped`, and nothing for `not_started`. The marker SHALL be filled green for `done`, outlined amber for `running`, filled red for `failed` and `needs_input`, outlined grey for `not_started`, and dashed grey and dimmed for `skipped`. Each marker SHALL have an accessible name made of the step's title and status. At the foot of the rail, below the markers, the rail SHALL show the workflow's name rotated to read from bottom to top, shortened with an ellipsis when the rail is too short for it.

#### Scenario: Collapsed rail

- **WHEN** a terminal's workflow has four steps done, one running, and five not started, and the panel is collapsed
- **THEN** the rail shows four green markers, one amber marker, and five grey markers in order, and the terminal ends to the left of the rail

#### Scenario: Step without an icon

- **WHEN** a done step has no icon
- **THEN** its marker shows a check

#### Scenario: Skipped step on the rail

- **WHEN** a step with an icon is skipped and the panel is collapsed
- **THEN** its marker shows its icon, dashed grey and dimmed, distinct from both a done marker and a not-started marker, and its accessible name ends with "skipped"

### Requirement: Expanded workflow panel

Expanded, the panel SHALL also show the workflow's name, how many steps are done, the time elapsed since the first step started, a collapsible brief holding the opening prompt, and each step's title, its duration once it has ended or running time while it runs, and its note. The `running` or `needs_input` step SHALL be highlighted. A skipped step's title SHALL be struck through and dimmed, and it SHALL show its note and no duration.

#### Scenario: Reading the brief

- **WHEN** the user opens the brief in the expanded panel
- **THEN** it shows the workflow's opening prompt as plain text

#### Scenario: Skipped step in the expanded panel

- **WHEN** step 6 of eight is skipped with the note "not a visual change" and steps 1 to 5 are done
- **THEN** the panel shows step 6's title struck through with that note and no duration, and counts six of eight steps done

### Requirement: Launch text

Launching SHALL create the terminal's workflow from the template with every step `not_started`, then write the launch text to the terminal as one paste, using bracketed paste when the terminal has enabled it, and submit it once. The launch text SHALL be `/goal `, followed by the template's opening prompt, followed by a fixed instruction: call `get_workflow`, work through the steps in order, set each step to `running` before starting it, follow its prompt, and set it to `done` with a one-line note, `failed` with the reason, or `needs_input` when it needs the user; set a step it has been told to drop, or that does not apply, to `skipped` with a one-line reason; and continue until every step is done or skipped. The launch text SHALL be bounded to 16 KiB, and a launch over the bound SHALL be refused before anything changes.

#### Scenario: Launching a template

- **WHEN** the user opens the Command Bar on a terminal running an agent and chooses `openspec:standard-flow`
- **THEN** the terminal's workflow panel shows the template's ten steps not started, and the launch text is pasted into that terminal and submitted once

#### Scenario: Oversized launch text

- **WHEN** a template's opening prompt makes its launch text longer than 16 KiB
- **THEN** the launch is refused, no workflow is attached, and nothing is written to the terminal

#### Scenario: The instruction names skipping

- **WHEN** a template is launched
- **THEN** the launch text tells the agent to set a step it is told to drop to `skipped` with a reason, and to continue until every step is done or skipped

### Requirement: Resuming a workflow

While the active terminal's workflow is unfinished, the Command Bar SHALL list **Resume workflow** with the workflow's name above every other workflow entry. Choosing it SHALL write the resume text to that terminal as one paste and submit it once, as launching does, and SHALL change no step. The resume text SHALL be `/goal `, followed by the workflow's opening prompt, followed by a fixed instruction to call `get_workflow`, treat it as the source of truth, continue from the resume point and then every other step that is not done or skipped, in step order, and set a step that does not apply to `skipped` with a one-line reason.

#### Scenario: Agent session restarted mid-run

- **WHEN** a workflow has steps 1 to 4 done and step 5 running, the user starts a new agent session in the terminal, and chooses Resume workflow
- **THEN** the resume text is typed and submitted, and steps 1 to 5 keep their status

#### Scenario: Finished workflow

- **WHEN** every step of the active terminal's workflow is done
- **THEN** the Command Bar does not list Resume workflow

### Requirement: The resume point

A workflow's resume point SHALL be its `running` or `needs_input` step when it has one, and otherwise its first step that is not settled. `get_workflow` SHALL return the resume point's step id, and the resume instruction SHALL tell the agent to continue from it and then go on to every other step that is not settled, in step order, including steps before the resume point.

#### Scenario: An earlier step failed while a later one runs

- **WHEN** step 1 failed and step 5 is running
- **THEN** the resume point is step 5

#### Scenario: Nothing active

- **WHEN** steps 1 and 2 are done, step 3 failed, and no step is active
- **THEN** the resume point is step 3

#### Scenario: A skipped step is passed over

- **WHEN** steps 1 to 5 are done, step 6 is skipped, and step 7 is not started
- **THEN** the resume point is step 7

#### Scenario: A restored earlier step is not left behind

- **WHEN** step 3 is restored to not started while step 7 is running
- **THEN** the resume point is step 7, and the resume instruction tells the agent to go on to every other step that is not settled, so step 3 is still worked

## ADDED Requirements

### Requirement: Skipping a step from the panel

The expanded workflow panel SHALL offer a Skip action on each `not_started` or `failed` step, which sets it to `skipped` with the note "Skipped from the panel", and a Restore action on each `skipped` step, which sets it to `not_started`. It SHALL offer neither on a `running`, `needs_input`, or `done` step. Neither action SHALL write anything to the terminal. When the update fails, the panel SHALL say so and leave the step as the server reports it.

#### Scenario: User skips a failed step

- **WHEN** a step failed with the note "tests timed out" and the user chooses Skip on it
- **THEN** the step is skipped and its note is "Skipped from the panel"

#### Scenario: User skips a step

- **WHEN** a workflow's step 6 is not started and the user chooses Skip on it in the expanded panel
- **THEN** step 6 is skipped in that panel, on every client that can see the terminal, and in `get_workflow`, and nothing is typed into the terminal

#### Scenario: User restores a skipped step

- **WHEN** the user chooses Restore on a skipped step
- **THEN** the step is not started, has no note and no times, and the workflow is unfinished

#### Scenario: Active step cannot be skipped from the panel

- **WHEN** a step is running
- **THEN** the panel offers no Skip action on it

#### Scenario: Skip fails

- **WHEN** the user chooses Skip and the server refuses the update
- **THEN** the panel says the step could not be skipped and the step keeps its status

### Requirement: Panel step actions use the server's step update

The panel's Skip and Restore actions SHALL go through the same server-owned step update that `update_workflow_step` uses, sent only to the server that owns the terminal and authorised against that exact terminal and its project. They SHALL apply the step status and time rules, and SHALL be published to every client that can see the terminal. Each action SHALL carry the status the panel showed for that step, and the server SHALL refuse it with `step_changed`, changing nothing, when the step no longer holds that status. `update_workflow_step` SHALL NOT require an expected status.

#### Scenario: Terminal outside the client's reach

- **WHEN** a client sends a step update naming a terminal in a project it cannot see
- **THEN** the update is refused and no step changes

#### Scenario: The step started after the panel rendered

- **WHEN** the panel shows step 6 not started, an agent sets step 6 to running, and the user then chooses Skip on step 6
- **THEN** the update is refused with `step_changed`, step 6 stays running, and the panel says the step could not be skipped
