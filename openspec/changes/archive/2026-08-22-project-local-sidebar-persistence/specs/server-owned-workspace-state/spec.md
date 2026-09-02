## ADDED Requirements

### Requirement: Project-local sidebar state in the canonical model

Each canonical project record SHALL carry a bounded, validated sidebar model
covering pane visibility, collapse state, dimensions, order, and supported
Agents and Documentation navigation state. That model SHALL participate in the
normal workspace snapshot, revision, and delta contract.

#### Scenario: Snapshot contains sidebar state

- **WHEN** a client receives a workspace snapshot
- **THEN** each project record carries its own validated sidebar model

#### Scenario: Sidebar change publishes a delta

- **WHEN** a project's sidebar state changes
- **THEN** the normal workspace change event and delta envelope carry it

### Requirement: Authorized project-scoped sidebar patches

Sidebar state SHALL be changed only through an authenticated, project-scoped
workspace command. The server SHALL reject a patch whose authenticated identity
does not authorize the addressed project, and SHALL reject a patch that fails
validation. A rejected patch SHALL NOT change the workspace revision and SHALL
NOT alter any project's sidebar state.

#### Scenario: Cross-project patch

- **WHEN** a client submits a sidebar patch for a project it is not authorized
  for
- **THEN** the command is rejected and no workspace revision is produced

#### Scenario: Invalid patch

- **WHEN** a sidebar patch fails validation
- **THEN** it is rejected and the workspace revision is unchanged

### Requirement: Sidebar state migration for existing snapshots

A workspace snapshot without project-local sidebar state SHALL be migrated to
valid project-local defaults. The migration SHALL be idempotent and SHALL NOT
alter project identity, environment binding, panels, or layout.

#### Scenario: Legacy snapshot loaded

- **WHEN** a workspace snapshot without sidebar state is loaded
- **THEN** each project acquires valid project-local sidebar defaults while its
  identity, environment binding, panels, and layout are unchanged
