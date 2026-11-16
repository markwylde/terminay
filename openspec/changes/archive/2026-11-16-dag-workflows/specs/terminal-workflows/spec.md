## ADDED Requirements

### Requirement: Step dependencies

Every step of a template or a workflow SHALL carry a dependency list, `after`: the ids of the steps it waits on. A step SHALL wait only on steps above it in the same template or workflow, so that no plan can loop. A template or workflow SHALL hold at most 200 dependencies in total. A save or a call whose dependencies name the step itself, a step below it, a step that is not in the template or workflow, or the same step twice SHALL be refused, naming the step, and SHALL change nothing. A step SHALL be **ready** when it is `not_started` or `failed` and every step it waits on is settled. A step with no dependencies SHALL be ready until it starts. When a template or a workflow is copied, each step's dependencies SHALL be copied with it, naming the copies' new ids.

#### Scenario: Two reviews after one proposal

- **WHEN** a workflow has "Propose", then "Codex review" and "Spec review" each waiting on "Propose", then "Amend" waiting on both reviews, and "Propose" is done
- **THEN** "Codex review" and "Spec review" are both ready and "Amend" is not

#### Scenario: A dependency on a later step

- **WHEN** a user or an agent saves a template whose step 2 waits on step 4
- **THEN** the save is refused naming step 2, and nothing changes

#### Scenario: A repeated dependency

- **WHEN** an agent creates a workflow whose step 3 lists step 1 twice in its `after`
- **THEN** the call is refused naming step 3, and no workflow is attached

#### Scenario: A skipped dependency releases its dependents

- **WHEN** "Amend" waits on "Codex review" and "Spec review", "Codex review" is done, and "Spec review" is set to skipped
- **THEN** "Amend" is ready

#### Scenario: Launching keeps the plan's shape

- **WHEN** a template whose step 3 waits on steps 1 and 2 is launched
- **THEN** the workflow's step 3 waits on the workflow's steps 1 and 2, by their new ids

### Requirement: Steps given without dependencies run in order

A step supplied without an `after` field, through a template command or an MCP call, SHALL wait on the step directly above it, and the first step on nothing, so that a plain list of steps runs one after another. A step supplied with an empty `after` SHALL wait on nothing.

#### Scenario: An agent creates a plain list

- **WHEN** an agent calls `create_workflow` with four steps and no `after` on any of them
- **THEN** each step waits on the one before it and only the first is ready

#### Scenario: Steps that start together

- **WHEN** an agent calls `create_workflow` with three steps whose `after` is empty
- **THEN** all three steps are ready

### Requirement: The vertical panel arranges steps from their dependencies

The vertical panel SHALL arrange a workflow's steps from their dependencies alone, so that two workflows with the same dependencies are drawn the same. Steps that run one after another SHALL be shown in sequence. Steps that do not wait on one another, directly or through other steps, SHALL be shown inside a bracket, as tracks; within a track, a line SHALL join steps that run one after another, and when any track of a bracket holds more than one step a dashed rule SHALL separate the tracks. Brackets SHALL nest. A bracket SHALL be coloured by the steps it holds: red when any of them needs input or failed, otherwise amber when any is running, otherwise green when all are settled, otherwise grey. The panel SHALL NOT label a bracket with words.

A step's position SHALL imply that it waits on the step before it in its track, or, when it follows a bracket, on the last step of each of that bracket's tracks. Where a step's dependencies, without those it waits on through another of its dependencies, differ from what its position implies, the expanded panel SHALL show "after" and the titles of those dependencies beneath it. It SHALL show no "after" text for any other step.

#### Scenario: Two reviews side by side

- **WHEN** a workflow has "Propose", then "Codex review" and "Spec review" each waiting on "Propose", then "Amend" waiting on both
- **THEN** the panel shows "Propose", a bracket holding "Codex review" and "Spec review" as two tracks, then "Amend", and shows no "after" text

#### Scenario: A plain list has no brackets

- **WHEN** every step of a workflow waits on the step above it
- **THEN** the panel shows every step in one sequence with no bracket

#### Scenario: A dependency the brackets cannot show

- **WHEN** "Server", "UI", and "Docs" run alongside each other, "Verify" waits on "Server" and "UI", "E2E" waits on "UI" only, and "PR" waits on "Verify", "E2E", and "Docs"
- **THEN** "Docs" is a track of its own beside a track holding "Server" and "UI" side by side followed by "Verify" and "E2E" side by side, "E2E" shows "after UI", and no other step shows "after" text

#### Scenario: Bracket colour

- **WHEN** a bracket holds a running step and a step that needs input
- **THEN** the bracket is red

### Requirement: Tracing a step's dependencies

Hovering or focusing a step in the expanded vertical panel or the expanded horizontal drawer SHALL highlight the steps it waits on, directly or through other steps, and the steps that wait on it, and SHALL dim every other step. Moving the pointer away or moving focus SHALL clear it. On a touch screen, tapping a step SHALL do the same until the user taps elsewhere.

#### Scenario: Hovering a step

- **WHEN** the user hovers "Amend" in a workflow where it waits on two reviews that wait on "Propose", and "PR" waits on "Amend"
- **THEN** "Propose", both reviews, and "PR" are highlighted and every other step is dimmed

### Requirement: Workflow layout

