## MODIFIED Requirements

### Requirement: Capability token scope and lifecycle

Presenting a token SHALL resolve to the immutable calling principal and its current canonical scope. The principal SHALL be a terminal, an agent chat, or a bot execution. A terminal’s scope SHALL be its project for a project terminal, or the workspace scope for a terminal in the automation terminal space. A chat’s scope SHALL be its reach, one project or the workspace; its token SHALL be revoked as the Chat capability requirement states. A bot execution’s scope SHALL be the workspace; its token SHALL be revoked as the Bot execution capability revocation requirement states. A project-scope token SHALL grant access only to terminal panels in that project and SHALL never enumerate project identity as an MCP tool concept. No token SHALL address another server. When its terminal moves to another project, or from the automation terminal space into a project, a token SHALL follow the terminal: from the moment of the move it SHALL resolve to the new project and not to the old one, with no instant in which it reaches both, and approvals, session grants, and in-flight requests made under the old scope SHALL end. A token SHALL be revoked when its terminal enters the automation terminal space, and SHALL be revoked on terminal exit, explicit revocation, server shutdown, or MCP disablement. A token SHALL NOT expire with time while its terminal runs. The server SHALL prune the capability of any terminal that is no longer running, when it starts and at least once a day. A token SHALL NOT be widened using a title, panel id, cwd, active tab, renderer state, process name, environment variable, or copied metadata.

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

#### Scenario: Chat token resolves to its reach

- **WHEN** the agent of a chat with workspace reach presents its token
- **THEN** it resolves to that chat with workspace scope and no calling terminal

#### Scenario: Bot execution token resolves to the workspace

- **WHEN** the host presents the token of a bot execution
- **THEN** it resolves to that bot execution with workspace scope and no calling terminal

## ADDED Requirements

### Requirement: Bot execution capability

The server SHALL mint exactly one Terminay MCP capability for each execution of a bot whose Terminay MCP access is on, while Terminay MCP is enabled on the server. Only the server's bot service SHALL obtain it, deciding from the bot's current record when the execution's runtime starts. The capability SHALL have no calling terminal and workspace scope, and SHALL grant the same tools, addressing rules and reach as a workspace-reach chat. `open_terminal` without a project handle SHALL create the terminal in the automation terminal space. Tools that need a calling terminal SHALL return `unsupported_op` without side effects.

When the capability or its delivery can't be set up, the execution SHALL start without a `terminay` server, SHALL say so in Runner output, and SHALL leave no capability or relay behind.

#### Scenario: Bot lists terminals across projects

- **WHEN** an execution of a bot with Terminay MCP access calls `list_terminals` on a server with two projects
- **THEN** it receives the terminals of both projects and of the automation terminal space, each with an opaque project handle and display title

#### Scenario: Bot without access

- **WHEN** an execution of a bot whose Terminay MCP access is off lists its MCP servers
- **THEN** it has only its runtime, desktop and browser servers, and no `terminay` server

#### Scenario: Access turned on

- **WHEN** a user turns a bot's Terminay MCP access on while one of its executions is running
- **THEN** that execution still has no `terminay` server, and the bot's next execution has one

#### Scenario: MCP disabled on the server

- **WHEN** Terminay MCP is disabled and a bot with Terminay MCP access starts an execution
- **THEN** the execution starts with no `terminay` server and runs with its runtime tools

#### Scenario: Delivery fails to start

- **WHEN** the second relay can't start after the capability has been minted
- **THEN** the capability is revoked, Runner output says Terminay MCP is unavailable for that execution, and the execution runs with its runtime tools

#### Scenario: Bot calls show_window

- **WHEN** a bot execution calls `show_window`
- **THEN** it receives `unsupported_op` and no window opens

### Requirement: Bot execution capability delivery

The agent SHALL receive the capability only as a `terminay` MCP server, relayed into the bot's container over an authenticated engine exec relay of its own. The raw token SHALL stay in server memory and SHALL never enter the container. The container SHALL hold only a separate execution-bound relay secret, which the server checks on every frame before it dispatches with the capability. The relay secret SHALL be redacted like every other value Terminay injects into a bot.

Each adapter connection on the relay SHALL be its own MCP session, with its own initialization, request ids, cancellation and notifications. Closing one connection SHALL cancel only that connection's in-flight requests. The number of connections and of outstanding requests per connection SHALL be bounded.

#### Scenario: Two adapters use the same request id

- **WHEN** two `terminay` adapter connections in one execution each send a request with id 1
- **THEN** each receives only its own response

#### Scenario: Adapter disconnects mid-wait

- **WHEN** an adapter connection closes while its `wait_for_idle` call is pending
- **THEN** that call is cancelled and another connection's requests continue

#### Scenario: Wrong relay secret

- **WHEN** a frame arrives on the relay with a missing or wrong secret
- **THEN** it is refused and nothing is dispatched

#### Scenario: Agent prints its environment

- **WHEN** a bot with Terminay MCP access runs `env` and the output includes the relay secret
- **THEN** stored and displayed runner output and transcripts show `[redacted]` in its place

### Requirement: Bot execution capability revocation

A bot execution capability SHALL be revoked when:

- the execution ends for any reason, including stop, timeout, replacement and failure;
- the bot's Terminay MCP access is turned off;
- the bot is deleted;
- Terminay MCP is disabled;
- the server shuts down.

Revocation SHALL cancel the execution's in-flight Terminay MCP requests and SHALL end its watches and waits, so no later effect or data reaches the container. A save that turns access off, or a delete, SHALL complete only after the revocation. An execution whose runtime is starting while access is turned off SHALL NOT mint a capability afterwards. Turning access back on, or re-enabling Terminay MCP, SHALL NOT restore a revoked capability: only an execution started after that holds one. No client message, terminal, chat, extension, MCP caller, or process in a bot's container SHALL be able to request, copy into effect or widen a bot execution capability.

#### Scenario: Access turned off during a wait

- **WHEN** a bot execution is blocked in `wait_for_command` and a user turns the bot's Terminay MCP access off
- **THEN** the wait is cancelled at once, its result never reaches the container, and later calls fail as revoked

#### Scenario: Toggle-off races a starting execution

- **WHEN** a bot execution's runtime is starting and a user turns Terminay MCP access off before the capability is minted
- **THEN** the execution starts without a `terminay` server

#### Scenario: Off then on

- **WHEN** a user turns a bot's access off and on again while one of its executions keeps running
- **THEN** that execution's Terminay MCP calls still fail as revoked

#### Scenario: Execution ends

- **WHEN** a bot execution holding a capability ends
- **THEN** its capability is revoked, and a later request presenting its relay secret fails without revealing any scope
