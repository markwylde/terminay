## MODIFIED Requirements

### Requirement: Project-implicit tool surface

Terminay SHALL expose the following project-implicit tools: `get_mcp_capabilities` reporting the globally available MCP operations for the bound host; `list_terminals` listing terminal panels in scope with opaque handles, display names, state, and active status; `read_terminal` reading either a bounded lossless raw-output range or a bounded current terminal-presentation snapshot; `search_terminal` searching a bounded current text presentation snapshot and returning bounded matching visual-row context; `get_terminal_status` returning canonical activity, attention, cwd, and last-exit information; `write_terminal` writing exact validated text to one live terminal; `run_command` writing one command and submitting it once as a paste followed by Enter, framed with bracketed paste only when the foreground program has enabled it; `open_terminal` creating one terminal in the same project with an optional display name and policy-valid cwd, optionally placed beside a tab and optionally brought to the front on the agent's client; `close_terminal` closing one terminal through normal terminal lifecycle rules; `focus_terminal` showing one terminal's project, folder, and tab on the agent's client; `rename_terminal` changing one terminal's display title; `split_terminal` creating exactly one new terminal beside a target terminal on the agent's client; `wait_for_idle` waiting for bounded canonical terminal inactivity; `wait_for_command` waiting for the next structured command completion and returning bounded exit information; `wait_for_attention` waiting for the next canonical needs-attention signal; and the view and folder tools of the MCP workspace view. A tool SHALL report a view change only when the agent's client has applied it, and its result SHALL carry that client's layout afterwards.

#### Scenario: Listing terminals

- **WHEN** an agent calls `list_terminals`
- **THEN** it receives opaque handles, display names, state, and active status for terminal panels in scope

#### Scenario: Focusing a terminal

- **WHEN** an agent calls `focus_terminal`
- **THEN** the agent's client shows that terminal's project, folder, and tab in front, and no other client's view changes

#### Scenario: Splitting a terminal

- **WHEN** an agent calls `split_terminal` with `direction: "right"`
- **THEN** exactly one new terminal is created, the agent's client shows it in a new pane to the right of the target, and the result carries the new terminal's handle and the resulting layout

#### Scenario: Opening without taking focus

- **WHEN** an agent calls `open_terminal` without `focus`
- **THEN** the terminal is created and the tab in front on the agent's client is unchanged

#### Scenario: Opening and focusing

- **WHEN** an agent calls `open_terminal` with `focus: true`
- **THEN** the agent's client shows the new terminal in front, including when it is in another project or the automation space

#### Scenario: Placement without a client

- **WHEN** an agent calls `split_terminal` and no agent's client is reachable
- **THEN** the terminal is still created, and the result reports `placed: false` with the reason instead of a layout

#### Scenario: Running a multiline command

- **WHEN** an agent calls `run_command` with multiline input and the foreground program has enabled bracketed paste
- **THEN** the command is written once using bracketed paste and submitted once

#### Scenario: Running a command where bracketed paste is off

- **WHEN** an agent calls `run_command` and the foreground program has not enabled bracketed paste
- **THEN** the command is written without bracketed-paste markers, each line break is sent as a carriage return, and the command is submitted with a final carriage return

#### Scenario: Leading assignment in a shell without bracketed paste

- **WHEN** an agent calls `run_command` with `X=1 sh -c 'echo $X'` in a shell that has not enabled bracketed paste
- **THEN** the shell reads the assignment as an assignment and prints `1`

### Requirement: MCP security and privacy boundaries

Terminay's own MCP tools SHALL expose terminal control, the agent's own client's view of projects in scope, automation management, and the calling terminal's app windows only; filesystem, Git, settings, secrets, recordings, extension administration, remote administration, and arbitrary native-window management SHALL remain outside Terminay's own tool surface. `open_file` SHALL only open a viewer tab for a path inside the project root and SHALL NEVER return file content to the agent. The single file read in that surface is the stdio adapter reading the document an agent names for `show_window`: it is performed by the adapter and never by the Terminay Server, its contents are shown to the user in a window, and they SHALL NEVER be returned to the agent. The surface MAY additionally carry the tools of MCP servers the user has connected in Settings; such a tool SHALL be named with its entry's prefix, SHALL be run by that server and never by Terminay, and SHALL NOT gain any Terminay authority. Every request SHALL revalidate its capability against canonical terminal and project state and SHALL be evaluated against the MCP permission policy before it is dispatched. Output, parameters, errors, candidate lists, and waits SHALL be bounded to resist memory and context exhaustion. The server SHALL NOT infer authority from current UI focus or renderer ownership; the agent's client only decides where a permitted view change is applied. Installing the MCP entry SHALL NOT enable provider hooks or disclose provider journals. Journal records used for agent status SHALL never be routed through MCP and MCP calls SHALL never synthesize agent-status lifecycle events.

#### Scenario: Filesystem tool requested

- **WHEN** an agent seeks filesystem, Git, settings, secret, recording, extension-management, or remote-administration access through Terminay's own tools
- **THEN** no such Terminay tool exists in the surface

#### Scenario: Agent names a file it wants to read

- **WHEN** an agent calls `show_window` with `html_file` naming a file that is not an HTML document, such as a private key
- **THEN** the file's text is shown to the user in a window, and neither the tool result nor any later tool result carries it to the agent

#### Scenario: Agent opens a file tab

- **WHEN** an agent calls `open_file` for a file in the project
- **THEN** the user sees the file in a viewer tab and the agent receives only the tab id and layout

#### Scenario: Connected server offers a file tool

- **WHEN** a server the user connected offers a tool that reads files
- **THEN** it is listed under that entry's prefix, runs in that server, and holds no Terminay capability

#### Scenario: Authority from UI focus

- **WHEN** a request would be satisfied only by current UI focus or renderer ownership
- **THEN** the server does not infer authority from it

#### Scenario: Agent status via MCP

- **WHEN** MCP calls execute
- **THEN** no journal record is routed through MCP and no agent-status lifecycle event is synthesized

#### Scenario: Automation management requires permission

- **WHEN** an agent calls an automation-management tool
- **THEN** the server evaluates the MCP permission policy for it before any automation changes