A terminal's workflow SHALL be shown in one of two layouts: **vertical**, the workflow panel along the right edge of the terminal's pane, or **horizontal**, the workflow drawer along the bottom edge of the pane. Either SHALL be inside the pane and not part of either workspace sidebar, and the terminal viewport SHALL end before it so that no terminal output, cursor, or input surface is covered, except by the transient overlay of a narrow pane. The layout SHALL be a device-local user setting that applies to every terminal on that device, kept and shared exactly as the panel's collapse setting is, and SHALL NOT be stored on the server or in a template. It SHALL be vertical until the user chooses otherwise, and a stored layout that is unreadable or unknown SHALL be read as vertical. Each layout SHALL keep its own collapsed or expanded setting; switching layout SHALL change neither. The horizontal layout SHALL be collapsed until the user expands it.

#### Scenario: Switching every terminal to horizontal

- **WHEN** two terminals in split panes of one window have workflows and the user chooses Horizontal in one pane's workflow options
- **THEN** both terminals show their workflow as a drawer along the bottom of their pane, and other devices are unchanged

#### Scenario: Each layout keeps its own collapse

- **WHEN** the vertical panel is expanded, the user switches to horizontal, collapses the drawer, and switches back to vertical
- **THEN** the vertical panel is expanded

#### Scenario: The layout survives a relaunch

- **WHEN** the user chooses Horizontal and relaunches Terminay on that device
- **THEN** terminals with workflows show the drawer

### Requirement: Workflow options menu

The expanded panel, the collapsed rail, the expanded drawer, and the collapsed strip SHALL each offer a ⋯ control at their top right that opens the workflow options menu. The menu SHALL offer **Show as** with **Vertical** and **Horizontal** as a choice of one, the current layout marked, followed by **Remove workflow…**. Choosing a layout SHALL apply it and close the menu. Choosing Remove workflow… SHALL replace the menu's content with a confirmation that names the workflow and offers Cancel and Remove; Remove SHALL remove the workflow, and Cancel SHALL return to the menu without changing anything. When removing fails, the menu SHALL say the workflow could not be removed and the workflow SHALL be unchanged. The menu SHALL be operable from the keyboard, Escape SHALL close it and return focus to its ⋯ control, and opening it SHALL send no input to the terminal. No other control of the panel, rail, drawer, or strip SHALL remove a workflow.

#### Scenario: Removing from the menu

- **WHEN** the user opens the ⋯ menu, chooses Remove workflow…, and then Remove
- **THEN** the workflow is removed, the panel or drawer disappears, the terminal fills the pane, and the terminal keeps running

#### Scenario: Cancelling the removal

- **WHEN** the user chooses Remove workflow… and then Cancel
- **THEN** the menu shows Show as and Remove workflow… again and the workflow is unchanged

#### Scenario: Switching layout from the collapsed rail

- **WHEN** the vertical panel is collapsed and the user opens the rail's ⋯ menu and chooses Horizontal
- **THEN** the workflow shows as a drawer at the bottom of the pane

### Requirement: Expanded workflow drawer

Expanded, the horizontal drawer SHALL show the workflow's name, how many steps are done, how many are running and need input, the time elapsed since the first step started, its ⋯ control, and a collapse control, above a metro map of the workflow. The map SHALL place each step as a station in a column one further right than the furthest of the steps it waits on, with steps that wait on nothing in the first column, and SHALL draw a line from each step to each step that waits on it: solid green once the step it leaves is done, dashed otherwise. A station SHALL show the step's marker as the rail draws it, the step's title shortened with an ellipsis to fit, and its duration once it has ended or its running time while it runs. The expanded drawer SHALL be as tall as its header and map need, and no taller than 240 pixels; when the map is wider or taller than the drawer, the map SHALL scroll inside the drawer and the terminal SHALL keep its size. Stations SHALL be reachable with Tab and movable between with the arrow keys, and Enter or a click SHALL select one. Selecting a station SHALL show that step's title, status, time, and note in full beneath the map, with the panel's Skip or Restore action when the step offers one.

#### Scenario: The drawer draws the plan

- **WHEN** a workflow has "Propose", then "Codex review" and "Spec review" each waiting on "Propose", then "Amend" waiting on both, "Propose" is done, and both reviews are running, and the drawer is expanded
- **THEN** the drawer shows "Propose" in the first column, both reviews stacked in the second column, and "Amend" in the third, with solid green lines leaving "Propose" and dashed lines into "Amend"

#### Scenario: Selecting a station from the keyboard

- **WHEN** the user tabs into the map, presses Arrow Right to reach the second station, and presses Enter
- **THEN** the drawer shows the second step's detail and the terminal receives none of those keys

#### Scenario: Selecting a station

- **WHEN** the user selects a failed station whose note is "tests timed out"
- **THEN** the drawer shows that step's title, its status, and the note "tests timed out", and offers Skip

### Requirement: Collapsed workflow strip

Collapsed, the horizontal drawer SHALL be a strip 46 pixels tall showing how many steps are done out of the total, the metro map drawn small with markers and no labels, and the workflow's current steps in words: the title of each `running` and `needs_input` step in step order, with "needs you" after a step that needs input; "Finished" when the workflow is finished; and "Waiting" otherwise. The words SHALL be shortened with an ellipsis to fit. The strip SHALL offer its ⋯ control and an expand control.

#### Scenario: Two steps running and one needing the user

