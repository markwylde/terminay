## MODIFIED Requirements

### Requirement: MCP permission groups

Every MCP operation other than `get_mcp_capabilities` SHALL belong to exactly one permission group, fixed in the server's operation table:

- **Read Terminals**: `list_terminals`, `read_terminal`, `search_terminal`, `get_terminal_status`, `get_layout`, `wait_for_idle`, `wait_for_command`, and `wait_for_attention`.
- **Full Terminal Management**: `open_terminal`, `close_terminal`, `write_terminal`, `run_command`, `focus_terminal`, `rename_terminal`, `split_terminal`, `focus_tab`, `move_tab`, `resize_pane`, `arrange_tabs`, `focus_project`, `select_folder`, `create_folder`, `rename_folder`, `move_tab_to_folder`, `open_file`, and `close_tab`.
- **Read Automations**: `list_automations`, `get_automation`, and `list_automation_runs`.
- **Full Automation Management**: `create_automation`, `update_automation`, `delete_automation`, `set_automation_enabled`, `run_automation`, and `stop_automation_run`.
- **App Windows**: `show_window`, `close_window`, and `list_windows`, and the opening of a window for a connected server's tool that declares a UI.
- **Connected Server Tools**: every tool offered by a connected MCP server, whether called by the agent or by that server's own view.

`get_mcp_capabilities` SHALL belong to no group and SHALL always be permitted after capability validation. An operation's group SHALL NEVER depend on its parameters, the caller, or its scope. A call to a connected server's tool that declares a UI SHALL be evaluated under Connected Server Tools to run and, separately, under App Windows to show its view; where App Windows does not permit it, the tool SHALL still run and no window SHALL open.

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
