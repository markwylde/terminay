## ADDED Requirements

### Requirement: Chat capability

The server SHALL mint exactly one capability for each provider session of an agent chat whose reach is a project or the workspace. It SHALL mint none for a chat with reach `none`. Only the server's agent chat service SHALL be able to obtain a chat capability. A chat capability SHALL have no calling terminal, and its scope SHALL be the chat's reach: one project's scope, or the workspace scope of the owning server. With workspace scope it SHALL grant the same tools as a workspace-scope terminal capability, under the same addressing rules, and `open_terminal` without a project handle SHALL create the terminal in the automation terminal space. With project scope it SHALL grant what a project-scope terminal capability grants in that project, and `open_terminal` SHALL create the terminal in that project. Tools that need a calling terminal, namely the app window tools, SHALL be reported unavailable to a chat capability and SHALL return `unsupported_op` without side effects. A chat capability SHALL be revoked when its provider session ends for any reason, when the chat is cleared or closed, on MCP disablement, and on server shutdown. No client message, terminal, extension or MCP caller SHALL be able to request, copy into effect or widen a chat capability.

#### Scenario: Workspace chat lists terminals across projects

- **WHEN** a chat with workspace reach calls `list_terminals` on a server with two projects and an automation run
- **THEN** it receives the terminals of both projects and of the automation terminal space, each with an opaque project handle and display title

#### Scenario: Chat calls show_window

- **WHEN** a chat's agent calls `show_window`
- **THEN** it receives `unsupported_op` and no window opens

#### Scenario: Session ends

- **WHEN** a chat's provider session ends
- **THEN** its capability is revoked, and a later request presenting it fails without revealing any scope

#### Scenario: Terminal cannot obtain chat reach

- **WHEN** a process in a project terminal presents its own token or tries to obtain a chat capability
- **THEN** its token resolves only to its project and no chat capability is issued

## MODIFIED Requirements

### Requirement: Capability token scope and lifecycle

Presenting a token SHALL resolve to the immutable calling principal and its canonical scope. The calling principal is either a terminal or an agent chat. A terminal's scope is its project for a project terminal, or the workspace scope for a terminal in the automation terminal space. A chat's scope is its reach, a project or the workspace. A project-scope token SHALL grant access only to terminal panels in that project and SHALL never enumerate project identity as an MCP tool concept. No token SHALL address another server. A terminal's token SHALL be replaced or revoked atomically when its terminal changes project or leaves or enters the automation terminal space, and SHALL be revoked on terminal exit. A chat's token SHALL be revoked as the chat capability requirement states. Any token SHALL be revoked on explicit revocation, server shutdown or MCP disablement. No token SHALL be widened using a title, panel id, cwd, active tab, renderer state, process name, environment variable or copied metadata.

#### Scenario: Terminal changes project

- **WHEN** a terminal holding a capability changes project
- **THEN** its token is replaced or revoked atomically

#### Scenario: Terminal exits

- **WHEN** a terminal exits, its capability is explicitly revoked, the server shuts down, or MCP is disabled
- **THEN** the token is revoked

#### Scenario: Widening attempt

- **WHEN** a caller supplies a title, panel id, cwd, active tab, renderer state, process name, environment variable, or copied metadata to reach another scope
- **THEN** the token's scope is not widened

#### Scenario: Automation terminal moved into a project

- **WHEN** a terminal is moved from the automation terminal space into a project
- **THEN** its workspace-scope token is replaced with a project-scope token or revoked atomically

#### Scenario: Chat token resolves to its reach

- **WHEN** the agent of a chat with workspace reach presents its token
- **THEN** it resolves to that chat with workspace scope and no calling terminal

### Requirement: Stdio adapter lifecycle

The stdio adapter SHALL start with the agent client and SHALL read its connection details from its launch environment. That environment is inherited from the terminal for a terminal agent, and supplied by the host in the MCP server entry for a chat's agent. It SHALL validate the endpoint and token before advertising tools and SHALL exit cleanly when stdin closes or authority is revoked.

#### Scenario: Adapter start

- **WHEN** the stdio adapter starts
- **THEN** it reads connection details from its launch environment and validates the endpoint and token before advertising tools

#### Scenario: Authority revoked

- **WHEN** stdin closes or the adapter's authority is revoked
- **THEN** the adapter exits cleanly

#### Scenario: Adapter started for a chat

- **WHEN** a chat's agent starts the Terminay MCP adapter from the host-supplied MCP server entry
- **THEN** the adapter validates the chat's token and advertises the Terminay tools

### Requirement: Capability reporting

`get_mcp_capabilities` SHALL always be available after capability validation. It SHALL return an adapter-global list of tool names, each with an `available` boolean for the bound host and calling principal, and its effective permission as `allow`, `ask`, or `deny`. The effective permission SHALL reflect the tool's group policy and any session grant the calling capability holds. Availability SHALL NOT be a property of an individual terminal row. An unavailable optional tool MAY remain in the MCP registration for a stable client surface, but a caller SHALL be able to discover it through this result, and calls to it SHALL return `unsupported_op` without side effects. A tool whose permission is `deny` SHALL remain in the registration and SHALL return `permission_denied` without side effects.

#### Scenario: Optional tool unavailable

- **WHEN** an optional tool is unavailable for the bound host
- **THEN** `get_mcp_capabilities` reports it unavailable and calling it returns `unsupported_op` with no side effects

#### Scenario: Permissions reported

- **WHEN** Full Automation Management is Ask Permission and the calling terminal holds no session grant
- **THEN** `get_mcp_capabilities` reports `create_automation` as available with permission `ask`

#### Scenario: Session grant reported

- **WHEN** the calling terminal holds a session grant for Full Automation Management
- **THEN** `get_mcp_capabilities` reports `create_automation` with permission `allow`

#### Scenario: Window tools reported to a chat

- **WHEN** a chat's agent calls `get_mcp_capabilities`
- **THEN** `show_window`, `close_window` and `list_windows` are reported unavailable
