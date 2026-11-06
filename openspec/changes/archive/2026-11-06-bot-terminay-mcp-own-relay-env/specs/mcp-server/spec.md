## MODIFIED Requirements

### Requirement: Bot execution capability delivery

The agent SHALL receive the capability only as a `terminay` MCP server, relayed into the bot's container over an authenticated engine exec relay of its own. The raw token SHALL stay in server memory and SHALL never enter the container. The container SHALL hold only a separate execution-bound relay secret, which the server checks on every frame before it dispatches with the capability. The relay secret SHALL be redacted like every other value Terminay injects into a bot.

The `terminay` server SHALL speak MCP only over its own relay, and the runtime server only over the runtime relay. Each server's socket and secret SHALL reach the agent under names belonging to that server alone. Each adapter SHALL select exactly one pair and SHALL never fall back to the other when its own pair is missing or invalid. Where the agent can forward variables to a server by name, it SHALL forward only that server's names. No secret SHALL appear on the agent's command line or in its MCP configuration. While a bot has no Terminay MCP access, neither the `terminay` server nor its pair SHALL be given to the agent.

Each adapter connection on the relay SHALL be its own MCP session, with its own initialization, request ids, cancellation and notifications. Closing one connection SHALL cancel only that connection's in-flight requests. The number of connections and of outstanding requests per connection SHALL be bounded.

#### Scenario: Codex or Claude Code bot lists workspace tools

- **WHEN** a Codex or Claude Code bot with Terminay MCP access starts an execution and its agent lists the `terminay` server's tools
- **THEN** it receives the workspace tools, such as `list_projects` and `open_terminal`, and not the bot runtime tools

#### Scenario: Secrets stay off the command line

- **WHEN** the agent for a bot with Terminay MCP access is launched
- **THEN** neither the runtime secret nor the relay secret appears in its arguments or its MCP configuration

#### Scenario: Terminay pair missing

- **WHEN** the `terminay` adapter starts and its own pair is absent or malformed while a valid runtime pair is present
- **THEN** it exits with an error and sends nothing to either relay

#### Scenario: Runtime pair missing

- **WHEN** the runtime adapter starts and its own pair is absent or malformed while a valid `terminay` pair is present
- **THEN** it exits with an error and sends nothing to either relay

#### Scenario: Bot without Terminay MCP access

- **WHEN** a bot without Terminay MCP access starts an execution
- **THEN** the agent is given no `terminay` server and no `terminay` pair, and its runtime tools work

#### Scenario: Bot image without the Terminay MCP adapter

- **WHEN** a bot with Terminay MCP access runs on an image whose adapter cannot select the `terminay` pair
- **THEN** the `terminay` server fails to start, no MCP message from it reaches the bot runtime relay, and the bot image is reported as out of date

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
