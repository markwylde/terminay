# terminal-workflows Specification

## Purpose
A terminal workflow is a server-owned checklist attached to one terminal session: the user launches it from a template, and the agent in that terminal works through its steps and reports their status through the Terminay MCP tools. Terminay shows the checklist beside the terminal and never runs a step itself.

## Requirements

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

### Requirement: Step icons come from a fixed set

A step's icon SHALL be the name of an icon in Terminay's fixed workflow icon set, or none. The set SHALL include at least a lightbulb, an eye, a wrench, code brackets, a flask, an archive box, a pull request, a terminal, a checklist, a bug, a camera, and a flag. An icon name that is not in the set SHALL be stored as none. Icons SHALL be drawn by the client from its own icon set, and no icon markup SHALL come from a template, a workflow, or an agent.

#### Scenario: Agent supplies an unknown icon

- **WHEN** an agent creates a workflow with a step whose icon is `rocket-launch`
- **THEN** the workflow is created and that step has no icon

### Requirement: Server-owned revisioned template state

Workflow templates and their categories SHALL be server-owned, revisioned state of each Terminay Server, loaded, normalised, saved, and published through the application protocol as macros are. Categories SHALL be an ordered list of unique, non-empty names, and a category SHALL persist while it holds no template. Template order SHALL be saved. A template whose stored category is not in the category list SHALL be treated as having no category. A command that carries no category list SHALL leave the stored list unchanged.

#### Scenario: A second client sees a saved template

- **WHEN** a user saves a template on one client while another client of the same server has Settings open
- **THEN** the other client lists the saved template without reopening Settings

#### Scenario: Templates survive a restart

- **WHEN** the server restarts
- **THEN** every saved template, its order, and the category order are unchanged

### Requirement: Workflows library in Settings

Settings SHALL have a **Workflows** category in its Automation group, between Macros and Recording, presented as a list column and a detail editor. It SHALL list, create, edit, reorder, and delete only the templates of the server chosen in the Settings server selector, and SHALL NEVER present two servers' templates as one list. Selecting a connection that is unavailable or incompatible SHALL show that connection's state instead of templates. The list SHALL group templates by category in category order, followed by templates with no category, and SHALL show each template's step count and mark templates with unsaved changes. It SHALL offer a filter that matches a template's name, description, category, opening prompt, and step titles and prompts.

#### Scenario: Filtering by step prompt

- **WHEN** the user types a word that appears only in one template's step prompt
- **THEN** only that template and its category are listed

#### Scenario: Editing applies to one server

- **WHEN** two attached servers each hold a template with the same id and the user edits it with server A selected
- **THEN** the edit is sent only to server A and server B's template is unchanged

### Requirement: Template ordering in Settings

Templates and categories SHALL be reorderable by dragging, and by Alt+Arrow Up and Alt+Arrow Down on a focused drag handle, with the same rules as macros and macro categories. Template order SHALL be the order in which templates appear in the Command Bar.

#### Scenario: Reordering templates sets Command Bar order

- **WHEN** the user drags a template above another in the same category and saves
- **THEN** the Command Bar lists it above that template

### Requirement: Template editor

The editor SHALL edit the name, description, category, opening prompt, and steps. The steps SHALL be edited as an outline drawn as the vertical panel draws a workflow, with brackets for steps that run alongside each other. Each step SHALL be one row showing its icon, which opens the picker of the fixed icon set, its title, editable in place, and the first line of its prompt, with "+ then", which adds a step directly after it in its track, "+ alongside", which adds a step that runs alongside it, a control that opens its prompt, and a remove control at the row's end. An open prompt SHALL be edited beneath its row in a field that grows with its text and keeps every line, and Escape SHALL close it and return focus to the step's title. A step just added SHALL open with its title focused. Each bracket SHALL offer "+ another track alongside", and the outline SHALL end with "+ Add step at the end". Removing a track's last step SHALL remove that track, and a bracket left with one track SHALL become a sequence. A step SHALL be moved within its track by dragging or by Alt+Arrow Up and Alt+Arrow Down on its handle. The editor SHALL show the text that launching the template types into the terminal. No template field SHALL choose whether the workflow panel is collapsed or expanded, or its layout.

#### Scenario: Reordering a step from the keyboard

