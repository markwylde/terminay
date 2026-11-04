## MODIFIED Requirements

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

### Requirement: Workflow errors reach the agent intact

`workflow_exists`, `no_workflow`, `step_not_found`, `step_active`, and `template_not_found` SHALL be MCP error codes returned through the control endpoint and the stdio adapter unchanged, never mapped to `internal` or another code. `step_active` and `workflow_exists` SHALL carry the id they name, and `template_not_found` SHALL carry the template id it was given.

#### Scenario: Active step reported through stdio

- **WHEN** an agent's `update_workflow_step` call through the stdio adapter is refused because step 5 is running
- **THEN** the agent receives `step_active` with step 5's id

#### Scenario: Missing template reported through stdio

- **WHEN** an agent's `delete_workflow_template` call through the stdio adapter names a template that does not exist
- **THEN** the agent receives `template_not_found` with that id

## ADDED Requirements

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
