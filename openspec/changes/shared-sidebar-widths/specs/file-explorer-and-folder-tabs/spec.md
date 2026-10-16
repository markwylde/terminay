## ADDED Requirements

### Requirement: Project-owned sidebar pane state

Every project SHALL own its sidebar pane ordering, collapse state, pane
dimensions, and supported pane navigation state. This presentation state SHALL
persist with the project in the server-owned workspace and MUST NOT alter
project files or another project's sidebar. Sidebar visibility SHALL be a
device-local preference keyed by the selected server and project. Sidebar width
SHALL NOT belong to a project: it SHALL be one device-remembered width shared by
every project.

#### Scenario: Pane layout persists with the project

- **WHEN** the user rearranges or collapses a project's sidebar panes and
  reconnects from another client
- **THEN** that project's pane ordering and collapse state are restored from
  server-owned workspace state

#### Scenario: Visibility stays device-local

- **WHEN** the user opens or closes Explorer on one device
- **THEN** another device's presentation for the same server and project is
  unchanged

#### Scenario: Width is not part of project state

- **WHEN** the user resizes a project's sidebar
- **THEN** the project's server-owned sidebar state is unchanged

## REMOVED Requirements

### Requirement: Project-owned sidebar presentation state

**Reason**: Sidebar width no longer belongs to a project; the remaining pane state moves to "Project-owned sidebar pane state".
**Migration**: Pane order, collapse state, and dimensions are unchanged. A stored per-project width is ignored, and the device's shared width applies.