- **WHEN** a track holds three steps and the user focuses the third step's handle and presses Alt+Arrow Up
- **THEN** it becomes the track's second step and its handle keeps focus

#### Scenario: Choosing a step icon

- **WHEN** the user opens a step's icon picker and chooses the wrench
- **THEN** the step shows the wrench in the editor and in the workflow panel after the template is launched

#### Scenario: Writing a prompt over several lines

- **WHEN** the user opens a step's prompt and types a prompt of five lines
- **THEN** the field shows all five lines, the template saves them, and once closed the row shows the prompt's first line

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

### Requirement: Workflow lifetime follows its session

A workflow SHALL last as long as its terminal session. After held terminal sessions are reattached on server start, the server SHALL restore the workflows of sessions that are running and discard the rest. A server shutdown that leaves sessions running in the session holder SHALL keep their workflows. Closing a terminal or the end of its session SHALL end its workflow. A user SHALL be able to remove a terminal's workflow from the panel, which ends it without affecting the terminal.

#### Scenario: Server restart with the terminal still running

- **WHEN** the server restarts while a terminal whose workflow has four steps done keeps running in the session holder
- **THEN** the terminal's workflow panel shows the same four steps done, the same notes, and the same running step

#### Scenario: Terminal closed

- **WHEN** a user closes a terminal that has a workflow
- **THEN** the workflow ends and is not restored after a server restart

#### Scenario: Removing a workflow

- **WHEN** a user chooses to remove the workflow from a terminal's panel
- **THEN** the panel disappears, the terminal fills the pane, and the terminal keeps running

### Requirement: Workflow records are durable canonical state

A workflow SHALL be persisted as canonical state under the server's data root in one file per terminal session, named by the session's identity and holding that session's workflow or none. Each change, including replacing one workflow with another and removing one, SHALL be a single durable replacement of that file keeping the previous committed copy, so that a session never has two committed workflows and never loses one without its replacement. A change SHALL be acknowledged to its caller, and published to clients, only after it is durably written. A change whose write fails SHALL leave the workflow as it was and SHALL fail the request that made it with `internal`. On restore, a workflow file that cannot be read, parsed, or validated SHALL be set aside with a corrupt marker and the previous committed copy used. When neither copy is valid, the terminal whose session the file names SHALL show that its workflow could not be restored and offer to remove it, that state SHALL persist across restarts until the user removes it, and the server SHALL NOT invent steps or statuses.

#### Scenario: Acknowledged update survives a crash

- **WHEN** `update_workflow_step` returns success and the server process is killed immediately afterwards while the session keeps running
- **THEN** the restarted server shows that step with the reported status

#### Scenario: Failed write

- **WHEN** writing a step update fails
- **THEN** the call fails with `internal` and the step keeps its earlier status

#### Scenario: Corrupt workflow file

- **WHEN** the server restarts and a running terminal's workflow file is corrupt but its previous copy is valid
- **THEN** the corrupt file is set aside and the panel shows the workflow from the previous copy

#### Scenario: No valid copy

- **WHEN** two held terminals have workflows and both copies of only the first terminal's file are unreadable on restart
- **THEN** only the first terminal's panel says its workflow could not be restored and offers to remove it, the second terminal's workflow is restored, and the first still shows that state after another restart

#### Scenario: Crash while replacing

- **WHEN** the server is killed at any point while replacing a terminal's workflow W1 with W2
- **THEN** after restart that terminal has exactly one workflow, W1 or W2

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

### Requirement: Narrow panes keep the terminal usable

When a pane cannot show the expanded panel at its chosen width beside a terminal at least 60 columns wide, the expanded panel SHALL show at the widest width that keeps the terminal at 60 columns, without changing the setting. When even the panel's minimum width cannot keep the terminal at 60 columns, the panel SHALL show collapsed whatever the setting is. Expanding it there SHALL open the expanded panel as a transient overlay over the right side of the terminal, at the chosen width or 85% of the pane's width if that is less, without resizing the terminal and without changing either setting. While the overlay is open, the collapsed rail SHALL NOT be shown and nothing from it SHALL be drawn over the overlay; when the overlay closes and the pane is still narrow, the rail SHALL show again. The overlay SHALL close when the user presses Escape, activates the collapse control, or moves focus to the terminal, and the terminal SHALL receive no input while the overlay has focus.

