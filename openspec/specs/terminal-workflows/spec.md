# terminal-workflows Specification

## Purpose
A terminal workflow is a server-owned checklist attached to one terminal session: the user launches it from a template, and the agent in that terminal works through its steps and reports their status through the Terminay MCP tools. Terminay shows the checklist beside the terminal and never runs a step itself.

## Requirements

### Requirement: Workflow templates

A workflow template SHALL have a name, a description, at most one category, an opening prompt, and an ordered list of one to 50 steps. Each step SHALL have a stable id, a title, a prompt, and an optional icon. A step's id SHALL be assigned by the server when the step is created and SHALL NOT change when the step is renamed, edited, or moved. A template SHALL be rejected when its name is empty, when it has no step, or when a step's title is empty. Two steps MAY share a title.

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

Templates and workflows SHALL share one set of bounds: a name and each step title of at most 120 characters, an opening prompt and each step prompt of at most 8 KiB, and a serialized size of at most 56 KiB. The serialized size SHALL be the length in bytes of the JSON encoding of the name, opening prompt, and every step's title, prompt, and icon, in the shape a `create_workflow` request carries them, so that escaping is counted. The bound SHALL keep a `create_workflow` request, with its envelope, within the ordinary MCP request frame, and a `get_workflow` response within the ordinary MCP response bound. Text over a bound SHALL be refused, never truncated.

#### Scenario: Largest workflow through MCP

- **WHEN** an agent calls `create_workflow` through the stdio adapter with 50 steps whose serialized size is exactly 56 KiB and whose prompts are mostly quotes, backslashes, and control characters, then calls `get_workflow`
- **THEN** both calls succeed and `get_workflow` returns every prompt in full

#### Scenario: Over the serialized bound

- **WHEN** a user saves a template whose serialized size is over 56 KiB
- **THEN** the save is refused and the editor shows the size and the bound

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

The editor SHALL edit the name, description, category, opening prompt, and steps. A step SHALL be added, removed, reordered by dragging or by Alt+Arrow Up and Alt+Arrow Down on its handle, and given an icon or none from a picker of the fixed icon set. The editor SHALL show the text that launching the template types into the terminal. No template field SHALL choose whether the workflow panel is collapsed or expanded.

#### Scenario: Reordering a step from the keyboard

- **WHEN** the user focuses step 3's handle and presses Alt+Arrow Up
- **THEN** it becomes step 2 and its handle keeps focus

#### Scenario: Choosing a step icon

- **WHEN** the user opens a step's icon picker and chooses the wrench
- **THEN** the step shows the wrench in the editor and in the workflow panel after the template is launched

### Requirement: A workflow belongs to one terminal session

A workflow SHALL be a server-owned record with its own id, bound to exactly one terminal session. A terminal session SHALL have at most one workflow. A workflow SHALL hold a name, an opening prompt, and an ordered list of steps, each with a stable id, a title, a prompt, an optional icon, a status, an optional note, and the times it started and ended. A workflow created from a template SHALL hold a copy of the template's steps at launch, and later edits to the template SHALL NOT change it. A workflow SHALL follow its terminal when the terminal moves between projects, and SHALL be visible only to clients that can see that terminal.

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

A terminal with a workflow SHALL show a workflow panel along the right edge of its pane, inside the pane and not part of either workspace sidebar. The terminal viewport SHALL end to the left of the panel so that no terminal output, cursor, or input surface is covered, except by the transient overlay of a narrow pane. A terminal without a workflow SHALL have no panel and SHALL fill its pane. Each terminal pane in a split SHALL show its own terminal's workflow.

#### Scenario: Split panes

- **WHEN** two terminals in a split each have a workflow
- **THEN** each pane shows its own terminal's workflow at its own right edge

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

Expanded, the panel SHALL also show the workflow's name, how many steps are done, the time elapsed since the first step started, a collapsible brief holding the opening prompt, and each step's title, its duration once it has ended or running time while it runs, and its note as the panel's step note density allows. The `running` or `needs_input` step SHALL be highlighted. A skipped step's title SHALL be struck through and dimmed, and it SHALL show no duration and its note as the density allows.

#### Scenario: Reading the brief

- **WHEN** the user opens the brief in the expanded panel
- **THEN** it shows the workflow's opening prompt as plain text

#### Scenario: Skipped step in the expanded panel

- **WHEN** step 6 of eight is skipped with the note "not a visual change" and steps 1 to 5 are done
- **THEN** the panel shows step 6's title struck through with that note and no duration, and counts six of eight steps done

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

