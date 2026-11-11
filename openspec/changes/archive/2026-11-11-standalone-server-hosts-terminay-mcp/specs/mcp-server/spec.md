## MODIFIED Requirements

### Requirement: Server ownership of the MCP surface

Terminay Server SHALL own the MCP stdio entry point, local control endpoint, capability issuance and revocation, scope resolution, terminal operations, subscriptions, and workspace mutations. It SHALL resolve operations directly against canonical server-owned project and terminal state. A renderer SHALL never be an authority or a routing hop.

Every Terminay Server SHALL serve this surface, whether Desktop embeds it or it runs standalone. A standalone server SHALL start its control endpoint, issue terminal capabilities, enforce the permission policy, and offer the same tools, app windows, workspace view and connected MCP servers as an embedded one. No host SHALL serve the MCP surface without the permission policy, app windows, or workspace view.

#### Scenario: Operation resolution

- **WHEN** an MCP operation is executed
- **THEN** it resolves directly against canonical server-owned project and terminal state without passing through a renderer

#### Scenario: Standalone server terminal

- **WHEN** an agent in a terminal launched by a standalone server, with MCP enabled, calls `list_terminals`
- **THEN** it receives that server's terminals in its project, exactly as it would on Desktop

#### Scenario: Server started with MCP disabled

- **WHEN** a server starts with **Enable Terminay MCP server** off in its stored settings, and restores terminals, runs automations and starts bot executions during startup
- **THEN** no terminal, chat or bot receives a capability, and terminals launched after the user turns MCP on receive one

#### Scenario: Standalone server capabilities

- **WHEN** a client attaches to a standalone server of the same release
- **THEN** the server advertises `mcp-approvals.v1`, `workspace-view.v1`, `app-windows.v1`, `app-window-mirror.v1` and `app-window-attachments.v1`, and the connection is not shown as degraded

### Requirement: Registration management surface

Terminay SHALL expose an **Install Terminay MCP** action in Settings for the server a window shows, whether that server is Desktop's own or a standalone server. The targets SHALL be detected and installed on that server's machine, with that server's own MCP entry as the registered command. Its management surface SHALL list every MCP install target contributed by an enabled extension. The built-in agents extension contributes Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode. For each target the surface SHALL:

- show one of not installed, installed, changed, unavailable, or error
- identify the provider-owned configuration scope being changed
- install and remove that target independently

Server Core SHALL route every detection, install, and removal to the contributing extension with the host-supplied MCP server command. When no enabled extension contributes a target, the surface SHALL say that MCP install targets come from the built-in agents extension and that it is disabled or missing, and SHALL offer no install action.

#### Scenario: Registration state shown

- **WHEN** a user opens the MCP management surface
- **THEN** each contributed target shows one of not installed, installed, changed, unavailable, or error, together with the provider-owned configuration scope being changed

#### Scenario: Independent install

- **WHEN** a user installs the registration for one target
- **THEN** the other targets' registrations are unchanged

#### Scenario: Agents extension disabled

- **WHEN** the built-in agents extension is disabled and the user opens the MCP management surface
- **THEN** it explains that install targets come from that extension and offers no install action

#### Scenario: Installing on a standalone server

- **WHEN** a window shows a standalone server and the user installs the Claude Code target
- **THEN** the registration is written into Claude Code's configuration on that server's machine, naming that server's own Node binary and MCP entry by absolute path, and nothing changes on the machine running the window

### Requirement: Reporting a control endpoint that cannot be placed

When the control endpoint's socket cannot be placed, because the data directory's path is too long and no runtime directory is usable, the server SHALL say so in place of a general failure message. Desktop SHALL say it in its launch recovery state. A standalone server SHALL refuse to start, SHALL write the message to standard error, and SHALL exit with a non-zero status. The message SHALL state that the data directory's path is too long for a local socket, SHALL give the data directory's path, the length of the socket path, and the limit, and SHALL state that a shorter data directory resolves it. When a runtime directory was refused, the message SHALL name that directory and the reason. Desktop SHALL also record the failure in Desktop diagnostics. The message SHALL NOT include a capability token.

#### Scenario: No usable placement

- **WHEN** Desktop starts with a data directory whose socket path is too long and the runtime directory's path is also over the limit
- **THEN** the launch recovery state says the data directory's path is too long for a local socket, gives the path and the limit, and says to use a shorter data directory

#### Scenario: Runtime directory refused

- **WHEN** Desktop starts with a data directory whose socket path is too long and the runtime directory exists but is owned by another user
- **THEN** the launch recovery state names that directory and says it is not owned by the current user, and Desktop does not listen there

#### Scenario: Recorded for support

- **WHEN** the control endpoint cannot be placed
- **THEN** Desktop diagnostics hold a record of the failure with the paths and lengths involved and no capability token

#### Scenario: Standalone server with no usable placement

- **WHEN** a standalone server starts with a data root whose socket path is too long and no usable runtime directory
- **THEN** it writes the same explanation to standard error, does not start serving, and exits with a non-zero status