#### Scenario: The panel narrows to keep the terminal's columns

- **WHEN** the chosen width is 480 pixels, the setting is expanded, and the pane fits a 60-column terminal beside a 300-pixel panel but not beside a 480-pixel one
- **THEN** the panel shows expanded and narrower than 480 pixels, the terminal keeps at least 60 columns, and the chosen width is unchanged

#### Scenario: The panel regains its chosen width as the pane grows

- **WHEN** a pane has drawn the panel narrower than its chosen width and then becomes wide enough for it
- **THEN** the panel shows at its chosen width

#### Scenario: Expanding in a narrow pane

- **WHEN** the setting is expanded and a terminal's pane is too narrow for the panel's minimum width beside 60 columns
- **THEN** the panel shows collapsed and the terminal keeps its width

#### Scenario: The overlay replaces the rail

- **WHEN** the user expands the workflow in a narrow pane
- **THEN** the overlay shows the expanded workflow, the rail's markers and name are not shown, and the terminal keeps its width

#### Scenario: The overlay fits a narrow split pane

- **WHEN** the chosen width is 480 pixels and the user opens the overlay in a split pane 400 pixels wide
- **THEN** the overlay is 340 pixels wide and the terminal keeps its width

#### Scenario: Closing the overlay

- **WHEN** the user opens the overlay in a narrow pane and presses Escape
- **THEN** the overlay closes, the rail shows again, the terminal is uncovered and focused, and the setting is unchanged

#### Scenario: Closing the overlay with its collapse control

- **WHEN** the user opens the overlay in a narrow pane and activates its collapse control
- **THEN** the overlay closes, the rail shows again, the terminal is focused and keeps its width, and the setting is unchanged

#### Scenario: Closing the overlay by focusing the terminal

- **WHEN** the user opens the overlay in a narrow pane and moves focus to the terminal
- **THEN** the overlay closes, the rail shows again, the terminal keeps its width, and the setting is unchanged

#### Scenario: The pane widens while the overlay is open

- **WHEN** the overlay is open, the setting is expanded, and the pane becomes wide enough for the expanded panel
- **THEN** the overlay closes and the panel shows expanded beside the terminal, with no rail

### Requirement: Panel collapse is a device-local setting

The vertical panel and the horizontal drawer SHALL each offer a control that toggles between collapsed and expanded. Each layout's choice SHALL be a device-local user setting that applies to every terminal on that device, and SHALL NOT be stored on the server or in a template.

#### Scenario: Expanding on one terminal

- **WHEN** the user expands the panel on one terminal
- **THEN** the workflow panel of every terminal on that device is expanded, and other devices are unchanged

#### Scenario: Expanding the drawer on one terminal

- **WHEN** the layout is horizontal and the user expands the drawer on one terminal
- **THEN** the workflow drawer of every terminal on that device is expanded, and the vertical panel's setting is unchanged

### Requirement: Workflow progress on the terminal tab

A terminal's tab SHALL show its workflow's progress as done steps over total steps, and SHALL show a red marker while any step is `failed` or `needs_input`.

#### Scenario: Needs input

- **WHEN** an agent sets a step to `needs_input` with the note "Keep workflows per terminal?"
- **THEN** that step's marker is red with an exclamation mark, the note is shown, and the terminal's tab shows a red marker

### Requirement: Workflow text is shown as text

Workflow names, opening prompts, step titles, step prompts, and notes SHALL be rendered as plain text. No markup, link, or script in them SHALL be interpreted.

#### Scenario: Note containing markup

- **WHEN** an agent sets a note of `<img src=x onerror=alert(1)>`
- **THEN** the panel shows those characters and nothing else happens

### Requirement: Launching a workflow from the Command Bar

While the active panel is a terminal, the Command Bar SHALL list the workflow templates of the server that owns that terminal, and no other server's, in one group per category titled with the category name, in category order, followed by a group titled Workflows holding templates with no category, each in saved order. A category that holds no matching template SHALL NOT be shown. Choosing a template SHALL send the launch only to that server, which SHALL authorise it against that exact terminal and its project.

#### Scenario: Templates of the terminal's server

