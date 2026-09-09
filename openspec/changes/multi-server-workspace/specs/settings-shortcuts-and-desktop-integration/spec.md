## ADDED Requirements

### Requirement: Settings and Extensions surfaces select a server

The Settings surface, including its Extensions section, SHALL carry a server
selector listing every attached connection. It SHALL default to the server that
owns the active project tab, and it SHALL present the settings, secrets, and
extension inventory of exactly the selected server. Values from two servers SHALL
NEVER be merged, summed, or shown as one list, and a change SHALL be committed
only on the selected server. Selecting a connection that is unavailable or
incompatible SHALL show that connection's state instead of settings.

#### Scenario: Default selection

- **WHEN** the user opens Settings while a project of an attached server is active
- **THEN** the server selector starts on that server and shows its settings

#### Scenario: Switching servers

- **WHEN** the user selects another attached connection
- **THEN** the surface shows only that server's settings and extensions, and no
  value from the previous server remains visible

#### Scenario: Editing applies to one server

- **WHEN** the user changes a setting while a server is selected
- **THEN** the change is committed on that server alone and no other attached
  server's settings change

#### Scenario: Selected connection is unavailable

- **WHEN** the selected connection is offline or incompatible
- **THEN** the surface reports that connection's state and sends it no settings
  operation

## MODIFIED Requirements

### Requirement: Server settings client boundary

The shared terminal-settings hook SHALL read and observe server settings through the transport-neutral `SettingsClient` held for the connection whose server is selected. The host bridge SHALL NOT answer or translate server settings operations. Shared components SHALL NOT subscribe to preload events directly. No terminal-settings preload global or snapshot adapter SHALL exist, and a missing settings authority on the selected connection SHALL be reported as unavailable rather than falling back to device-local settings or to another connection.

#### Scenario: Reading server settings

- **WHEN** a shared component reads or observes server settings
- **THEN** it uses the `SettingsClient` of the connection whose server is selected

#### Scenario: Settings authority missing

- **WHEN** the selected server's settings authority is unavailable
- **THEN** the condition is reported as unavailable and no device-local fallback is used

#### Scenario: Another connection is not a fallback

- **WHEN** the selected connection cannot answer a settings operation
- **THEN** the operation is not retried on any other attached connection
