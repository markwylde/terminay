## MODIFIED Requirements

### Requirement: Capability token scope and lifecycle

Presenting a token SHALL resolve to the immutable calling terminal and its canonical scope: its project for a project terminal, or the workspace scope for a terminal in the automation terminal space. A project-scope token SHALL grant access only to terminal panels in that project and SHALL never enumerate project identity as an MCP tool concept. No token SHALL address another server. A token SHALL be replaced or revoked atomically when its terminal changes project or leaves or enters the automation terminal space, SHALL be revoked on terminal exit, explicit revocation, server shutdown, or MCP disablement, and SHALL NOT expire with time while its terminal runs. The server SHALL prune the capability of any terminal that is no longer running, when it starts and at least once a day. A token SHALL NOT be widened using a title, panel id, cwd, active tab, renderer state, process name, environment variable, or copied metadata.

#### Scenario: Terminal changes project

- **WHEN** a terminal holding a capability changes project
- **THEN** its token is replaced or revoked atomically

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
- **THEN** its workspace-scope token is replaced with a project-scope token or revoked atomically