- **WHEN** two servers are attached and the active terminal belongs to server B
- **THEN** the Command Bar lists only server B's templates, and launching one sends the command only to server B

#### Scenario: Not offered without a terminal

- **WHEN** the active panel is a file
- **THEN** the Command Bar lists no workflow templates

### Requirement: Replacing an unfinished workflow is confirmed for that workflow

When the active terminal has an unfinished workflow, choosing a template SHALL ask the user to confirm replacing that workflow, naming it. The launch SHALL carry the id of the workflow the user confirmed replacing. The server SHALL refuse a launch with `workflow_exists` when the terminal's unfinished workflow is not the one named, including when a launch names none, and nothing SHALL change. After such a refusal the client SHALL ask again for the workflow now attached.

#### Scenario: Cancelling the confirmation

- **WHEN** the active terminal's workflow is unfinished and the user chooses a template, then cancels the confirmation
- **THEN** the existing workflow is unchanged and nothing is written to the terminal

#### Scenario: Workflow replaced while confirming

- **WHEN** the user is confirming replacing workflow W1 and an agent replaces it with W2 before the user confirms
- **THEN** the launch is refused, W2 is unchanged, and the user is asked to confirm replacing W2

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

### Requirement: Workflow tools for chats

The workflow tools SHALL NOT need a calling terminal, and SHALL be reported available to a chat capability under the same reach rules as to a terminal capability of the same scope. A chat SHALL name the terminal explicitly, and a call from a chat without a terminal SHALL fail with `bad_request` and change nothing.

#### Scenario: Project chat reads a terminal's workflow

- **WHEN** a chat with project reach calls `get_workflow` with a terminal in its project
- **THEN** it receives that terminal's workflow

#### Scenario: Chat omits the terminal

- **WHEN** a chat calls `update_workflow_step` without a terminal
- **THEN** the call fails with `bad_request` and no step changes

### Requirement: Workflow errors reach the agent intact

`workflow_exists`, `no_workflow`, `step_not_found`, `step_blocked`, and `template_not_found` SHALL be MCP error codes returned through the control endpoint and the stdio adapter unchanged, never mapped to `internal` or another code. `workflow_exists` SHALL carry the id it names, `step_blocked` SHALL carry the ids of the steps that are not settled, and `template_not_found` SHALL carry the template id it was given.

#### Scenario: Active step reported through stdio

- **WHEN** an agent's `update_workflow_step` call through the stdio adapter is refused because the step waits on step 5, which is running
- **THEN** the agent receives `step_blocked` with step 5's id

#### Scenario: Missing template reported through stdio

- **WHEN** an agent's `delete_workflow_template` call through the stdio adapter names a template that does not exist
- **THEN** the agent receives `template_not_found` with that id

### Requirement: Terminay never runs a workflow step

Terminay SHALL NOT execute, schedule, time out, or advance a workflow step. A step's status SHALL change only through `update_workflow_step`, through launching or replacing the workflow, or through the user removing it. Launching and resuming SHALL write only the launch or resume text, never a step's prompt.

#### Scenario: Agent idle on a running step

- **WHEN** a step has been running for an hour and the terminal is idle
- **THEN** the step is still running and nothing is written to the terminal

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

### Requirement: Template changes over MCP share the Settings path

A template change made over MCP SHALL go through the same server-owned, revisioned template state as an edit in Settings. It SHALL be validated under the same template rules and size bounds, and published to every client of that server. It SHALL NOT overwrite a change another client committed in the meantime. A workflow already copied from a template SHALL NOT change when that template is updated or deleted.

#### Scenario: Concurrent edit in Settings

- **WHEN** a user saves a change to template A in Settings while an agent's `update_workflow_template` call for template B is in flight
- **THEN** both changes are kept

### Requirement: Template categories over MCP are set by name

A template tool SHALL take a category by name. A name that matches an existing category ignoring case SHALL use that category. A non-empty name that matches none SHALL add a category with that name after the existing ones. An empty name SHALL mean no category. A change that would add a category beyond the category bound SHALL fail with `bad_request` and change nothing.

#### Scenario: Category matched ignoring case

- **WHEN** the category "Tests" exists and an agent creates a template with the category "tests"
- **THEN** the template is listed under "Tests" and no second category is added

#### Scenario: Category bound reached

