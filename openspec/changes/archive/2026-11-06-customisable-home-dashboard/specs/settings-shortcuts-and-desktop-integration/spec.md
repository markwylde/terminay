## MODIFIED Requirements

### Requirement: Settings classification by authority

Server-owned workspace state SHALL classify settings by authority: server settings for shells, workspace behaviour, files and Git, recordings, agents, AI, macros, secrets, exposure, and the Home overview layout; connection-host settings for remembered server metadata, native window geometry, and inherently device-specific behaviour; and transient client state that is not persisted as product configuration.

#### Scenario: Classifying a setting

- **WHEN** a setting is persisted
- **THEN** it is stored in its declared server, connection-host, or transient scope

#### Scenario: Home overview layout is a server setting

- **WHEN** a user changes the Home overview layout
- **THEN** it is stored as a server setting of the server the window is working in, and is not reachable through MCP settings tools
