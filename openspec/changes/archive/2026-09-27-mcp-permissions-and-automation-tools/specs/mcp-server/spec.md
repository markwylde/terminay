## ADDED Requirements

### Requirement: Automation management tools

Terminay SHALL expose these automation tools:

- `list_automations` lists the owning server's automations, each with its id, name, enabled state, trigger, action kind, next scheduled run where there is one, and last run outcome.
- `get_automation` returns one automation's full definition.
- `list_automation_runs` returns a bounded page of one automation's run log.
- `create_automation` creates an automation.
- `update_automation` replaces one automation's name, trigger, action, or settings, and requires the revision the caller last read.
- `delete_automation` deletes one automation without stopping runs already in progress.
- `set_automation_enabled` enables or disables one automation.
- `run_automation` starts one run now.
- `stop_automation_run` stops one run in progress.

Automations are server-wide, so these tools SHALL address every automation on the owning server from both project-scope and workspace-scope capabilities. They SHALL NEVER address another server's automations. Definitions SHALL be validated exactly as automations saved from the Automations section are. `run_automation` for a subject-terminal action SHALL require a subject terminal handle that the caller could address with its own scope. A project-scope caller SHALL NEVER see the subject terminal, subject project, or output tail of a run whose subject lies outside its project; those fields SHALL be withheld from its results. Every automation tool SHALL be governed by the MCP permission policy.

#### Scenario: Agent schedules a script

- **WHEN** an agent in a project terminal calls `create_automation` with a daily 09:00 schedule that runs `~/bin/report.sh`, and the request is permitted
- **THEN** the automation is created on the owning server, appears in every client's Automations section, and the tool returns its id

#### Scenario: Stale update

- **WHEN** an agent calls `update_automation` with a revision older than the automation's current one
- **THEN** the update fails with a conflict and the automation is unchanged

#### Scenario: Run log from another project

- **WHEN** a project-scope caller lists the runs of an automation triggered by an agent finishing in a different project
- **THEN** the run outcomes and times are returned without the subject terminal, subject project, or output tail

#### Scenario: Subject terminal outside scope

- **WHEN** a project-scope caller calls `run_automation` for a write-text automation naming a terminal handle outside its project
- **THEN** the request is refused and nothing runs

## MODIFIED Requirements

### Requirement: MCP security and privacy boundaries

MCP SHALL expose terminal control and automation management only; filesystem, Git, settings, secrets, recordings, extension administration, remote administration, and arbitrary native-window management SHALL remain outside the tool surface. Every request SHALL revalidate its capability against canonical terminal and project state and SHALL be evaluated against the MCP permission policy before it is dispatched. Output, parameters, errors, candidate lists, and waits SHALL be bounded to resist memory and context exhaustion. The server SHALL NOT infer authority from current UI focus or renderer ownership. Installing the MCP entry SHALL NOT enable provider hooks or disclose provider journals. Journal records used for agent status SHALL never be routed through MCP and MCP calls SHALL never synthesize agent-status lifecycle events.

#### Scenario: Filesystem tool requested

- **WHEN** an agent seeks filesystem, Git, settings, secret, recording, extension-management, or remote-administration access through MCP
- **THEN** no such tool exists in the surface

#### Scenario: Authority from UI focus

- **WHEN** a request would be satisfied only by current UI focus or renderer ownership
- **THEN** the server does not infer authority from it

#### Scenario: Agent status via MCP

- **WHEN** MCP calls execute
- **THEN** no journal record is routed through MCP and no agent-status lifecycle event is synthesized

#### Scenario: Automation management requires permission

- **WHEN** an agent calls an automation-management tool
- **THEN** the server evaluates the MCP permission policy for it before any automation changes

### Requirement: Workspace scope for automation terminals