- **WHEN** a server has the maximum number of categories and an agent creates a template with a new category name
- **THEN** the call fails with `bad_request` and no template or category is added

### Requirement: Templates and workflows are distinct on the MCP surface

Every tool that acts on workflow templates SHALL carry `workflow_template` in its name, and no tool that acts on a terminal's workflow SHALL. Each such tool's description SHALL state which it acts on: a **workflow template**, the reusable definition in Settings > Workflows, or a **workflow**, the one checklist instance attached to a single terminal. No template tool SHALL change a terminal's workflow, and no workflow tool SHALL change a template.

#### Scenario: Updating a workflow step leaves its template alone

- **WHEN** an agent sets a step of a workflow started from template T to done
- **THEN** template T is unchanged and has no status

#### Scenario: Tool descriptions

- **WHEN** an agent lists the Terminay MCP tools
- **THEN** the descriptions of `create_workflow` and `create_workflow_template` each state whether it attaches a workflow to a terminal or saves a reusable template

### Requirement: Workflow progress on compact surfaces

On a compact workspace, a terminal with an attached workflow SHALL show its workflow dial — the same ring, filled to the share of steps done and coloured by the workflow's state, that its terminal tab shows — on its row in the switcher's folder tree, on its row in the Home panel's needs-you list, and in the compact title block while it is the terminal on screen. On switcher rows the dial SHALL occupy one fixed trailing column, so dials on every row of a tree line up with one another and with the folders' trailing ⋯ controls. A folder header SHALL NOT show a workflow dial. The row's second line SHALL state the workflow's current step in words. A finished workflow's dial SHALL hide on these surfaces when it hides on the terminal's tab.

#### Scenario: Dials line up

- **WHEN** a folder holds two terminals with workflows and one without
- **THEN** both dials sit in the same trailing column, the third row leaves that column empty, and the folder's header shows no dial

#### Scenario: Needs input

- **WHEN** a terminal's workflow has a step in `needs_input`
- **THEN** its switcher row shows a red dial and its second line says the workflow needs input and which step

#### Scenario: Title block

- **WHEN** a terminal whose workflow is on step three of five is on screen on a compact workspace
- **THEN** the title block shows that terminal's dial beside its project and folder

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

### Requirement: Panel step actions use the server's step update

The panel's Skip and Restore actions SHALL go through the same server-owned step update that `update_workflow_step` uses, sent only to the server that owns the terminal and authorised against that exact terminal and its project. They SHALL apply the step status and time rules, and SHALL be published to every client that can see the terminal. Each action SHALL carry the status the panel showed for that step, and the server SHALL refuse it with `step_changed`, changing nothing, when the step no longer holds that status. `update_workflow_step` SHALL NOT require an expected status.

#### Scenario: Terminal outside the client's reach

- **WHEN** a client sends a step update naming a terminal in a project it cannot see
- **THEN** the update is refused and no step changes

#### Scenario: The step started after the panel rendered

- **WHEN** the panel shows step 6 not started, an agent sets step 6 to running, and the user then chooses Skip on step 6
- **THEN** the update is refused with `step_changed`, step 6 stays running, and the panel says the step could not be skipped

### Requirement: Workflow panel width

The expanded workflow panel SHALL offer a resize separator on its left edge; the collapsed rail and the narrow-pane overlay SHALL have none. Dragging the separator SHALL resize the panel as the pointer moves, with the terminal refitting to stay left of it, and releasing SHALL set the chosen width. A cancelled drag SHALL leave the chosen width unchanged. The chosen width SHALL stay between 200 and 640 pixels, and SHALL be 264 pixels until the user resizes it.

#### Scenario: Dragging the panel wider

- **WHEN** the panel is expanded at 264 pixels and the user drags its separator 100 pixels to the left
- **THEN** the panel grows with the pointer, the terminal stays left of the panel throughout, and after release the panel is 364 pixels wide

#### Scenario: A cancelled drag changes nothing

- **WHEN** the user drags the separator and the drag is cancelled before release
- **THEN** the panel and the terminal return to their widths from before the drag, and the chosen width is unchanged

#### Scenario: Width is bounded

- **WHEN** the user drags the separator past the minimum or the maximum width
- **THEN** the panel stops at 200 or 640 pixels