- **WHEN** "Panel UI" and "Server" are running and "Docs" needs input, with five of eleven steps done, and the drawer is collapsed
- **THEN** the strip shows "5/11", the map's markers, and "Server · Panel UI · Docs needs you" in step order

### Requirement: Narrow panes keep the terminal usable in the horizontal layout

When a pane cannot show the expanded drawer, at the height its header and map need up to 240 pixels, above a terminal at least 10 rows tall, the drawer SHALL show collapsed whatever the setting is. Expanding it there SHALL open the expanded drawer as a transient overlay over the bottom of the terminal, no taller than 85% of the pane, without resizing the terminal and without changing either setting. While the overlay is open, the strip SHALL NOT be shown. The overlay SHALL close when the user presses Escape, activates the collapse control, or moves focus to the terminal, and the terminal SHALL receive no input while the overlay has focus.

#### Scenario: A short pane

- **WHEN** the horizontal setting is expanded and a terminal's pane is too short for the drawer above 10 rows
- **THEN** the strip shows and the terminal keeps its height

#### Scenario: Escape closes the menu before the overlay

- **WHEN** the drawer overlay is open in a short pane with its ⋯ menu open, and the user presses Escape
- **THEN** the menu closes, focus returns to the ⋯ control, and the overlay stays open; a second Escape closes the overlay

#### Scenario: Closing the drawer overlay

- **WHEN** the user expands the drawer in a short pane and presses Escape
- **THEN** the overlay closes, the strip shows again, the terminal is focused, and the setting is unchanged

### Requirement: The template outline sets dependencies

The template editor's outline SHALL be the plan's shape. Saving after the outline's shape has changed SHALL set every step's dependencies from it, as the next requirement qualifies: a step SHALL wait on the step before it in its track; the first step of a track SHALL wait on what its bracket waits on; a step that follows a bracket SHALL wait on the last step of each of that bracket's tracks; and the first step of the outline SHALL wait on nothing. The steps SHALL be saved in outline order, a track's steps before the next track's. Opening a template SHALL show it in the arrangement the vertical panel would draw.

#### Scenario: Adding a step alongside

- **WHEN** a template has "Propose" then "Review", and the user chooses "+ alongside" on "Review", names the new step "Spec review", and saves
- **THEN** "Review" and "Spec review" each wait on "Propose", and the editor shows them as two tracks of a bracket

#### Scenario: Adding a step after a bracket

- **WHEN** the user chooses "+ Add step at the end" after a bracket of two tracks, names it "Amend", and saves
- **THEN** "Amend" waits on the last step of each track

#### Scenario: Another track alongside

- **WHEN** the user chooses "+ another track alongside" on a bracket of two tracks
- **THEN** the bracket shows three tracks, the new one holding one new step

### Requirement: Dependencies the outline cannot show

When a template holds a dependency that its arrangement does not imply, the editor SHALL show "after" and the titles of those dependencies beneath the step, as the vertical panel does, and SHALL say that changing the outline's shape replaces them. Saving after editing only names, icons, prompts, or other fields SHALL keep every step's dependencies. Saving after adding, removing, moving, or placing a step alongside another SHALL set every step's dependencies from the outline. When the dependencies the outline implies would break the dependency bound, the save SHALL be refused, the editor SHALL say how many dependencies the outline implies and the bound, and the template SHALL be unchanged.

#### Scenario: Editing a prompt keeps a partial dependency

- **WHEN** a template's "E2E" waits only on "UI" while "Verify" waits on "Server" and "UI", and the user edits "E2E"'s prompt and saves
- **THEN** "E2E" still waits only on "UI"

#### Scenario: An outline that implies too many dependencies

- **WHEN** a template has 25 steps that wait on nothing and 25 steps each waiting on two of them, the editor draws them as two layers, and the user removes one step and saves
- **THEN** the save is refused naming the 600 implied dependencies and the bound of 200, and the template is unchanged

#### Scenario: Changing the shape replaces it

- **WHEN** the user adds a step at the end of that template and saves
- **THEN** "E2E" waits on the last step of each track of the bracket before it, as the outline implies

### Requirement: Current steps named in words

A workflow's current steps SHALL be its steps that need input, then its running steps, each in step order; when none is active, its first failed step; otherwise its first ready step. Wherever Terminay names a workflow's current step in words — the terminal tab's description, the switcher's second line, and Home — it SHALL name the first current step, followed by "needs you" when it needs input, and, when more than one step is active, how many others are, as "Server + 2 more". The collapsed strip SHALL instead list every active step, as its own requirement states.

#### Scenario: Several steps running

- **WHEN** "Server", "UI", and "Docs" are running and no step needs input
- **THEN** the terminal's switcher row says "Server + 2 more"

#### Scenario: A step needing input comes first

- **WHEN** "Server" and "UI" are running and "Docs" needs input
- **THEN** the switcher row and the Workflows widget say "Docs needs you + 2 more", and the collapsed strip says "Server · UI · Docs needs you" in step order

## MODIFIED Requirements

### Requirement: Workflow templates

A workflow template SHALL have a name, a description, at most one category, an opening prompt, and an ordered list of one to 50 steps. Each step SHALL have a stable id, a title, a prompt, an optional icon, and a dependency list. A step's id SHALL be assigned by the server when the step is created and SHALL NOT change when the step is renamed, edited, or moved. A template SHALL be rejected when its name is empty, when it has no step, when a step's title is empty, or when its dependencies break the dependency rules. Two steps MAY share a title.

