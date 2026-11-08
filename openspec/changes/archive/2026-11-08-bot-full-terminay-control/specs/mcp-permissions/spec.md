## MODIFIED Requirements

### Requirement: MCP permission groups

Every MCP operation other than `get_mcp_capabilities` SHALL belong to exactly one permission group, fixed in the server's operation table:

- **Read Terminals**: `list_terminals`, `read_terminal`, `search_terminal`, `get_terminal_status`, `get_layout`, `wait_for_idle`, `wait_for_command`, `wait_for_attention`, `get_workflow`, `list_workflow_templates`, and `get_workflow_template`.
- **Full Terminal Management**: `open_terminal`, `close_terminal`, `write_terminal`, `run_command`, `focus_terminal`, `rename_terminal`, `update_terminal`, `move_terminal_to_project`, `split_terminal`, `focus_tab`, `move_tab`, `resize_pane`, `arrange_tabs`, `focus_project`, `focus_home`, `select_folder`, `create_folder`, `rename_folder`, `delete_folder`, `reorder_folders`, `move_tab_to_folder`, `open_file`, `close_tab`, `list_macros`, `run_macro`, `cancel_macro`, `create_workflow`, and `update_workflow_step`.
- **Workflow Templates**: `create_workflow_template`, `update_workflow_template`, and `delete_workflow_template`.
- **Read Automations**: `list_automations`, `get_automation`, and `list_automation_runs`.
- **Full Automation Management**: `create_automation`, `update_automation`, `delete_automation`, `set_automation_enabled`, `run_automation`, `stop_automation_run`, `remove_automation_run`, `prune_automation_runs`, and `dismiss_missed_runs`.
- **Projects & Windows**: `list_projects`, `list_recent_folders`, `create_project`, `update_project`, `move_project`, `close_project`, `list_workspace_windows`, `open_workspace_window`, `rename_workspace_window`, and `close_workspace_window`.
- **Read Settings**: `get_settings` and `list_shell_profiles`.
- **Change Settings**: `update_settings`, `save_shell_profile`, `delete_shell_profile`, `reorder_shell_profiles`, and `set_default_shell_profile`.
- **App Windows**: `show_window`, `close_window`, and `list_windows`, and the opening of a window for a connected server's tool that declares a UI.
- **Notifications**: `send_notification`, `list_notifications`, and `dismiss_notification`.
- **Connected Server Tools**: every tool offered by a connected MCP server, whether called by the agent or by that server's own view.

`get_mcp_capabilities` SHALL belong to no group and SHALL always be permitted after capability validation. An operation's group SHALL NEVER depend on its parameters, the caller, or its scope. Whether the caller's reach may use an operation SHALL be decided separately from its group, and before the policy is evaluated, so that a call outside the caller's reach never asks. A call to a connected server's tool that declares a UI SHALL be evaluated under Connected Server Tools to run and, separately, under App Windows to show its view. Where App Windows does not permit it, the tool SHALL still run and no window SHALL open.

#### Scenario: Running a command

- **WHEN** an agent calls `run_command`
- **THEN** the server evaluates it under Full Terminal Management

#### Scenario: Running an automation now

- **WHEN** an agent calls `run_automation`
- **THEN** the server evaluates it under Full Automation Management

#### Scenario: Capability discovery

- **WHEN** every permission group is set to Never Allow and an agent calls `get_mcp_capabilities`
- **THEN** the call succeeds

#### Scenario: Showing a window

- **WHEN** an agent calls `show_window`
- **THEN** the server evaluates it under App Windows

#### Scenario: Calling a connected server's tool

- **WHEN** an agent calls `diagrams__draw`
- **THEN** the server evaluates it under Connected Server Tools

#### Scenario: Windows denied, tools allowed

- **WHEN** App Windows is Never Allow, Connected Server Tools is Always Allow, and an agent calls a connected tool that declares a UI
- **THEN** the tool runs and returns its result, and no window opens

#### Scenario: Reading the layout

- **WHEN** an agent calls `get_layout`
- **THEN** the server evaluates it under Read Terminals

#### Scenario: Arranging tabs

- **WHEN** an agent calls `arrange_tabs`
- **THEN** the server evaluates it under Full Terminal Management

#### Scenario: Sending a notification

- **WHEN** an agent calls `send_notification`
- **THEN** the server evaluates it under Notifications

#### Scenario: Renaming a project from either reach

- **WHEN** a project-reach agent and a workspace-reach agent each call `update_project`
- **THEN** the server evaluates both under Projects & Windows

#### Scenario: Out-of-reach call never asks

- **WHEN** Change Settings is Ask Permission and an agent in a project terminal calls `update_settings`
- **THEN** the call fails with `out_of_scope` and no approval prompt appears

#### Scenario: Reading a workflow

- **WHEN** an agent calls `get_workflow`
- **THEN** the server evaluates it under Read Terminals

#### Scenario: Reporting a workflow step

- **WHEN** an agent calls `update_workflow_step`
- **THEN** the server evaluates it under Full Terminal Management

#### Scenario: Reading a workflow template

- **WHEN** an agent calls `get_workflow_template`
- **THEN** the server evaluates it under Read Terminals

#### Scenario: Saving a workflow template

- **WHEN** an agent calls `create_workflow_template`
- **THEN** the server evaluates it under Workflow Templates

#### Scenario: Starting a workflow from a template

- **WHEN** an agent calls `create_workflow` with a `template_id`
- **THEN** the server evaluates it under Full Terminal Management only
