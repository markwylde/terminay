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

A step's status SHALL be one of `not_started`, `running`, `done`, `failed`, or `needs_input`, and any step MAY move to any status. At most one step of a workflow SHALL be `running` or `needs_input` at a time. Setting a step to `running` or `needs_input` while a different step holds either status SHALL fail with `step_active`, which names the active step's id, and change nothing. A note SHALL be one line of at most 200 characters. An update that carries a note SHALL replace the step's note, an empty note SHALL clear it, and an update without a note SHALL keep it. A workflow SHALL be unfinished while any step is not `done`.

#### Scenario: Two steps active

- **WHEN** step 5 is running and an agent sets step 6 to running
- **THEN** the call fails with `step_active` naming step 5's id, and both steps keep their status

#### Scenario: Marking a step done with a note

- **WHEN** an agent sets step 5 to done with the note "codex: 3 findings (P1, P2, P3)"
- **THEN** step 5 is done and its note is shown in the panel

#### Scenario: A failed step leaves the workflow unfinished

- **WHEN** every step is done except step 7, which failed
- **THEN** the workflow is unfinished and Resume is offered for that terminal

### Requirement: Step times

A step SHALL record when it started and when it ended. Moving a step to `running` or `needs_input` from `not_started`, `done`, or `failed` SHALL set its start time to now and clear its end time. Moving between `running` and `needs_input` SHALL keep both times. Moving to `done` or `failed` from any other status SHALL set its end time to now, and SHALL also set its start time to the same instant when it had none. An update that leaves the status unchanged SHALL change no time. Moving a step to `not_started` SHALL clear both times and its note. A step's duration SHALL be its end time minus its start time.

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

### Requirement: Workflow panel in the terminal pane

A terminal with a workflow SHALL show a workflow panel along the right edge of its pane, inside the pane and not part of either workspace sidebar. The terminal viewport SHALL end to the left of the panel so that no terminal output, cursor, or input surface is covered, except by the transient overlay of a narrow pane. A terminal without a workflow SHALL have no panel and SHALL fill its pane. Each terminal pane in a split SHALL show its own terminal's workflow.

#### Scenario: Split panes

- **WHEN** two terminals in a split each have a workflow
- **THEN** each pane shows its own terminal's workflow at its own right edge

### Requirement: Collapsed workflow rail

Collapsed, the panel SHALL be a narrow rail of one marker per step, in step order, joined by a line. A marker SHALL show the step's icon, or, when the step has none, a check for `done`, a dot for `running`, a cross for `failed`, an exclamation mark for `needs_input`, and nothing for `not_started`. The marker SHALL be filled green for `done`, outlined amber for `running`, filled red for `failed` and `needs_input`, and outlined grey for `not_started`. Each marker SHALL have an accessible name made of the step's title and status. At the foot of the rail, below the markers, the rail SHALL show the workflow's name rotated to read from bottom to top, shortened with an ellipsis when the rail is too short for it.

#### Scenario: Collapsed rail

- **WHEN** a terminal's workflow has four steps done, one running, and five not started, and the panel is collapsed
- **THEN** the rail shows four green markers, one amber marker, and five grey markers in order, and the terminal ends to the left of the rail

#### Scenario: Step without an icon

- **WHEN** a done step has no icon
- **THEN** its marker shows a check

### Requirement: Expanded workflow panel

Expanded, the panel SHALL also show the workflow's name, how many steps are done, the time elapsed since the first step started, a collapsible brief holding the opening prompt, and each step's title, its duration once it has ended or running time while it runs, and its note. The `running` or `needs_input` step SHALL be highlighted.

#### Scenario: Reading the brief

- **WHEN** the user opens the brief in the expanded panel
- **THEN** it shows the workflow's opening prompt as plain text

### Requirement: Narrow panes keep the terminal usable

When a pane is too narrow to show the expanded panel beside a terminal at least 60 columns wide, the panel SHALL show collapsed whatever the setting is. Expanding it there SHALL open the expanded panel as a transient overlay over the right side of the terminal, without resizing the terminal and without changing the setting. The overlay SHALL close when the user presses Escape, activates the collapse control, or moves focus to the terminal, and the terminal SHALL receive no input while the overlay has focus.

#### Scenario: Expanding in a narrow pane

- **WHEN** the setting is expanded and a terminal's pane is too narrow
- **THEN** the panel shows collapsed and the terminal keeps its width

#### Scenario: Closing the overlay

- **WHEN** the user opens the overlay in a narrow pane and presses Escape
- **THEN** the overlay closes, the terminal is uncovered and focused, and the setting is unchanged

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

Launching SHALL create the terminal's workflow from the template with every step `not_started`, then write the launch text to the terminal as one paste, using bracketed paste when the terminal has enabled it, and submit it once. The launch text SHALL be `/goal `, followed by the template's opening prompt, followed by a fixed instruction: call `get_workflow`, work through the steps in order, set each step to `running` before starting it, follow its prompt, and set it to `done` with a one-line note, `failed` with the reason, or `needs_input` when it needs the user. The launch text SHALL be bounded to 16 KiB, and a launch over the bound SHALL be refused before anything changes.

#### Scenario: Launching a template

- **WHEN** the user opens the Command Bar on a terminal running an agent and chooses `openspec:standard-flow`
- **THEN** the terminal's workflow panel shows the template's ten steps not started, and the launch text is pasted into that terminal and submitted once

#### Scenario: Oversized launch text

- **WHEN** a template's opening prompt makes its launch text longer than 16 KiB
- **THEN** the launch is refused, no workflow is attached, and nothing is written to the terminal

### Requirement: Resuming a workflow

While the active terminal's workflow is unfinished, the Command Bar SHALL list **Resume workflow** with the workflow's name above every other workflow entry. Choosing it SHALL write the resume text to that terminal as one paste and submit it once, as launching does, and SHALL change no step. The resume text SHALL be `/goal `, followed by the workflow's opening prompt, followed by a fixed instruction to call `get_workflow`, treat it as the source of truth, and continue from the resume point.

#### Scenario: Agent session restarted mid-run

- **WHEN** a workflow has steps 1 to 4 done and step 5 running, the user starts a new agent session in the terminal, and chooses Resume workflow
- **THEN** the resume text is typed and submitted, and steps 1 to 5 keep their status

#### Scenario: Finished workflow

- **WHEN** every step of the active terminal's workflow is done
- **THEN** the Command Bar does not list Resume workflow

### Requirement: The resume point

A workflow's resume point SHALL be its `running` or `needs_input` step when it has one, and otherwise its first step that is not `done`. `get_workflow` SHALL return the resume point's step id, and the resume instruction SHALL tell the agent to continue from it and then go on to every later step that is not `done`, in order.

#### Scenario: An earlier step failed while a later one runs

- **WHEN** step 1 failed and step 5 is running
- **THEN** the resume point is step 5

#### Scenario: Nothing active

- **WHEN** steps 1 and 2 are done, step 3 failed, and no step is active
- **THEN** the resume point is step 3

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