Only a terminal in the automation terminal space SHALL receive a workspace-scope capability, and the server SHALL decide that from the terminal's canonical placement alone. A workspace-scope capability SHALL grant the same tools as a project scope, over the terminal panels of every project and of the automation terminal space on the owning server. With that scope, `list_terminals` SHALL identify each terminal's project by an opaque project handle and its display title, `open_terminal` SHALL create the terminal in the automation terminal space unless the caller names a project handle from a listing, and every other tool SHALL address terminals only by the opaque handles those listings return. A workspace scope SHALL NEVER grant anything the MCP security boundaries exclude, and its automation tools SHALL be governed by the MCP permission policy exactly as a project scope's are.

#### Scenario: Script opens an agent terminal

- **WHEN** a scheduled script with a workspace-scope capability calls `open_terminal` without a project handle
- **THEN** the terminal is created in the automation terminal space and receives its own workspace-scope capability

#### Scenario: Script opens a terminal in a project

- **WHEN** a workspace-scope caller calls `open_terminal` with a project handle it obtained from `list_terminals`
- **THEN** the terminal is created in that project and receives a project-scope capability

#### Scenario: Project terminal cannot obtain workspace scope

- **WHEN** a process in a project terminal presents its own token, or copies an automation terminal's environment variables into a new shell inside the project terminal
- **THEN** its own token resolves only to its project, and a copied token remains bound to the automation terminal it was minted for and is revoked when that terminal exits

#### Scenario: Automation run asks to manage automations

- **WHEN** a process in an automation run terminal calls `create_automation` while Full Automation Management is Ask Permission
- **THEN** the run terminal's pane shows the approval prompt and nothing is created until a user allows it

### Requirement: Bounded local control protocol

Control requests and responses SHALL be correlated, framed, size-bounded, and runtime-validated. Concurrency, output size, and pending waits SHALL be bounded. Request lifetime SHALL be bounded, except that while a request waits on a pending MCP approval its lifetime SHALL be bounded by that approval's lifecycle instead of a timer. Invalid tokens and malformed requests SHALL return bounded failures that do not reveal valid scopes. Cancellation SHALL reach the terminal operation or pending approval, and an aborted request SHALL NOT start a later backend mutation or publish a stale result.

#### Scenario: Malformed request

- **WHEN** a malformed or unauthenticated control request arrives
- **THEN** it returns a bounded failure that reveals no valid scopes

#### Scenario: Cancelled request

- **WHEN** a control request is cancelled
- **THEN** cancellation reaches the terminal operation and no later backend mutation starts and no stale result is published

#### Scenario: Request waiting on approval

- **WHEN** a request has waited on a pending approval longer than the ordinary request lifetime
- **THEN** it keeps waiting, and it ends only as the approval lifecycle defines

#### Scenario: Cancelled while awaiting approval

- **WHEN** a request waiting on a pending approval is cancelled
- **THEN** the approval is withdrawn from every client and the operation never runs, even if a user approves at the same moment

### Requirement: Capability reporting

`get_mcp_capabilities` SHALL always be available after capability validation. It SHALL return an adapter-global list of tool names, each with an `available` boolean for the bound host and its effective permission as `allow`, `ask`, or `deny`. The effective permission SHALL reflect the tool's group policy and any session grant the calling terminal holds. Availability SHALL NOT be a property of an individual terminal row. An unavailable optional tool MAY remain in the MCP registration for a stable client surface, but a caller SHALL be able to discover it through this result, and calls to it SHALL return `unsupported_op` without side effects. A tool whose permission is `deny` SHALL remain in the registration and SHALL return `permission_denied` without side effects.

#### Scenario: Optional tool unavailable

- **WHEN** an optional tool is unavailable for the bound host
- **THEN** `get_mcp_capabilities` reports it unavailable and calling it returns `unsupported_op` with no side effects

#### Scenario: Permissions reported

- **WHEN** Full Automation Management is Ask Permission and the calling terminal holds no session grant
- **THEN** `get_mcp_capabilities` reports `create_automation` as available with permission `ask`

#### Scenario: Session grant reported

- **WHEN** the calling terminal holds a session grant for Full Automation Management
- **THEN** `get_mcp_capabilities` reports `create_automation` with permission `allow`
