## MODIFIED Requirements

### Requirement: Project-scoped MCP terminal control

Terminay SHALL provide a local Model Context Protocol server for Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode processes running inside Terminay terminals. An installed agent in a project terminal SHALL be able to inspect and control terminal tabs in its own project and SHALL NOT be able to learn about or control other projects, servers, workspace views, or clients. A process in a terminal of the automation terminal space SHALL instead hold the workspace scope defined for automation terminals, and SHALL NOT be able to learn about or control other servers, workspace views, or clients.

#### Scenario: Agent lists terminals

- **WHEN** an agent launched inside a project terminal lists terminals
- **THEN** it sees only terminal panels belonging to the calling terminal's canonical project

#### Scenario: Agent attempts cross-project control

- **WHEN** an agent in a project terminal attempts to address a terminal in another project or on another server
- **THEN** the request is refused

#### Scenario: Automation terminal lists terminals

- **WHEN** a process in an automation terminal lists terminals
- **THEN** it sees the terminal panels of every project and of the automation terminal space on its own server, and nothing on another server

### Requirement: Capability token scope and lifecycle

Presenting a token SHALL resolve to the immutable calling terminal and its canonical scope: its project for a project terminal, or the workspace scope for a terminal in the automation terminal space. A project-scope token SHALL grant access only to terminal panels in that project and SHALL never enumerate project identity as an MCP tool concept. No token SHALL address another server. A token SHALL be replaced or revoked atomically when its terminal changes project or leaves or enters the automation terminal space, SHALL be revoked on terminal exit, explicit revocation, server shutdown, or MCP disablement, and SHALL NOT be widened using a title, panel id, cwd, active tab, renderer state, process name, environment variable, or copied metadata.

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

## ADDED Requirements

### Requirement: Workspace scope for automation terminals

Only a terminal in the automation terminal space SHALL receive a workspace-scope capability, and the server SHALL decide that from the terminal's canonical placement alone. A workspace-scope capability SHALL grant the same tools as a project scope, over the terminal panels of every project and of the automation terminal space on the owning server. With that scope, `list_terminals` SHALL identify each terminal's project by an opaque project handle and its display title, `open_terminal` SHALL create the terminal in the automation terminal space unless the caller names a project handle from a listing, and every other tool SHALL address terminals only by the opaque handles those listings return. A workspace scope SHALL NEVER grant anything the MCP security boundaries exclude, and SHALL NEVER create, edit, enable, or run automations.

#### Scenario: Script opens an agent terminal

- **WHEN** a scheduled script with a workspace-scope capability calls `open_terminal` without a project handle
- **THEN** the terminal is created in the automation terminal space and receives its own workspace-scope capability

#### Scenario: Script opens a terminal in a project

- **WHEN** a workspace-scope caller calls `open_terminal` with a project handle it obtained from `list_terminals`
- **THEN** the terminal is created in that project and receives a project-scope capability

#### Scenario: Project terminal cannot obtain workspace scope

- **WHEN** a process in a project terminal presents its own token, or copies an automation terminal's environment variables into a new shell inside the project terminal
- **THEN** its own token resolves only to its project, and a copied token remains bound to the automation terminal it was minted for and is revoked when that terminal exits
