## MODIFIED Requirements

### Requirement: The agent's client

A view operation from an MCP caller SHALL be applied by exactly one client, the
**agent's client**. For a terminal caller, that SHALL be the client holding the
calling terminal's presentation lease, on the connection that holds it. For a
chat caller, it SHALL be the client connection that sent the chat's most recent
message, which the server SHALL hold in memory only and SHALL forget when that
connection closes. A bot execution caller SHALL have no agent's client, even
when a client is viewing the bot or sent the message that started the execution.
When no agent's client exists, or it has not attached as
able to apply view operations, a view operation SHALL fail with
`renderer_unavailable` and SHALL change nothing. No other client's view SHALL
change because of an agent's view operation.

#### Scenario: Terminal caller on one of two devices

- **WHEN** an agent in a terminal that device A presents calls `focus_tab`,
  while device B shows the same project
- **THEN** device A shows that tab in front and device B's view is unchanged

#### Scenario: Chat caller

- **WHEN** a user sends Pixel a message from one window and Pixel then calls
  `arrange_tabs`
- **THEN** that window's tabs are arranged and no other window's are

#### Scenario: No client is presenting the caller

- **WHEN** an automation terminal no client presents calls `move_tab`
- **THEN** the call fails with `renderer_unavailable` and nothing moves

#### Scenario: Bot calls a view operation

- **WHEN** a user chats with a bot that has Terminay MCP access, and its execution calls `focus_tab`
- **THEN** the call fails with `renderer_unavailable` and no client's view changes
