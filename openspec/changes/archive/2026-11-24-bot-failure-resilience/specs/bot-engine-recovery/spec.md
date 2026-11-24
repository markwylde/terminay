## MODIFIED Requirements

### Requirement: Runtime bridge failures are diagnosable
Failures starting a Terminay-owned MCP relay or adapter SHALL produce bounded sanitized Runner output identifying the failing stage and the underlying cause: an engine deadline, a dropped engine connection, relay stderr, or the adapter's reported status. Diagnostics SHALL NOT replace the underlying cause with generic advice. They SHALL advise rebuilding the bot image only when the adapter program itself is missing or cannot run, which the engine reports as exit status 127 or 126. A startup command's deadline SHALL count from when the command is running in the container, and the engine's own time to create and start the command SHALL be bounded by a separate, longer deadline. The adapter's check SHALL exit 0 on success, 75 for a temporary problem (no answer in time, connection refused or dropped) and 69 for a lasting problem (socket missing, permission denied, capability refused). The engine driver SHALL carry a command's exit status in its error, so the bridge can classify it. Diagnostics SHALL preserve execution capability revocation and bot scope.

#### Scenario: Relay readiness deadline
- **WHEN** the relay fails to become ready before its deadline
- **THEN** Runner output identifies relay readiness failure and includes bounded sanitized stderr when available

#### Scenario: Adapter cannot connect
- **WHEN** the Terminay MCP adapter cannot connect with its execution environment
- **THEN** the session diagnostics identify that connection failure without revealing its socket capability token

#### Scenario: Slow engine during the adapter check
- **WHEN** the engine takes 9 seconds to start the adapter check and the check then finishes in under a second
- **THEN** the check succeeds

#### Scenario: Adapter check deadline
- **WHEN** the adapter check is still running at its deadline
- **THEN** Runner output says the adapter check timed out and the host may be overloaded, and does not advise rebuilding the image

#### Scenario: Adapter reports a lasting problem
- **WHEN** the adapter check exits 69 because the runtime socket is missing
- **THEN** Runner output names the missing runtime socket and does not advise rebuilding the image

#### Scenario: Adapter program missing
- **WHEN** the adapter check exits 127 because the adapter is not installed in the image
- **THEN** Runner output says the adapter is missing and advises rebuilding the bot image

#### Scenario: Relay is launched by root
- **WHEN** a privileged supervisor or root process launches a bot execution relay
- **THEN** the socket belongs to the image's unprivileged bot account with mode 0600, the bot-user adapter can connect and call runtime tools, and a root-only socket causes startup to fail with its sanitized diagnostic

#### Scenario: Required real-container CI coverage
- **WHEN** pull-request CI runs
- **THEN** a required job builds the production bot image and verifies socket ownership, distinct root/bot process identities, runtime tool calls, and permission-failure reporting without skipping the container tests

#### Scenario: Claude launches the MCP server through its shell prefix
- **WHEN** Claude starts Terminay's exact MCP stdio command before acquiring shared work
- **THEN** the adapter starts with its execution token and without provider credentials, connects and loads tools, while shell commands and command variants remain subject to work acquisition and lose the runtime token

#### Scenario: Provider silently tolerates MCP startup failure
- **WHEN** a provider completes a turn without authenticated initialization and tool catalog loading on its Terminay MCP connection
- **THEN** the execution is Failed and Runner output identifies missing MCP startup rather than showing a silent Completed chat
