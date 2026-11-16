## MODIFIED Requirements

### Requirement: Runtime bridge failures are diagnosable
Failures starting a Terminay-owned MCP relay or adapter SHALL produce bounded sanitized Runner output identifying the failing stage and available cause. Diagnostics SHALL preserve execution capability revocation and bot scope.

#### Scenario: Relay readiness deadline
- **WHEN** the relay fails to become ready before its deadline
- **THEN** Runner output identifies relay readiness failure and includes bounded sanitized stderr when available

#### Scenario: Adapter cannot connect
- **WHEN** the Terminay MCP adapter cannot connect with its execution environment
- **THEN** the session diagnostics identify that connection failure without revealing its socket capability token


#### Scenario: Relay is launched by root
- **WHEN** a privileged supervisor or root process launches a bot execution relay
- **THEN** the socket belongs to the image's unprivileged bot account with mode 0600, the bot-user adapter can connect and call runtime tools, and a root-only socket causes startup to fail with its sanitized diagnostic

#### Scenario: Required real-container CI coverage
- **WHEN** pull-request CI runs
- **THEN** a required job builds the production bot image and verifies socket ownership, distinct root/bot process identities, runtime tool calls, and permission-failure reporting without skipping the container tests

#### Scenario: Claude launches the MCP server through its shell prefix
- **WHEN** Claude starts Terminay's exact MCP stdio command through its shell prefix
- **THEN** the adapter starts with its execution token and without provider credentials, connects and loads tools, while shell commands and command variants are refused unless the execution capability is live and lose the runtime token

#### Scenario: Provider silently tolerates MCP startup failure
- **WHEN** a provider completes a turn without authenticated initialization and tool catalog loading on its Terminay MCP connection
- **THEN** the execution is Failed and Runner output identifies missing MCP startup rather than showing a silent Completed chat
