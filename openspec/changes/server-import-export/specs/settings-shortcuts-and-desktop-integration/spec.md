## MODIFIED Requirements

### Requirement: Settings and Extensions surfaces select a server

The Settings surface, including its Extensions section, SHALL carry a server
selector listing every attached connection. It SHALL default to the server that
owns the active project tab, and it SHALL present the settings, secrets, and
extension inventory of exactly the selected server. Values from two servers SHALL
NEVER be merged, summed, or shown as one list, and a change SHALL be committed
only on the selected server. Selecting a connection that is unavailable or
incompatible SHALL show that connection's state instead of settings. The
Import & Export category SHALL be the one category that does not follow the
selector. It SHALL show every attached server in its own column. Each column
SHALL be read through that server's own connection, and each write SHALL be
committed through that server's own connection. No value SHALL be merged across
columns.

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

#### Scenario: Import & Export ignores the selector

- **WHEN** the user opens the Import & Export category with three servers attached
- **THEN** it shows a column for each of the three servers whichever server the selector names, and the selector is not shown for that category
