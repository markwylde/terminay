## ADDED Requirements

### Requirement: Macros surface selects a server

The Macros surface SHALL carry a server selector listing every attached
connection, defaulting to the server that owns the active project tab. It SHALL
list, create, edit, run, and delete only macros of the selected server, and SHALL
NEVER present two servers' macros as one list. Selecting a connection that is
unavailable or incompatible SHALL show that connection's state instead of macros.

#### Scenario: Default selection

- **WHEN** the user opens Macros while a project of an attached server is active
- **THEN** the selector starts on that server and lists that server's macros

#### Scenario: Macros are not merged

- **WHEN** two attached servers each hold macros
- **THEN** the surface shows only the selected server's macros and no combined list

#### Scenario: Editing applies to one server

- **WHEN** the user creates, edits, or deletes a macro
- **THEN** the command is sent only to the selected server