The panel SHALL offer a control that toggles between collapsed and expanded. The choice SHALL be a device-local user setting that applies to every terminal on that device, and SHALL NOT be stored on the server or in a template.

#### Scenario: Expanding on one terminal

- **WHEN** the user expands the panel on one terminal
- **THEN** the workflow panel of every terminal on that device is expanded, and other devices are unchanged

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

### Requirement: Workflow MCP tools

Terminay SHALL expose `create_workflow`, `get_workflow`, and `update_workflow_step`. Each SHALL take an optional terminal and act on the calling terminal when none is given. A given terminal SHALL be resolved within the caller's reach, and one outside it SHALL fail with `terminal_not_found`. A step SHALL be addressed only by its id, never by its title or position.

- `create_workflow` takes either a `template_id`, or a name, an optional opening prompt, and one to 50 steps each with a title, a prompt, and an optional icon, under the workflow size bounds. It also takes an optional `replaceWorkflowId`. It attaches a new workflow with every step `not_started` and returns the workflow with its id and step ids. With a `template_id`, the workflow SHALL be a copy of that template's name, opening prompt, and steps, recording the template it came from, with new workflow and step ids. A call that gives both a `template_id` and a name, opening prompt, or steps SHALL fail with `bad_request`. An unknown `template_id` SHALL fail with `template_not_found`. `create_workflow` SHALL fail with `workflow_exists`, naming the attached workflow's id, when the terminal has an unfinished workflow whose id is not `replaceWorkflowId`. Every refusal SHALL change nothing.
- `get_workflow` returns the terminal's workflow: its id, name, opening prompt, resume point, every step's id, title, prompt, icon, status, note, and times, and the id of the template it was copied from, or none. It SHALL fail with `no_workflow` when the terminal has none.
- `update_workflow_step` takes a step id, a status, and an optional note, and applies the step status and time rules. An unknown step id SHALL fail with `step_not_found` and change nothing.

#### Scenario: Agent creates its own workflow

- **WHEN** an agent in a terminal calls `create_workflow` with five steps and no terminal
- **THEN** the calling terminal shows a workflow panel with five steps not started, and the result carries the workflow id and the five step ids

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
- **THEN** it receives every step's prompt and status and the resume point

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

`workflow_exists`, `no_workflow`, `step_not_found`, `step_active`, and `template_not_found` SHALL be MCP error codes returned through the control endpoint and the stdio adapter unchanged, never mapped to `internal` or another code. `step_active` and `workflow_exists` SHALL carry the id they name, and `template_not_found` SHALL carry the template id it was given.

#### Scenario: Active step reported through stdio

- **WHEN** an agent's `update_workflow_step` call through the stdio adapter is refused because step 5 is running
- **THEN** the agent receives `step_active` with step 5's id

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
- `get_workflow_template` takes a template id and returns its id, name, description, category, opening prompt, and every step's id, title, prompt, and icon.
- `create_workflow_template` takes a name, an optional description, an optional category, an optional opening prompt, and one to 50 steps each with a title, an optional prompt, and an optional icon. The server SHALL assign the template id and every step id. The template SHALL be added after every existing template. It returns the saved template.
- `update_workflow_template` takes a template id and any of name, description, category, opening prompt, and steps. A field given SHALL replace that field, and a field left out SHALL keep it. Steps given SHALL replace the whole step list in the order given. A given step that carries the id of one of that template's steps SHALL keep that id, and any other step SHALL get a new id. It returns the saved template.
- `delete_workflow_template` takes a template id and removes that template. Its category SHALL remain.

#### Scenario: Agent saves a reusable template

- **WHEN** an agent in a project terminal calls `create_workflow_template` with the name "Release", the category "Shipping", and three steps, and the request is permitted
- **THEN** Settings > Workflows on every client of that server lists "Release · 3 steps" under a new "Shipping" category, and the Command Bar offers it on that server's terminals

#### Scenario: Renaming one step keeps the others' ids

- **WHEN** an agent reads a template with `get_workflow_template` and calls `update_workflow_template` with the same steps, the second retitled
- **THEN** every step keeps its id and only the second step's title changes

#### Scenario: Partial update

- **WHEN** an agent calls `update_workflow_template` with only a new description
- **THEN** the template's description changes and its name, category, opening prompt, and steps are unchanged

#### Scenario: Deleting a template that a terminal used

- **WHEN** a terminal's workflow was started from a template and an agent deletes that template
- **THEN** the template is gone from Settings and the Command Bar, and the terminal's workflow is unchanged

#### Scenario: Unknown template id

- **WHEN** an agent calls `update_workflow_template` with an id that names no template
- **THEN** the call fails with `template_not_found` and no template is created

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
