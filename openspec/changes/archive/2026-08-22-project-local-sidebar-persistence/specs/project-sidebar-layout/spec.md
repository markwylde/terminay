## ADDED Requirements

### Requirement: Project-local sidebar persistence

A project's sidebar visibility, pane collapse state, dimensions, order, and
supported Agents and Documentation navigation state SHALL be persisted with that
project in canonical server-owned workspace state. A Terminay restart, renderer
reload, reconnect, or an additional authorized client SHALL restore that
project's own sidebar exactly as it was committed.

#### Scenario: Restart

- **WHEN** Terminay restarts and the project is opened again
- **THEN** its sidebar returns exactly as it was

#### Scenario: Reconnect or second client

- **WHEN** a renderer reconnects or a second authorized client opens the project
- **THEN** it presents that project's committed sidebar state

### Requirement: Sidebar changes are confined to one project

Changing Explorer, Agents, Git, or Documentation presentation in one project
SHALL leave every other project's sidebar visibility, order, dimensions,
collapse state, and supported navigation state unchanged.

#### Scenario: Two open projects

- **WHEN** a user changes one project's sidebar
- **THEN** the second project's visibility, order, dimensions, collapse state,
  and supported navigation state are unchanged

### Requirement: Settings sidebar values are new-project defaults

The Settings sidebar values SHALL apply only as defaults for newly created
projects. Interacting with an existing project's sidebar SHALL NOT rewrite those
settings.

#### Scenario: New project created

- **WHEN** a project is created
- **THEN** its sidebar state starts from the Settings sidebar defaults

#### Scenario: Adjusting an existing project

- **WHEN** a user adjusts an existing project's sidebar
- **THEN** the Settings sidebar defaults are unchanged