#### Scenario: The drag cannot cost the terminal its minimum

- **WHEN** the user drags the separator toward a width that would leave the terminal narrower than 60 columns
- **THEN** the panel stops at the widest width that keeps the terminal at 60 columns

### Requirement: A resize starts from the drawn width

A drag SHALL start from the width the panel is drawn at in its pane, and a press on the separator that does not move SHALL change nothing.

#### Scenario: Clicking a narrowed panel's separator keeps the chosen width

- **WHEN** the chosen width is 480 pixels, the pane draws the panel narrower, and the user presses and releases the separator without moving
- **THEN** the chosen width stays 480 pixels

### Requirement: Workflow panel width from the keyboard

The resize separator SHALL be reachable with Tab. With it focused, Arrow Left SHALL widen the panel and Arrow Right SHALL narrow it, by 16 pixels each from the width the panel is drawn at, within the same bounds as a drag, and SHALL set the chosen width.

#### Scenario: Resizing with the keyboard

- **WHEN** the user focuses the separator and presses Arrow Left twice
- **THEN** the panel is 32 pixels wider

### Requirement: Panel width is a device-local setting

The workflow panel's chosen width SHALL be a device-local user setting, kept and shared exactly as the panel's collapse setting is, and SHALL NOT be stored on the server or in a template. Each pane SHALL draw the chosen width reduced as its own space requires.

#### Scenario: One chosen width for every terminal

- **WHEN** two terminals in split panes of one window show expanded workflow panels and the user resizes one of them
- **THEN** both panels take the new chosen width, each reduced only as its own pane requires, and other devices are unchanged

#### Scenario: The width survives a relaunch

- **WHEN** the user resizes the panel and relaunches Terminay on that device
- **THEN** the expanded panel opens at the width the user chose

#### Scenario: A stored width that cannot be used

- **WHEN** the device's stored width is unreadable or outside 200 to 640 pixels
- **THEN** the panel opens at 264 pixels

### Requirement: Step note density in the panel

The expanded workflow panel, and its narrow-pane overlay, SHALL offer in its ⋯ workflow options menu a choice that shows step notes **Full**, cut to **2 lines**, or for **Current only**, which shows the notes of every `running`, `failed`, or `needs_input` step and no other. Full SHALL be the default. The choice SHALL change only how notes are shown: never which steps are listed, nor any note's text.

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

- **WHEN** the user opens the overlay in a narrow pane and chooses Current only from its ⋯ menu with the keyboard
- **THEN** the overlay stays open showing notes for Current only, the terminal receives no input, Escape still closes the overlay, and reopening it shows Current only

#### Scenario: The header at the narrowest panel

- **WHEN** the panel is drawn at its 200-pixel minimum, or the overlay narrower than that, with a workflow name longer than the panel is wide
- **THEN** the name wraps, the progress line wraps only between its parts, the ⋯ control and the collapse control are both fully visible and usable, and the opened menu lies inside the window

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

The expanded panel, the collapsed rail, the expanded drawer, and the collapsed strip SHALL each offer a ⋯ control at their top right that opens the workflow options menu. The menu SHALL offer **Show as** with **Vertical** and **Horizontal** as a choice of one, the current layout marked; in the vertical layout, **Step notes** with **Full**, **2 lines**, and **Current only** as a choice of one, the current density marked; and then **Remove workflow…**. Choosing a layout or a density SHALL apply it and close the menu. The menu SHALL open beside its ⋯ control and lie wholly inside the window, moved in from any window edge it would cross, and SHALL NOT be cut off by the pane, panel, or drawer that holds the control. Choosing Remove workflow… SHALL replace the menu's content with a confirmation that names the workflow and offers Cancel and Remove; Remove SHALL remove the workflow, and Cancel SHALL return to the menu without changing anything. When removing fails, the menu SHALL say the workflow could not be removed and the workflow SHALL be unchanged. The menu SHALL be operable from the keyboard, Escape SHALL close it and return focus to its ⋯ control, and opening it SHALL send no input to the terminal. No other control of the panel, rail, drawer, or strip SHALL remove a workflow.

#### Scenario: Removing from the menu

