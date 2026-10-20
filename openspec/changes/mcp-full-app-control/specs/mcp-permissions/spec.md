## MODIFIED Requirements

### Requirement: MCP permission groups

Every MCP operation other than `get_mcp_capabilities` SHALL belong to exactly one permission group, fixed in the server's operation table:

- **Read Terminals**: `list_terminals`, `read_terminal`, `search_terminal`, `get_terminal_status`, `get_layout`, `wait_for_idle`, `wait_for_command`, and `wait_for_attention`.
- **Full Terminal Management**: `open_terminal`, `close_terminal`, `write_terminal`, `run_command`, `focus_terminal`, `rename_terminal`, `update_terminal`, `move_terminal_to_project`, `split_terminal`, `focus_tab`, `move_tab`, `resize_pane`, `arrange_tabs`, `focus_project`, `focus_home`, `select_folder`, `create_folder`, `rename_folder`, `delete_folder`, `reorder_folders`, `move_tab_to_folder`, `open_file`, `close_tab`, `list_macros`, `run_macro`, and `cancel_macro`.
- **Read Automations**: `list_automations`, `get_automation`, and `list_automation_runs`.
- **Full Automation Management**: `create_automation`, `update_automation`, `delete_automation`, `set_automation_enabled`, `run_automation`, `stop_automation_run`, `remove_automation_run`, `prune_automation_runs`, and `dismiss_missed_runs`.
- **Projects & Windows**: `list_projects`, `create_project`, `update_project`, `move_project`, `close_project`, `list_workspace_windows`, `open_workspace_window`, `rename_workspace_window`, and `close_workspace_window`.
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

### Requirement: MCP permission policy settings

Settings > AI > Terminay MCP SHALL list the ten permission groups and the Window Messages policy under the **Enable Terminay MCP server** switch, each with a choice of **Ask Permission**, **Always Allow**, or **Never Allow**. The defaults SHALL be Ask Permission for Full Automation Management and Change Settings, and Always Allow for every other group and for Window Messages. The policies SHALL be server-owned settings of the server that owns the MCP endpoint. They SHALL be the same for every project, terminal and chat on that server, and SHALL be shown and changed identically from desktop, web, and mobile clients. They SHALL be changeable only from Settings, never through MCP.

#### Scenario: Fresh settings

- **WHEN** a server starts with no stored MCP permission settings
- **THEN** both terminal groups, Read Automations, Projects & Windows, Read Settings, App Windows, Notifications, Connected Server Tools, and Window Messages are Always Allow, and Full Automation Management and Change Settings are Ask Permission

#### Scenario: Changed from a browser client

- **WHEN** a user sets Full Terminal Management to Ask Permission from a browser client
- **THEN** the desktop client's settings show the same value and the next terminal-management call from any terminal on that server asks

#### Scenario: App Windows set to Ask Permission

- **WHEN** a user sets App Windows to Ask Permission and an agent calls `show_window`
- **THEN** the calling terminal's pane shows an approval prompt stating the window's title, and no window opens until the user allows it

#### Scenario: Notifications set to Ask Permission

- **WHEN** a user sets Notifications to Ask Permission and an agent calls `send_notification`
- **THEN** the calling terminal's pane shows an approval prompt stating the notification's title and body, and no notification is added until the user allows it

#### Scenario: Notifications set to Never Allow

- **WHEN** a user sets Notifications to Never Allow and an agent calls `send_notification`
- **THEN** the call is refused and no notification is added

#### Scenario: Changing a setting asks by default

- **WHEN** Pixel calls `update_settings` on a fresh server to set scrollback to 10000
- **THEN** the Pixel chat shows an approval naming the scrollback setting with its current and requested values, and nothing changes until a user allows it

#### Scenario: Creating a project does not ask by default

- **WHEN** a Home terminal's agent calls `create_project` on a fresh server
- **THEN** the project is created without an approval prompt