#### Scenario: Two steps with the same title

- **WHEN** a user saves a template with two steps titled "Fix findings"
- **THEN** the template is saved and each step keeps its own id

#### Scenario: Renaming a step keeps its id

- **WHEN** a user renames a saved step and saves the template again
- **THEN** the step's id is unchanged

#### Scenario: Template without steps

- **WHEN** a user tries to save a template that has no step
- **THEN** the save is refused and the editor names the problem

### Requirement: Workflow size bounds

Templates and workflows SHALL share one set of bounds: a name and each step title of at most 120 characters, an opening prompt and each step prompt of at most 8 KiB, at most 200 dependencies, a step id given in a request of at most 64 characters, and a serialized size of at most 56 KiB. The serialized size SHALL be the larger of two lengths in bytes: the JSON encoding of the name, opening prompt, and every step's title, prompt, icon, given id, and dependencies exactly as the request carries them; and the same encoding with every step id and dependency written as the server-assigned id that `get_workflow` returns. Escaping SHALL be counted in both. The bound SHALL keep a `create_workflow` request, with its envelope, within the ordinary MCP request frame, and a `get_workflow` response within the ordinary MCP response bound. Text over a bound SHALL be refused, never truncated.

#### Scenario: Largest workflow through MCP

- **WHEN** an agent calls `create_workflow` through the stdio adapter with 50 steps whose serialized size is exactly 56 KiB and whose prompts are mostly quotes, backslashes, and control characters, then calls `get_workflow`
- **THEN** both calls succeed and `get_workflow` returns every prompt in full

#### Scenario: Over the serialized bound

- **WHEN** a user saves a template whose serialized size is over 56 KiB
- **THEN** the save is refused and the editor shows the size and the bound

#### Scenario: Long request ids count against the bound

- **WHEN** an agent calls `create_workflow` through the stdio adapter with 50 steps given 64-character ids and 200 dependencies, sized so the request's own encoding is just over 56 KiB while its encoding with server ids is under it
- **THEN** the call fails with `bad_request` naming the size and the bound, and no workflow is attached

#### Scenario: Too many dependencies

- **WHEN** an agent calls `create_workflow` with 201 dependencies across its steps
- **THEN** the call fails with `bad_request` and no workflow is attached

### Requirement: Template editor

The editor SHALL edit the name, description, category, opening prompt, and steps. The steps SHALL be edited as an outline drawn as the vertical panel draws a workflow, with brackets for steps that run alongside each other. Each step SHALL offer an icon picker of the fixed icon set, a title, a prompt, a remove control, "+ then", which adds a step directly after it in its track, and "+ alongside", which adds a step that runs alongside it. Each bracket SHALL offer "+ another track alongside", and the outline SHALL end with "+ Add step at the end". Removing a track's last step SHALL remove that track, and a bracket left with one track SHALL become a sequence. A step SHALL be moved within its track by dragging or by Alt+Arrow Up and Alt+Arrow Down on its handle. The editor SHALL show the text that launching the template types into the terminal. No template field SHALL choose whether the workflow panel is collapsed or expanded, or its layout.

#### Scenario: Reordering a step from the keyboard

- **WHEN** a track holds three steps and the user focuses the third step's handle and presses Alt+Arrow Up
- **THEN** it becomes the track's second step and its handle keeps focus

#### Scenario: Choosing a step icon

- **WHEN** the user opens a step's icon picker and chooses the wrench
- **THEN** the step shows the wrench in the editor and in the workflow panel after the template is launched

#### Scenario: Removing a track's only step

- **WHEN** a bracket has two tracks of one step each and the user removes one of those steps
- **THEN** the bracket is gone and the remaining step sits in sequence where the bracket was

### Requirement: A workflow belongs to one terminal session

A workflow SHALL be a server-owned record with its own id, bound to exactly one terminal session. A terminal session SHALL have at most one workflow. A workflow SHALL hold a name, an opening prompt, and an ordered list of steps, each with a stable id, a title, a prompt, an optional icon, a dependency list, a status, an optional note, and the times it started and ended. A workflow created from a template SHALL hold a copy of the template's steps at launch, and later edits to the template SHALL NOT change it. A workflow SHALL follow its terminal when the terminal moves between projects, and SHALL be visible only to clients that can see that terminal.

#### Scenario: Editing a template after launch

- **WHEN** a user launches a template, then renames one of its steps in Settings and saves
- **THEN** the running workflow keeps the original step title

#### Scenario: Terminal moved to another project

- **WHEN** a terminal with a workflow is moved to another project
- **THEN** its workflow panel appears with it in the new project

### Requirement: Step status rules

A step's status SHALL be one of `not_started`, `running`, `done`, `failed`, `needs_input`, or `skipped`. `skipped` SHALL record that a step was deliberately not carried out. A step SHALL be settled when it is `done` or `skipped`, and active when it is `running` or `needs_input`. Any number of steps MAY be active at once. A step SHALL start when it moves to `running` or `needs_input` from a status that is not active, or to `done` from `not_started`. Starting a step while any step it waits on is not settled SHALL fail with `step_blocked`, which names every such step's id, and change nothing. Dependencies SHALL constrain only starting: any other change of status SHALL be allowed, so a step already under way can move between `running` and `needs_input` and finish even when a step it waits on has since been reopened. A note SHALL be one line of at most 200 characters. An update that carries a note SHALL replace the step's note, an empty note SHALL clear it, and an update without a note SHALL keep it. A workflow SHALL be unfinished while any step is not settled, and finished when every step is settled. Wherever Terminay counts a workflow's steps done, shows its progress, or decides whether it is finished, a skipped step SHALL count as done.

