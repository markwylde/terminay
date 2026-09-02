## ADDED Requirements

### Requirement: Unique default project names

A newly created project SHALL receive a default name that no existing project on
the server already holds. The default SHALL be `Project N` for the lowest
positive integer N not currently in use, so a number freed by closing a project
is reused before a higher one. A name supplied explicitly by a user SHALL be
honoured as given, including when it duplicates another project's name.

#### Scenario: Creating after closing a project
- **WHEN** a workspace holds "Project 1", "Project 2", and "Project 3", the user closes "Project 2", and then creates a project
- **THEN** the new project is named "Project 2" and no two projects share a name

#### Scenario: Rapid successive creation
- **WHEN** several projects are created in quick succession
- **THEN** each receives a distinct default name

#### Scenario: Creation across different entry points
- **WHEN** projects are created from the new-project button and from the environment chooser in the same workspace
- **THEN** their default names come from one numbering sequence and do not collide

#### Scenario: A user-chosen name is not rewritten
- **WHEN** a user renames a project to a name another project already uses
- **THEN** the name is stored as typed
