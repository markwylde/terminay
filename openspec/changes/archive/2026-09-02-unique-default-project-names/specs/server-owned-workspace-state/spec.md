## ADDED Requirements

### Requirement: Server-derived default project names

The `project.create` workspace command SHALL accept an absent or blank name. When
the name is absent or blank the server SHALL derive the project's default name
from the authoritative project set it holds at the moment the command is applied.
Clients SHALL NOT be relied on to derive a unique default, since no client can
see the authoritative set.

#### Scenario: Command omits a name
- **WHEN** a client applies `project.create` without a name
- **THEN** the server assigns the default name and the created project carries it in the resulting snapshot

#### Scenario: Command supplies a name
- **WHEN** a client applies `project.create` with a non-blank name
- **THEN** the project is created with that name unchanged