#### Scenario: Two steps active

- **WHEN** "Codex review" and "Spec review" each wait only on "Propose", which is done, and an agent sets both to running
- **THEN** both calls succeed and both steps are running

#### Scenario: Starting a step too early

- **WHEN** "Amend" waits on "Codex review" and "Spec review", "Codex review" is done and "Spec review" is running, and an agent sets "Amend" to running
- **THEN** the call fails with `step_blocked` naming "Spec review"'s id, and every step keeps its status

#### Scenario: A reopened dependency does not strand a running step

- **WHEN** "Build" waits on "Plan", "Plan" is skipped, "Build" is running, and "Plan" is then restored to not started
- **THEN** "Build" can still be set to needs_input, back to running, and to done

#### Scenario: Finishing again with a new note

- **WHEN** a done step's dependency has been restored to not started and an agent sets the step to done again with a new note
- **THEN** the call succeeds and the note changes

#### Scenario: Marking a step done with a note

- **WHEN** an agent sets step 5 to done with the note "codex: 3 findings (P1, P2, P3)"
- **THEN** step 5 is done and its note is shown in the panel when the panel shows notes in full

#### Scenario: A failed step leaves the workflow unfinished

- **WHEN** every step is done except step 7, which failed
- **THEN** the workflow is unfinished and Resume is offered for that terminal

#### Scenario: Skipping a step that does not apply

- **WHEN** an agent sets step 6 to skipped with the note "not a visual change, no screenshots"
- **THEN** step 6 is skipped, its note is shown in the panel when the panel shows notes in full, and it is not shown as done

#### Scenario: Skipping a step that waits on others

- **WHEN** a step waits on a step that is not started, and an agent sets it to skipped
- **THEN** the step is skipped

#### Scenario: Skipped steps finish a workflow

- **WHEN** every step of a workflow is done except step 6, which is skipped
- **THEN** the workflow is finished, its tab counts every step, and the Command Bar does not list Resume workflow

### Requirement: Workflow panel in the terminal pane

In the vertical layout, a terminal with a workflow SHALL show a workflow panel along the right edge of its pane, and the terminal viewport SHALL end to the left of the panel. In the horizontal layout, it SHALL show a workflow drawer along the bottom edge of its pane, and the terminal viewport SHALL end above the drawer. A terminal without a workflow SHALL have no panel or drawer and SHALL fill its pane. Each terminal pane in a split SHALL show its own terminal's workflow.

#### Scenario: Split panes

- **WHEN** two terminals in a split each have a workflow
- **THEN** each pane shows its own terminal's workflow at its own right edge

#### Scenario: Split panes in the horizontal layout

- **WHEN** the layout is horizontal and two terminals in a split each have a workflow
- **THEN** each pane shows its own terminal's workflow along its own bottom edge

### Requirement: Collapsed workflow rail

Collapsed, the vertical panel SHALL be a narrow rail of one marker per step, arranged as the expanded panel arranges them: steps in sequence joined by a line, and each bracket drawn as a capsule around its tracks, coloured as the bracket is, with a short rule between tracks when any track holds more than one step. The rail SHALL be 36 pixels wide, wider by 8 pixels for each level a capsule nests inside another, and never wider than 72 pixels. A marker SHALL show the step's icon, or, when the step has none, a check for `done`, a dot for `running`, a cross for `failed`, an exclamation mark for `needs_input`, a dash for `skipped`, and nothing for `not_started`. The marker SHALL be filled green for `done`, outlined amber for `running`, filled red for `failed` and `needs_input`, outlined grey for `not_started`, and dashed grey and dimmed for `skipped`. Each marker SHALL have an accessible name made of the step's title and status. At the foot of the rail, below the markers, the rail SHALL show the workflow's name rotated to read from bottom to top, shortened with an ellipsis when the rail is too short for it.

#### Scenario: Collapsed rail

- **WHEN** a terminal's workflow is a plain list with four steps done, one running, and five not started, and the panel is collapsed
- **THEN** the rail is 36 pixels wide and shows four green markers, one amber marker, and five grey markers in order, and the terminal ends to the left of the rail

#### Scenario: A nested bracket widens the rail

- **WHEN** a workflow's arrangement holds a bracket inside another bracket and the panel is collapsed
- **THEN** the rail is 44 pixels wide and shows a capsule inside a capsule

#### Scenario: The rail's width is bounded

- **WHEN** a workflow's brackets nest six levels deep and the panel is collapsed
- **THEN** the rail is 72 pixels wide

#### Scenario: Step without an icon

- **WHEN** a done step has no icon
- **THEN** its marker shows a check

#### Scenario: Skipped step on the rail

- **WHEN** a step with an icon is skipped and the panel is collapsed
- **THEN** its marker shows its icon, dashed grey and dimmed, distinct from both a done marker and a not-started marker, and its accessible name ends with "skipped"

### Requirement: Expanded workflow panel

