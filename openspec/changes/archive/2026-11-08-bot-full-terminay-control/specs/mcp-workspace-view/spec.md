## MODIFIED Requirements

### Requirement: The agent's client

A view operation from an MCP caller SHALL be applied by exactly one client, the
**agent's client**. For a terminal caller, that SHALL be the client holding the
calling terminal's presentation lease, on the connection that holds it. For a
chat caller, it SHALL be the client connection that sent the chat's most recent
message, which the server SHALL hold in memory only and SHALL forget when that
connection closes. For a bot
execution caller, it SHALL be the client connection that sent the bot its most
recent message, while that connection stays open, which the server SHALL hold
in memory only. Otherwise it SHALL be the most recently attached client
connection that is not bound to one project, so a bot run by a trigger acts on
the window the user most recently opened.
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

- **WHEN** a user messages a bot that has Terminay MCP access from one window, and its execution calls `arrange_tabs` for a 2x2 grid
- **THEN** that window's tabs are arranged in the grid and no other window's are

#### Scenario: Trigger run with nobody talking to the bot

- **WHEN** a trigger starts an execution of a bot with Terminay MCP access, and it calls `get_layout` while two windows are open
- **THEN** it receives the layout of the window that attached most recently

#### Scenario: Bot with no window open

- **WHEN** no window is attached and a bot execution calls `focus_tab`
- **THEN** the call fails with `renderer_unavailable` and nothing changes, and `open_terminal` from the same execution still creates its terminal
