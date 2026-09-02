## MODIFIED Requirements

### Requirement: Terminal creation is a server-owned workspace mutation

The production shared Terminal route body SHALL be project-scoped from the current server-owned workspace snapshot. Creating a terminal SHALL be a server-owned workspace mutation: the server creates the PTY session and the corresponding terminal panel record, commits both under the next workspace revision, and publishes the ordered workspace event consumed by every connected client. The event SHALL accelerate reconciliation but SHALL NOT be an acknowledgement: after the create command returns, the initiating client SHALL actively read the authoritative delta and complete only when one atomic projection contains both the returned session and its terminal panel.

#### Scenario: Change notification lost

- **WHEN** the workspace change notification is lost during transport replacement
- **THEN** the initiating client still completes by actively reading the authoritative delta
- **AND** it completes only when one atomic projection contains both the returned session and its terminal panel

### Requirement: Renderer does not invent terminal panel identity

Renderer code SHALL NOT create durable terminal panel identity as a fallback for missing server state. It MAY only mount the xterm body for a server-owned panel, attach through `TerminayTerminalPanelClient`, and keep temporary local measurements that are either discarded or committed through explicit workspace commands.

#### Scenario: Server panel record missing

- **WHEN** a renderer lacks a server-owned terminal panel record
- **THEN** it does not create durable panel identity locally