Expanded, the vertical panel SHALL also show the workflow's name, how many steps are done, how many are running and need input, the time elapsed since the first step started, a collapsible brief holding the opening prompt, and each step's title, its duration once it has ended or running time while it runs, and its note as the panel's step note density allows, in the arrangement its dependencies give. Every `running` or `needs_input` step SHALL be highlighted. A skipped step's title SHALL be struck through and dimmed, and it SHALL show no duration and its note as the density allows.

#### Scenario: Reading the brief

- **WHEN** the user opens the brief in the expanded panel
- **THEN** it shows the workflow's opening prompt as plain text

#### Scenario: Skipped step in the expanded panel

- **WHEN** step 6 of eight is skipped with the note "not a visual change" and steps 1 to 5 are done
- **THEN** the panel shows step 6's title struck through with that note and no duration, and counts six of eight steps done

#### Scenario: Two steps highlighted

- **WHEN** two steps in a bracket are running
- **THEN** both are highlighted and the panel says two are running

### Requirement: Panel collapse is a device-local setting

The vertical panel and the horizontal drawer SHALL each offer a control that toggles between collapsed and expanded. Each layout's choice SHALL be a device-local user setting that applies to every terminal on that device, and SHALL NOT be stored on the server or in a template.

#### Scenario: Expanding on one terminal

- **WHEN** the user expands the panel on one terminal
- **THEN** the workflow panel of every terminal on that device is expanded, and other devices are unchanged

#### Scenario: Expanding the drawer on one terminal

- **WHEN** the layout is horizontal and the user expands the drawer on one terminal
- **THEN** the workflow drawer of every terminal on that device is expanded, and the vertical panel's setting is unchanged

### Requirement: Launch text

Launching SHALL create the terminal's workflow from the template with every step `not_started`, then type the launch text into the terminal and submit it once. The launch text SHALL be `/goal `, followed by the template's opening prompt, followed by a fixed instruction: call `get_workflow`; start a step only once every step in its `after` list is done or skipped; steps that are ready at the same time may be worked at the same time; set each step to `running` before starting it, follow its prompt, and set it to `done` with a one-line note, `failed` with the reason, or `needs_input` when it needs the user; set a step it has been told to drop, or that does not apply, to `skipped` with a one-line reason; and continue until every step is done or skipped. The launch text SHALL be bounded to 16 KiB, and a launch over the bound SHALL be refused before anything changes.

Typing SHALL write the text as one line, with each line break or tab, and the whitespace around it, replaced by a single space. It SHALL write that line without bracketed-paste markers, whether or not the terminal has enabled bracketed paste, in chunks of at most 128 characters with a pause of about 10 ms between chunks, so a program that reads its own keyboard, such as Claude Code, receives typed keys and not a paste. The Enter that submits the text SHALL be written on its own, about 50 ms after the last chunk, never in the same write as text. Typing SHALL stop, without writing the rest of the text or the Enter, when the launch or resume request is cancelled or a write fails. The workflow template editor's launch preview SHALL show the same one-line text.

#### Scenario: Launching a template

- **WHEN** the user opens the Command Bar on a terminal running an agent and chooses `openspec:standard-flow`
- **THEN** the terminal's workflow panel shows the template's ten steps not started, and the launch text is typed into that terminal and submitted once

#### Scenario: Claude Code runs the goal

- **WHEN** a workflow is launched into a terminal running Claude Code, and its launch text is longer than 1 KB
- **THEN** Claude Code receives the text as typed keys, not as pasted text, and runs `/goal` with it

#### Scenario: Typed, never pasted

- **WHEN** a workflow is launched into a terminal whose program has enabled bracketed paste
- **THEN** no bracketed-paste marker is written, no write before the Enter carries more than 128 characters or a line break, and the Enter arrives in a write of its own after a pause

#### Scenario: Launch cancelled while typing

- **WHEN** the launch request is cancelled after some chunks of the launch text are written
- **THEN** no further chunk and no Enter is written, and a later launch or resume on that terminal types normally

#### Scenario: A multi-line opening prompt

- **WHEN** a template whose opening prompt has two paragraphs is launched
- **THEN** both paragraphs are typed on one line, separated by a space, and the text is submitted once

#### Scenario: Oversized launch text

- **WHEN** a template's opening prompt makes its launch text longer than 16 KiB
- **THEN** the launch is refused, no workflow is attached, and nothing is written to the terminal

#### Scenario: The instruction names skipping

- **WHEN** a template is launched
- **THEN** the launch text tells the agent to set a step it is told to drop to `skipped` with a reason, and to continue until every step is done or skipped

#### Scenario: The instruction names dependencies

- **WHEN** a template is launched
- **THEN** the launch text tells the agent to start a step only once every step in its `after` list is done or skipped, and that ready steps may be worked at the same time

### Requirement: Resuming a workflow

While the active terminal's workflow is unfinished, the Command Bar SHALL list **Resume workflow** with the workflow's name above every other workflow entry. Choosing it SHALL type the resume text into that terminal and submit it once, as launching does, and SHALL change no step. The resume text SHALL be `/goal `, followed by the workflow's opening prompt, followed by a fixed instruction to call `get_workflow`, treat it as the source of truth, continue every active step and then every other step that is not done or skipped as its dependencies allow, starting from the resume point, with ready steps worked at the same time when possible, and set a step that does not apply to `skipped` with a one-line reason.

#### Scenario: Agent session restarted mid-run

