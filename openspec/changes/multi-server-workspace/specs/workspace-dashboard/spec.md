## MODIFIED Requirements

### Requirement: Dashboard row model

The dashboard SHALL present every project of every attached connection, in the window's tab order, as a one-line header row carrying the project's colour, emoji, name, and a roll-up of its panels' statuses, immediately followed by one row per panel in that project, in panel order, carrying the panel's status, kind, title, and — for a terminal under agent authority — its agent state. Every row SHALL be keyed by the pair of its server and its project, and when more than one connection is attached each project header row SHALL name the server that owns it. A project with no panels SHALL still show its header row. A connection that is unavailable or incompatible SHALL still contribute its project header rows, showing that connection's state in place of a panel roll-up. The dashboard SHALL show every project and every panel, including idle ones, and SHALL NEVER omit a project because nothing is happening in it.

#### Scenario: Projects and panels listed

- **WHEN** the dashboard renders
- **THEN** every project appears in project order as a header row followed by its panels in panel order

#### Scenario: Quiet workspace

- **WHEN** no project has any notable activity
- **THEN** every project and panel still appears, each showing an idle status

#### Scenario: Empty project

- **WHEN** a project holds no panels
- **THEN** its header row is still shown

#### Scenario: Projects from two attached servers

- **WHEN** two connections are attached and each owns projects
- **THEN** the dashboard lists the projects of both, each header row naming its own server, and no two servers' projects are merged into one row

#### Scenario: Unavailable connection

- **WHEN** an attached connection is offline, reconnecting, or incompatible
- **THEN** its project header rows still appear and show that connection's state instead of a panel roll-up
