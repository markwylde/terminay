## ADDED Requirements

### Requirement: Home sidebar width

The Home sidebar SHALL have its own width, kept apart from the Folders tree and project sidebar widths: resizing one SHALL NEVER change another. The device SHALL remember the Home sidebar width as device presentation state that never travels through a server, and SHALL restore it after a restart or reload. A device that has no remembered Home sidebar width SHALL present the Home sidebar at its built-in default width.

#### Scenario: Width survives a restart

- **WHEN** a user resizes the Home sidebar and later restarts or reloads the client on the same device
- **THEN** the Home sidebar is presented at the width last chosen on the device

#### Scenario: Independent from project columns

- **WHEN** a user resizes the Home sidebar
- **THEN** no project's Folders tree or sidebar width changes, and resizing a project column does not change the Home sidebar width

#### Scenario: First visit on a device

- **WHEN** a device that has never resized the Home sidebar selects Home
- **THEN** the Home sidebar is presented at its built-in default width