- **WHEN** a workflow has steps 1 to 4 done and step 5 running, the user starts a new agent session in the terminal, and chooses Resume workflow
- **THEN** the resume text is typed and submitted, and steps 1 to 5 keep their status

#### Scenario: Resume is typed, never pasted

- **WHEN** the user chooses Resume workflow on a terminal whose program has enabled bracketed paste
- **THEN** the resume text is typed as one line in chunks of at most 128 characters with no bracketed-paste marker, and the Enter arrives in a write of its own

#### Scenario: Finished workflow

- **WHEN** every step of the active terminal's workflow is done
- **THEN** the Command Bar does not list Resume workflow

### Requirement: The resume point

A workflow's resume point SHALL be its first active step in step order when it has one; otherwise its first ready step; otherwise its first step that is not settled. `get_workflow` SHALL return the resume point's step id and the ids of every ready step in step order, and the resume instruction SHALL tell the agent to continue from the resume point and every other active step, and then go on to every other step that is not settled, as its dependencies allow, including steps before the resume point.

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

#### Scenario: A blocked step is not the resume point

- **WHEN** no step is active, step 2 is not started and waits on step 1, which failed, and step 3 waits on nothing and is not started
- **THEN** the resume point is step 1, and `get_workflow` lists steps 1 and 3 as ready

### Requirement: Workflow MCP tools

Terminay SHALL expose `create_workflow`, `get_workflow`, and `update_workflow_step`. Each SHALL take an optional terminal and act on the calling terminal when none is given. A given terminal SHALL be resolved within the caller's reach, and one outside it SHALL fail with `terminal_not_found`. A step SHALL be addressed only by its id, never by its title or position.

- `create_workflow` takes either a `template_id`, or a name, an optional opening prompt, and one to 50 steps each with a title, a prompt, an optional icon, an optional `id`, and an optional `after`, under the workflow size bounds. A step's `after` SHALL name earlier steps of the same request by the `id` given to them; the server SHALL assign every step a new id and map `after` to the new ids. It also takes an optional `replaceWorkflowId`. It attaches a new workflow with every step `not_started` and returns the workflow with its id and step ids. With a `template_id`, the workflow SHALL be a copy of that template's name, opening prompt, steps, and dependencies, recording the template it came from, with new workflow and step ids. A call that gives both a `template_id` and a name, opening prompt, or steps SHALL fail with `bad_request`. A call whose `after` names an id given to no earlier step of the request, or whose given ids repeat, SHALL fail with `bad_request` naming the step. An unknown `template_id` SHALL fail with `template_not_found`. `create_workflow` SHALL fail with `workflow_exists`, naming the attached workflow's id, when the terminal has an unfinished workflow whose id is not `replaceWorkflowId`. Every refusal SHALL change nothing.
- `get_workflow` returns the terminal's workflow: its id, name, opening prompt, resume point, ready step ids, every step's id, title, prompt, icon, `after`, status, note, and times, and the id of the template it was copied from, or none. It SHALL fail with `no_workflow` when the terminal has none.
- `update_workflow_step` takes a step id, a status, and an optional note, and applies the step status and time rules. An unknown step id SHALL fail with `step_not_found` and change nothing.

#### Scenario: Agent creates its own workflow

- **WHEN** an agent in a terminal calls `create_workflow` with five steps and no terminal
- **THEN** the calling terminal shows a workflow panel with five steps not started, and the result carries the workflow id and the five step ids

#### Scenario: Agent creates a workflow with parallel steps

- **WHEN** an agent calls `create_workflow` with steps given the ids "a", "b", and "c", where "b" and "c" each have `after` ["a"]
- **THEN** the result's steps have server-assigned ids, the second and third steps' `after` each name the first step's new id, and the panel shows the second and third steps in a bracket

#### Scenario: Agent names a step that is not in the request

- **WHEN** an agent calls `create_workflow` with a step whose `after` names "z" and no step is given the id "z"
- **THEN** the call fails with `bad_request` naming that step and no workflow is attached

#### Scenario: Agent starts a workflow from a template

- **WHEN** an agent calls `create_workflow` with the id of a template that has four steps
- **THEN** the calling terminal shows a workflow panel with the template's name and its four step titles not started, the result carries step ids that differ from the template's step ids, and nothing is written to the terminal

#### Scenario: Template edited after an agent started it

- **WHEN** an agent starts a workflow from a template and the template's first step is then renamed
- **THEN** the terminal's workflow keeps the original title

#### Scenario: Template id together with steps

- **WHEN** an agent calls `create_workflow` with a `template_id` and a list of steps
- **THEN** the call fails with `bad_request` and no workflow is attached

#### Scenario: Unknown template

- **WHEN** an agent calls `create_workflow` with a `template_id` that names no template on its server
- **THEN** the call fails with `template_not_found` and the terminal's workflow is unchanged

#### Scenario: Reading back after a restart

- **WHEN** an agent whose session was restarted calls `get_workflow`
- **THEN** it receives every step's prompt, status, and `after`, the resume point, and the ready step ids

#### Scenario: Unknown step id

- **WHEN** an agent calls `update_workflow_step` with an id that is not in the workflow
- **THEN** the call fails with `step_not_found` and no step changes

#### Scenario: Terminal outside the caller's reach

- **WHEN** an agent in a project terminal calls `get_workflow` with a terminal in another project
- **THEN** the call fails with `terminal_not_found`

