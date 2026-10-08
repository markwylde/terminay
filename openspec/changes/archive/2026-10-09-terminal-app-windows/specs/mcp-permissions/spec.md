## ADDED Requirements

### Requirement: Window Messages policy

A message that an app window sends for the conversation SHALL be evaluated on the server under a **Window Messages** policy before anything is written to the terminal. The policy SHALL be Ask Permission, Always Allow, or Never Allow, SHALL default to Always Allow, and SHALL be a server-owned setting listed with the MCP permission groups. Under Ask Permission the request SHALL create a pending approval shown inline in the owning terminal's pane, stating the window's title and the complete text to be typed, with Allow One Time, Allow This Session, and Decline; a session grant SHALL cover later messages from windows of that terminal. Under Never Allow the view SHALL receive a refusal and nothing SHALL be written.

#### Scenario: Default

- **WHEN** a server has no stored setting and a window sends a message
- **THEN** the message is typed into the owning terminal without a prompt

#### Scenario: Ask Permission

- **WHEN** Window Messages is Ask Permission and the window "Deploy configurator" in Terminal 1 sends "Deploy api to eu-west-1"
- **THEN** Terminal 1's pane shows a prompt naming the window and the full text, and nothing is typed until the user allows it

#### Scenario: Never Allow

- **WHEN** Window Messages is Never Allow and a window sends a message
- **THEN** the view receives a refusal and nothing is written to the terminal

## MODIFIED Requirements

### Requirement: MCP permission groups

Every MCP operation other than `get_mcp_capabilities` SHALL belong to exactly one permission group, fixed in the server's operation table:

- **Read Terminals**: `list_terminals`, `read_terminal`, `search_terminal`, `get_terminal_status`, `wait_for_idle`, `wait_for_command`, and `wait_for_attention`.
- **Full Terminal Management**: `open_terminal`, `close_terminal`, `write_terminal`, `run_command`, `focus_terminal`, `rename_terminal`, and `split_terminal`.
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

### Requirement: MCP permission policy settings

Settings > AI > Terminay MCP SHALL list the six permission groups and the Window Messages policy under the **Enable Terminay MCP server** switch, each with a choice of **Ask Permission**, **Always Allow**, or **Never Allow**. The defaults SHALL be Always Allow for Read Terminals, Full Terminal Management, Read Automations, App Windows, Connected Server Tools, and Window Messages, and Ask Permission for Full Automation Management. The policies SHALL be server-owned settings of the server that owns the MCP endpoint, SHALL be the same for every project and terminal on that server, and SHALL be shown and changed identically from desktop, web, and mobile clients.

#### Scenario: Fresh settings

- **WHEN** a server starts with no stored MCP permission settings
- **THEN** both terminal groups, Read Automations, App Windows, Connected Server Tools, and Window Messages are Always Allow, and Full Automation Management is Ask Permission

#### Scenario: Changed from a browser client

- **WHEN** a user sets Full Terminal Management to Ask Permission from a browser client
- **THEN** the desktop client's settings show the same value and the next terminal-management call from any terminal on that server asks

#### Scenario: App Windows set to Ask Permission

- **WHEN** a user sets App Windows to Ask Permission and an agent calls `show_window`
- **THEN** the calling terminal's pane shows an approval prompt stating the window's title, and no window opens until the user allows it
