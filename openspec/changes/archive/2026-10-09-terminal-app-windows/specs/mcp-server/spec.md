## ADDED Requirements

### Requirement: App window tools

Terminay SHALL expose three tools that act on the calling terminal's app windows. `show_window` SHALL take a title of at most 80 characters and an HTML document of at most 512 KiB, open an agent-authored window in the calling terminal, and return the new window's opaque handle; given the handle of an existing agent-authored window of the calling terminal, it SHALL replace that window's title and content in place and restore it. `close_window` SHALL close one window of the calling terminal by handle. `list_windows` SHALL return the calling terminal's windows with handle, title, source, and open or minimised state. A window handle SHALL be valid only for the terminal that owns the window. The tools' descriptions SHALL tell the agent that the HTML may use inline and `https` resources and may send a message back through the provided script interface.

#### Scenario: Hello world

- **WHEN** an agent calls `show_window` with the title "Hello" and an HTML document containing a heading
- **THEN** a window titled "Hello" opens in the calling terminal showing the heading, and the call returns its handle

#### Scenario: Updating a window

- **WHEN** an agent calls `show_window` with the handle of a window it opened and new HTML
- **THEN** the same window shows the new content and no second window is created

#### Scenario: Document too large

- **WHEN** an agent calls `show_window` with an HTML document over 512 KiB
- **THEN** the call fails with a bounded error and no window is created

#### Scenario: Handle from another terminal

- **WHEN** an agent calls `close_window` with a handle that belongs to another terminal
- **THEN** the call fails as not found and no window closes

#### Scenario: Listing windows

- **WHEN** an agent calls `list_windows` in a terminal with one agent-authored window and one MCP App window
- **THEN** it receives both, each with its handle, title, source, and state

## MODIFIED Requirements

### Requirement: MCP security and privacy boundaries

Terminay's own MCP tools SHALL expose terminal control, automation management, and the calling terminal's app windows only; filesystem, Git, settings, secrets, recordings, extension administration, remote administration, and arbitrary native-window management SHALL remain outside Terminay's own tool surface. The surface MAY additionally carry the tools of MCP servers the user has connected in Settings; such a tool SHALL be named with its entry's prefix, SHALL be run by that server and never by Terminay, and SHALL NOT gain any Terminay authority. Every request SHALL revalidate its capability against canonical terminal and project state and SHALL be evaluated against the MCP permission policy before it is dispatched. Output, parameters, errors, candidate lists, and waits SHALL be bounded to resist memory and context exhaustion. The server SHALL NOT infer authority from current UI focus or renderer ownership. Installing the MCP entry SHALL NOT enable provider hooks or disclose provider journals. Journal records used for agent status SHALL never be routed through MCP and MCP calls SHALL never synthesize agent-status lifecycle events.

#### Scenario: Filesystem tool requested

- **WHEN** an agent seeks filesystem, Git, settings, secret, recording, extension-management, or remote-administration access through Terminay's own tools
- **THEN** no such Terminay tool exists in the surface

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

### Requirement: MCP non-goals

MCP SHALL NOT provide provider hooks of any kind, agent lifecycle detection, Agents sidebar population, or terminal agent-status inference. It SHALL NOT provide cross-project or cross-server terminal control, a public or remotely discoverable network MCP endpoint, or Terminay-implemented filesystem, Git, settings, recording, secret, extension-management, or remote-access tools. It SHALL NOT read or modify an agent CLI's own MCP server configuration beyond Terminay's own registration entry. It SHALL NOT establish trust based on terminal title, process name, cwd, active UI focus, or renderer state.

#### Scenario: Remote discovery attempted

- **WHEN** a remote party attempts to discover or reach the MCP endpoint over a network
- **THEN** no publicly discoverable network MCP endpoint exists

#### Scenario: Trust from terminal title

- **WHEN** a request presents a matching terminal title, process name, or cwd instead of a valid capability
- **THEN** no trust is established

#### Scenario: Agent's other MCP servers

- **WHEN** an agent CLI has other MCP servers configured
- **THEN** Terminay does not read, list, or change them