#### Scenario: Creating over an unfinished workflow

- **WHEN** an agent calls `create_workflow` on a terminal whose workflow is unfinished, without that workflow's id as `replaceWorkflowId`
- **THEN** the call fails with `workflow_exists` naming the attached workflow, and it is unchanged

### Requirement: Workflow errors reach the agent intact

`workflow_exists`, `no_workflow`, `step_not_found`, `step_blocked`, and `template_not_found` SHALL be MCP error codes returned through the control endpoint and the stdio adapter unchanged, never mapped to `internal` or another code. `workflow_exists` SHALL carry the id it names, `step_blocked` SHALL carry the ids of the steps that are not settled, and `template_not_found` SHALL carry the template id it was given.

#### Scenario: Active step reported through stdio

- **WHEN** an agent's `update_workflow_step` call through the stdio adapter is refused because the step waits on step 5, which is running
- **THEN** the agent receives `step_blocked` with step 5's id

#### Scenario: Missing template reported through stdio

- **WHEN** an agent's `delete_workflow_template` call through the stdio adapter names a template that does not exist
- **THEN** the agent receives `template_not_found` with that id

### Requirement: Workflow template MCP tools

Terminay SHALL expose `list_workflow_templates`, `get_workflow_template`, `create_workflow_template`, `update_workflow_template`, and `delete_workflow_template` over the templates of the server that owns the MCP endpoint, the same templates Settings > Workflows and the Command Bar list. They SHALL take no terminal and SHALL be available to both reaches and to chats. A template SHALL be addressed only by its id. An unknown template id SHALL fail with `template_not_found` and change nothing.

- `list_workflow_templates` returns every template in saved order, each with its id, name, description, category, and step count, and the category list in order.
- `get_workflow_template` takes a template id and returns its id, name, description, category, opening prompt, and every step's id, title, prompt, icon, and `after`.
- `create_workflow_template` takes a name, an optional description, an optional category, an optional opening prompt, and one to 50 steps each with a title, an optional prompt, an optional icon, an optional `id`, and an optional `after` naming earlier steps of the request by the `id` given to them. The server SHALL assign the template id and every step id, and map `after` to them. The template SHALL be added after every existing template. It returns the saved template.
- `update_workflow_template` takes a template id and any of name, description, category, opening prompt, and steps. A field given SHALL replace that field, and a field left out SHALL keep it. Steps given SHALL replace the whole step list in the order given. A given step that carries the id of one of that template's steps SHALL keep that id, and any other step SHALL get a new id. A step's `after` SHALL name earlier steps of the request by the `id` given to them. It returns the saved template.

In `create_workflow_template` and `update_workflow_template`, a request whose given step ids repeat, or whose `after` names an id given to no earlier step of the request or names one step twice, SHALL fail with `bad_request` naming the step and change nothing.
- `delete_workflow_template` takes a template id and removes that template. Its category SHALL remain.

#### Scenario: Agent saves a reusable template

- **WHEN** an agent in a project terminal calls `create_workflow_template` with the name "Release", the category "Shipping", and three steps, and the request is permitted
- **THEN** Settings > Workflows on every client of that server lists "Release · 3 steps" under a new "Shipping" category, and the Command Bar offers it on that server's terminals

#### Scenario: Renaming one step keeps the others' ids

- **WHEN** an agent reads a template with `get_workflow_template` and calls `update_workflow_template` with the same steps, the second retitled
- **THEN** every step keeps its id and its `after`, and only the second step's title changes

#### Scenario: Partial update

- **WHEN** an agent calls `update_workflow_template` with only a new description
- **THEN** the template's description changes and its name, category, opening prompt, and steps are unchanged

#### Scenario: Deleting a template that a terminal used

- **WHEN** a terminal's workflow was started from a template and an agent deletes that template
- **THEN** the template is gone from Settings and the Command Bar, and the terminal's workflow is unchanged

#### Scenario: Unknown template id

- **WHEN** an agent calls `update_workflow_template` with an id that names no template
- **THEN** the call fails with `template_not_found` and no template is created

#### Scenario: Repeated step ids in a template request

- **WHEN** an agent calls `create_workflow_template` with two steps both given the id "review"
- **THEN** the call fails with `bad_request` naming the second step and no template is saved

#### Scenario: Invalid template

- **WHEN** an agent calls `create_workflow_template` with a step whose title is empty
- **THEN** the call fails with `bad_request` naming the step and no template is saved

### Requirement: Skipping a step from the panel

The expanded workflow panel, and the expanded drawer for its selected station, SHALL offer a Skip action on each `not_started` or `failed` step, which sets it to `skipped` with the note "Skipped from the panel", and a Restore action on each `skipped` step, which sets it to `not_started`. They SHALL offer neither on a `running`, `needs_input`, or `done` step. Neither action SHALL write anything to the terminal. When the update fails, the panel or drawer SHALL say so and leave the step as the server reports it.

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

#### Scenario: Skipping a station that has since started

- **WHEN** the drawer shows a station not started, an agent sets that step to running, and the user then chooses Skip on it
- **THEN** the update is refused with `step_changed`, the step stays running, and the drawer says the step could not be skipped

#### Scenario: Skipping from the drawer

- **WHEN** the layout is horizontal and the user selects a not-started station and chooses Skip
- **THEN** the step is skipped with the note "Skipped from the panel"
