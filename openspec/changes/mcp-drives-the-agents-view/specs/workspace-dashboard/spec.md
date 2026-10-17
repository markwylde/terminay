## ADDED Requirements

### Requirement: Terminals outside the window's projects

The Tabs section SHALL list every terminal on the window's current server,
including terminals no project tab in this window presents. After the
window's own projects, it SHALL list each project of another workspace view
that holds a terminal, titled with the project's name and "not in this
window", and then the automation space, titled "Automations", each with their
terminals. Activating a terminal of the automation space SHALL open it in the
Automations section. Activating a terminal or project of another view SHALL
bring that project into this window. The automation space SHALL NOT become a
project tab.

#### Scenario: An agent opened a terminal in the automation space

- **WHEN** Pixel opens a terminal with no project and the user opens Tabs
- **THEN** the terminal is listed under Automations, and activating it opens it in the Automations section

#### Scenario: A project in a view no window shows

- **WHEN** a project with a running terminal is in a workspace view this window does not present
- **THEN** Tabs lists it as not in this window, and activating it brings the project into this window

#### Scenario: Nothing elsewhere

- **WHEN** every terminal on the server is in this window's projects
- **THEN** Tabs lists only this window's projects