- **WHEN** the user opens the ⋯ menu, chooses Remove workflow…, and then Remove
- **THEN** the workflow is removed, the panel or drawer disappears, the terminal fills the pane, and the terminal keeps running

#### Scenario: Cancelling the removal

- **WHEN** the user chooses Remove workflow… and then Cancel
- **THEN** the menu shows Show as and Remove workflow… again and the workflow is unchanged

#### Scenario: The menu stays inside the window

- **WHEN** the panel is narrower than the menu, or the pane sits at the window's left edge, and the user opens the ⋯ menu
- **THEN** the whole menu is visible inside the window

#### Scenario: Choosing a note density from the menu

- **WHEN** the layout is vertical and the user opens the ⋯ menu and chooses Step notes 2 lines
- **THEN** the menu closes, focus returns to the ⋯ control, and the panel shows notes cut to two lines

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

### Requirement: Terminal overlays stay clear of the workflow panel

The connection-recovery banner, input notices, paste and file-upload progress, the find bar, and the dictation overlay SHALL lie within the terminal's own area: left of the vertical workflow panel or rail, above the horizontal workflow drawer or strip, and above the rail of minimised app windows. None of them SHALL be drawn under or over the docked panel, drawer, strip or rail, and each SHALL fit within the terminal's width.

#### Scenario: Finding text beside the workflow panel

- **WHEN** the user opens find in a terminal with an expanded workflow panel
- **THEN** the find bar ends to the left of the panel and the panel's collapse control stays visible and operable

#### Scenario: Notices above the workflow drawer

- **WHEN** the layout is horizontal and a terminal with an expanded workflow drawer shows its paste progress or an input notice
- **THEN** the progress or notice sits above the drawer

#### Scenario: Notices above a minimised app window

- **WHEN** a terminal with a minimised app window shows its paste progress or an input notice
- **THEN** the progress or notice sits above the app-window rail

### Requirement: Bottom overlays stack without covering each other

When a terminal shows more than one of the connection-recovery banner, an input notice, and paste or file-upload progress at once, they SHALL stack vertically at the bottom of the terminal's area with the recovery banner nearest the bottom edge, and none SHALL cover another. When the stack is taller than the terminal's area, it SHALL scroll within that area.

#### Scenario: A notice and the recovery banner together

- **WHEN** a terminal shows an input notice while its recovery banner is showing
- **THEN** the notice shows above the banner and both the notice's button and **Retry connection** can be clicked

### Requirement: The connection-recovery banner stays operable

A terminal's connection-recovery banner SHALL keep its message and actions fully visible and operable by pointer and keyboard whatever workflow panel, drawer or app-window rail the pane shows, and SHALL be drawn above the workflow panel's and drawer's narrow-pane overlays. When the terminal's area is too narrow for the message and actions on one line, the message SHALL wrap and the actions SHALL move below it rather than be clipped or hidden.

#### Scenario: Retrying with the workflow panel expanded

- **WHEN** a terminal with an expanded workflow panel shows a connection-recovery banner such as "Terminal recovery timed out. Retry the connection to continue."
- **THEN** the banner and its **Retry connection** button end to the left of the panel, and clicking **Retry connection** retries the connection

#### Scenario: Retrying from the keyboard

- **WHEN** the recovery banner shows beside an expanded workflow panel and the user focuses **Retry connection** and presses Enter
- **THEN** the connection is retried

#### Scenario: Retrying with the workflow rail

- **WHEN** a terminal whose workflow panel is collapsed to the rail shows the recovery banner
- **THEN** the banner ends to the left of the rail and **Retry connection** can be clicked

#### Scenario: Retrying with the workflow drawer

- **WHEN** the layout is horizontal and a terminal with an expanded workflow drawer shows the recovery banner
- **THEN** the banner sits above the drawer and **Retry connection** can be clicked

#### Scenario: Retrying while a narrow-pane overlay is open

- **WHEN** the workflow panel's or drawer's overlay is open in a narrow or short pane and the terminal shows the recovery banner
- **THEN** the banner is drawn above the overlay and **Retry connection** can be clicked

#### Scenario: A narrow terminal wraps the banner

- **WHEN** the terminal's area beside the workflow panel is too narrow for the banner's message and **Retry connection** on one line
- **THEN** the message wraps, **Retry connection** shows in full below it, and neither extends under the panel
