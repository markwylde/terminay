## ADDED Requirements

### Requirement: Step note density in the panel

The expanded workflow panel, and its narrow-pane overlay, SHALL offer a control in its header that shows step notes **Full**, cut to **2 lines**, or for **Current only**, which shows the notes of every `running`, `failed`, or `needs_input` step and no other. Full SHALL be the default. The choice SHALL change only how notes are shown: never which steps are listed, nor any note's text.

#### Scenario: Current only

- **WHEN** the user chooses Current only and step 2 failed while step 4 runs, and steps 1 and 3 have notes
- **THEN** the panel shows the notes of steps 2 and 4 and no other step's note, and still lists all of the workflow's steps

#### Scenario: Current only shows a step that needs the user

- **WHEN** the user chooses Current only, step 3 needs input with the note "Keep workflows per terminal?", and done steps 1 and 2 have notes
- **THEN** the panel shows step 3's note and no other step's note

#### Scenario: Current only with no current step

- **WHEN** the user chooses Current only and every step with a note is done or skipped
- **THEN** the panel shows no notes and lists every step

#### Scenario: A note follows its step's status

- **WHEN** the user has chosen Current only and an agent sets the running step 4 to done and step 5, which has a note, to running
- **THEN** step 4's note is no longer shown and step 5's note is shown

#### Scenario: 2 lines

- **WHEN** the user chooses 2 lines and a done step's note runs to five lines at the panel's width
- **THEN** the panel shows the first two lines of that note and every step's title

#### Scenario: Back to Full

- **WHEN** the user chooses 2 lines, then Full
- **THEN** every step's note is shown in full again

#### Scenario: Full by default

- **WHEN** a device has never chosen a note density
- **THEN** the expanded panel shows every step's note in full

#### Scenario: The rail shows no notes

- **WHEN** the user has chosen Full and collapses the panel
- **THEN** the rail shows the step markers and the workflow name and no note

#### Scenario: Choosing a density in the overlay

- **WHEN** the user opens the overlay in a narrow pane and chooses Current only from its header with the keyboard
- **THEN** the overlay stays open showing notes for Current only, the terminal receives no input, Escape still closes the overlay, and reopening it shows Current only

#### Scenario: The header at the narrowest panel

- **WHEN** the panel is drawn at its 200-pixel minimum, or the overlay narrower than that, with a workflow name longer than the panel is wide
- **THEN** the name wraps, and the density control and the collapse control are both fully visible and usable

### Requirement: Panel note density is a device-local setting

The panel's note density SHALL be a device-local user setting, kept and shared exactly as the panel's collapse setting is, separate from Home's Workflows view, and SHALL NOT be stored on the server or in a template.

#### Scenario: One choice for every terminal

- **WHEN** two terminals in split panes of one window show expanded workflow panels and the user chooses 2 lines in one of them
- **THEN** both panels show notes cut to two lines, and other devices are unchanged

#### Scenario: Home keeps its own choice

- **WHEN** Home's Workflows section shows notes Full and the user chooses Current only in a terminal's panel
- **THEN** Home's Workflows section still shows notes Full, and choosing 2 lines on Home leaves the panel at Current only

#### Scenario: The choice survives a relaunch

- **WHEN** the user chooses Current only and relaunches Terminay on that device
- **THEN** the expanded panel shows notes for Current only

#### Scenario: A stored choice that cannot be used

- **WHEN** the device's stored note density is unreadable or not one of the three choices
- **THEN** the panel shows notes in full

## MODIFIED Requirements

### Requirement: Expanded workflow panel

Expanded, the panel SHALL also show the workflow's name, how many steps are done, the time elapsed since the first step started, a collapsible brief holding the opening prompt, and each step's title, its duration once it has ended or running time while it runs, and its note as the panel's step note density allows. The `running` or `needs_input` step SHALL be highlighted. A skipped step's title SHALL be struck through and dimmed, and it SHALL show no duration and its note as the density allows.

#### Scenario: Reading the brief

- **WHEN** the user opens the brief in the expanded panel
- **THEN** it shows the workflow's opening prompt as plain text

#### Scenario: Skipped step in the expanded panel

- **WHEN** step 6 of eight is skipped with the note "not a visual change" and steps 1 to 5 are done
- **THEN** the panel shows step 6's title struck through with that note and no duration, and counts six of eight steps done

### Requirement: Step status rules

A step's status SHALL be one of `not_started`, `running`, `done`, `failed`, `needs_input`, or `skipped`, and any step MAY move to any status. `skipped` SHALL record that a step was deliberately not carried out. A step SHALL be settled when it is `done` or `skipped`. At most one step of a workflow SHALL be `running` or `needs_input` at a time. Setting a step to `running` or `needs_input` while a different step holds either status SHALL fail with `step_active`, which names the active step's id, and change nothing. A note SHALL be one line of at most 200 characters. An update that carries a note SHALL replace the step's note, an empty note SHALL clear it, and an update without a note SHALL keep it. A workflow SHALL be unfinished while any step is not settled, and finished when every step is settled. Wherever Terminay counts a workflow's steps done, shows its progress, or decides whether it is finished, a skipped step SHALL count as done.

#### Scenario: Two steps active

- **WHEN** step 5 is running and an agent sets step 6 to running
- **THEN** the call fails with `step_active` naming step 5's id, and both steps keep their status

#### Scenario: Marking a step done with a note

- **WHEN** an agent sets step 5 to done with the note "codex: 3 findings (P1, P2, P3)"
- **THEN** step 5 is done and its note is shown in the panel when the panel shows notes in full

#### Scenario: A failed step leaves the workflow unfinished

- **WHEN** every step is done except step 7, which failed
- **THEN** the workflow is unfinished and Resume is offered for that terminal

#### Scenario: Skipping a step that does not apply

- **WHEN** an agent sets step 6 to skipped with the note "not a visual change, no screenshots"
- **THEN** step 6 is skipped, its note is shown in the panel when the panel shows notes in full, and it is not shown as done

#### Scenario: Skipped steps finish a workflow

- **WHEN** every step of a workflow is done except step 6, which is skipped
- **THEN** the workflow is finished, its tab counts every step, and the Command Bar does not list Resume workflow
