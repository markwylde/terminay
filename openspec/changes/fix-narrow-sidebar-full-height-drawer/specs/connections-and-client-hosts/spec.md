## MODIFIED Requirements

### Requirement: Parity of Desktop and web workspace surfaces

Desktop and web SHALL render the same projects, panels, files, terminals, settings, recordings, agents, and connection state. Wide layouts SHALL resemble the Electron workspace. Narrow layouts SHALL replace wide tab strips and sidebars with accessible selectors, drawers, stacked surfaces, and touch controls while retaining the same server object ids. A narrow-layout navigation drawer SHALL occupy the full height available to the workspace rather than a fixed fraction of the viewport, and SHALL overlay the workspace content rather than reducing the height allotted to it. Native-only window operations SHALL be capability-gated, and web clients SHALL manage server-owned logical workspace views through in-page navigation rather than requiring popup windows.

#### Scenario: Narrow layout keeps server object ids

- **WHEN** the workspace renders at a narrow width
- **THEN** selectors, drawers, and stacked surfaces are used while server object ids stay the same

#### Scenario: Narrow navigation drawer fills the viewport

- **WHEN** workspace navigation is opened at a narrow width
- **THEN** the drawer occupies the full height available to the workspace
- **AND** the workspace content is overlaid rather than compressed

#### Scenario: Web needs no popup windows

- **WHEN** a web client manages server-owned logical workspace views
- **THEN** it uses in-page navigation rather than requiring popup windows
