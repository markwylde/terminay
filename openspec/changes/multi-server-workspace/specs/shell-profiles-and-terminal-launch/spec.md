## ADDED Requirements

### Requirement: Shell profiles surface selects a server

The shell-profiles surface SHALL carry a server selector listing every attached
connection, defaulting to the server that owns the active project tab. It SHALL
present the catalogue, System default, and discovered shells of exactly the
selected server, and SHALL NEVER combine two servers' catalogues into one list.
An executable path validated for one server SHALL NEVER be offered as another
server's profile.

#### Scenario: Default selection

- **WHEN** the user opens shell profiles while a project of an attached server is
  active
- **THEN** the selector starts on that server and shows that server's catalogue

#### Scenario: Catalogues are not merged

- **WHEN** two attached servers each expose discovered shells
- **THEN** only the selected server's shells are listed

#### Scenario: A path is not carried across servers

- **WHEN** the user selects another attached connection after validating an
  executable path
- **THEN** that path is not offered as the newly selected server's profile and is
  revalidated on that server before use
