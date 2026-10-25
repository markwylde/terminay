## MODIFIED Requirements

### Requirement: Capability token scope and lifecycle

Presenting a token SHALL resolve to the immutable calling terminal and its current canonical scope: its project for a project terminal, or the workspace scope for a terminal in the automation terminal space. A project-scope token SHALL grant access only to terminal panels in that project and SHALL never enumerate project identity as an MCP tool concept. No token SHALL address another server. When its terminal moves to another project, or from the automation terminal space into a project, a token SHALL follow the terminal: from the moment of the move it SHALL resolve to the new project and not to the old one, with no instant in which it reaches both, and approvals, session grants, and in-flight requests made under the old scope SHALL end. A token SHALL be revoked when its terminal enters the automation terminal space, and SHALL be revoked on terminal exit, explicit revocation, server shutdown, or MCP disablement. A token SHALL NOT expire with time while its terminal runs. The server SHALL prune the capability of any terminal that is no longer running, when it starts and at least once a day. A token SHALL NOT be widened using a title, panel id, cwd, active tab, renderer state, process name, environment variable, or copied metadata.

#### Scenario: Terminal changes project

- **WHEN** a terminal holding a capability is moved to another project
- **THEN** a call presenting its token reaches the terminals of the new project and none of the old project

#### Scenario: Agent started after the move

- **WHEN** an agent is started in a terminal that was moved to another project
- **THEN** its inherited token resolves to the terminal's new project

#### Scenario: Per-scope state ends at a move

- **WHEN** a terminal is moved to another project while it holds approvals, session grants, or in-flight requests
- **THEN** those approvals and session grants end and those requests are cancelled

#### Scenario: Terminal exits

- **WHEN** a terminal exits, its capability is explicitly revoked, the server shuts down, or MCP is disabled
- **THEN** the token is revoked

#### Scenario: Long-running terminal

- **WHEN** a terminal has been running for several days
- **THEN** its token still resolves to that terminal and its scope

#### Scenario: Terminal ended without an exit event

- **WHEN** a capability's terminal is no longer running but its exit was never observed
- **THEN** the next prune revokes that capability

#### Scenario: Widening attempt

- **WHEN** a caller supplies a title, panel id, cwd, active tab, renderer state, process name, environment variable, or copied metadata to reach another scope
- **THEN** the token's scope is not widened

#### Scenario: Automation terminal moved into a project

- **WHEN** a terminal is moved from the automation terminal space into a project
- **THEN** its token resolves to that project with project scope and no longer has workspace reach

#### Scenario: Terminal moved into the automation space

- **WHEN** a project terminal is moved into the automation terminal space
- **THEN** its token is revoked
