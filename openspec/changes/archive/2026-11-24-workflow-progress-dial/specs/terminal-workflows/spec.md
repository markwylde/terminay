## MODIFIED Requirements

### Requirement: Workflow progress on the terminal tab

A terminal's tab SHALL show its workflow's progress as a progress dial: a ring whose filled arc is the share of the workflow's steps that are `done`, with no count drawn as text. The dial SHALL be red while any step is `failed` or `needs_input`, otherwise amber while a step is `running`, otherwise green when every step is `done`, and otherwise grey. A workflow the server cannot restore SHALL show a full red ring. A terminal without a workflow SHALL show no dial.

#### Scenario: Needs input

- **WHEN** an agent sets a step to `needs_input` with the note "Keep workflows per terminal?"
- **THEN** that step's marker is red with an exclamation mark, the note is shown, and the terminal's tab shows a red dial

#### Scenario: Running step

- **WHEN** a terminal's workflow has three of eight steps done and the fourth running
- **THEN** its tab shows an amber dial filled three eighths of the way round, and no `3/8` text

#### Scenario: Failed beside a running step

- **WHEN** one step has failed and another is running
- **THEN** the dial is red

#### Scenario: Between steps

- **WHEN** three of eight steps are done and none is running, failed, or needing the user
- **THEN** the dial is grey and filled three eighths of the way round

#### Scenario: Unrestorable workflow

- **WHEN** the server cannot restore a terminal's workflow
- **THEN** its tab shows a full red ring

#### Scenario: No workflow

- **WHEN** a terminal has no workflow
- **THEN** its tab shows no dial

## ADDED Requirements

### Requirement: The tab's dial keeps its place

The tab's dial SHALL sit at the end of the tab, immediately before the close button, in a slot of fixed size that does not move when the close button is shown or hidden. It SHALL keep its size when the tab is too narrow for its title, the title being shortened instead.

#### Scenario: Narrow tab

- **WHEN** a terminal's tab is too narrow to show its whole title
- **THEN** the title is shortened with an ellipsis and the dial keeps its size beside the close button

#### Scenario: Hovering the tab

- **WHEN** the pointer moves onto a tab with a workflow and its close button becomes visible
- **THEN** the dial stays where it was

### Requirement: Workflow progress in terminal lists

A terminal's row in the Tabs sidebar, and its row in the compact switcher, SHALL show the same progress dial as its tab whenever its tab would show one, at the right end of the row's title area. The row's title SHALL be shortened before the dial is.

#### Scenario: Sidebar row

- **WHEN** a terminal's workflow has three of eight steps done and the fourth running
- **THEN** its Tabs sidebar row shows an amber dial filled three eighths of the way round at the row's right end

#### Scenario: Compact switcher row

- **WHEN** the workspace is at phone width and the user opens the compact switcher
- **THEN** a terminal with a workflow shows its dial in its row

### Requirement: A finished workflow's dial hides once seen

When every step of a terminal's workflow is `done`, its dial SHALL show full and green until the user has seen that completion. A completion SHALL count as seen once its terminal has been the active terminal while the workflow was finished and then stops being active, by any means. A completion that changes before that, because a step leaves `done` or the workflow is replaced, SHALL NOT count as seen.

#### Scenario: Finishing in the background

- **WHEN** a workflow finishes while its terminal is not active
- **THEN** its tab and its rows show a full green dial

#### Scenario: Looking at the finished terminal

- **WHEN** the user makes a terminal whose workflow has finished active, then makes another terminal active
- **THEN** the first terminal's tab and rows show no dial

#### Scenario: Finishing while active

- **WHEN** a workflow finishes while its terminal is active
- **THEN** its dial shows full and green until the user makes another terminal active

#### Scenario: Reopened after being seen

- **WHEN** a seen finished workflow has a step set back to `running` and later finishes again while its terminal is not active
- **THEN** its tab shows the amber dial while it runs and a full green dial once it finishes

### Requirement: Seen completions are remembered on the device

Which completions have been seen SHALL be device-local, SHALL NOT be stored on the server, and SHALL be shared by every window of that device's client. A device SHALL remember at least its 500 most recently seen completions.

#### Scenario: Another device

- **WHEN** the user has seen a finished workflow on one device
- **THEN** another device still shows that terminal's full green dial until the user sees it there

#### Scenario: Another window

- **WHEN** two windows of the same client show the same project and the user sees a finished workflow in one
- **THEN** the other window also stops showing its dial

### Requirement: The dial is named in words

The dial SHALL have a tooltip and an accessible name that state its progress without relying on colour: the step that is `running` or `needs_input`, else the first step not `done`; how many steps are done out of the total; and, while the named step is active, the time since it started. It SHALL say when that step needs the user or is next, name any `failed` step as failed, and name a finished or unrestorable workflow as such.

#### Scenario: Running step name

- **WHEN** the fourth of eight steps, "Implement", has been running for 14 minutes and three steps are done
- **THEN** the dial's accessible name and tooltip read "Implement · 3 of 8 · 14m"

#### Scenario: Step needing the user

- **WHEN** the step "Review" needs the user and two of five steps are done
- **THEN** the dial's accessible name says that "Review" needs you and that 2 of 5 are done

#### Scenario: Failed beside running

- **WHEN** "Build" has failed and "Implement" is running
- **THEN** the dial's accessible name names "Implement" and also says that "Build" failed

#### Scenario: Time across needing the user

- **WHEN** a step started 20 minutes ago, was set to `needs_input`, and then back to `running`
- **THEN** the dial's time reads 20m
