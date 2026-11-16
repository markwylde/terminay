## MODIFIED Requirements

### Requirement: Workflows widget

The Workflows widget SHALL list every workflow attached to a running terminal of the server whose panels the window holds, each with its progress dial, its step bar, its current step in words as the workflow names it, and how many steps are done. Unfinished workflows SHALL come first: those with a step needing input or failed, then those with a step running, then the rest; finished workflows SHALL follow, most recently finished first. The current step SHALL be the first of the workflow's current steps. Elapsed time SHALL be the time since the current step started, and SHALL be shown only while that step is running or needs input. A workflow that could not be restored SHALL be listed as such.

#### Scenario: A running workflow

- **WHEN** a terminal's workflow has three of eight steps done and a step running
- **THEN** the Workflows widget shows that terminal with its dial, the running step's title, "3 of 8", and the time since the step started, and activating it activates that terminal

#### Scenario: Several steps running

- **WHEN** a terminal's workflow has "Server", "UI", and "Docs" running
- **THEN** the Workflows widget names its current step "Server + 2 more" and shows the time since "Server" started

#### Scenario: A finished workflow

- **WHEN** a terminal's workflow has every step done
- **THEN** it is listed after every unfinished workflow, with a full dial

### Requirement: Workflow column content

Each column SHALL show the workflow's name, its project and terminal title, steps done out of total, the time since its first step started or that it is finished, a collapsible brief holding the opening prompt, and each step's marker, time, and note as the expanded vertical workflow panel shows them, in the same arrangement and brackets. Every `running`, `failed`, or `needs_input` step SHALL be highlighted. All workflow text SHALL be rendered as plain text.

#### Scenario: Running step

- **WHEN** a workflow has three of seven steps done with notes, and its fourth step has been running for 14 minutes
- **THEN** its column shows "3 of 7 done", the three notes, and the fourth step highlighted with "14m"

#### Scenario: Earlier failure and a running step

- **WHEN** step 2 failed and step 4 is running
- **THEN** both steps are highlighted

#### Scenario: Parallel steps in a column

- **WHEN** a workflow's "Codex review" and "Spec review" each wait only on "Propose"
- **THEN** its column shows them as two tracks of a bracket after "Propose"

#### Scenario: Note containing markup

- **WHEN** a step's note is `<img src=x onerror=alert(1)>`
- **THEN** the column shows those characters and nothing else happens
