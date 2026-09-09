## MODIFIED Requirements

### Requirement: Layout controller boundaries

Pane content SHALL remain owned by its feature and project. The layout controller SHALL know pane identity, title geometry, expansion state, preferred size, and resize constraints, and SHALL NOT read files, Git state, agent state, or Documentation content. This capability SHALL NOT make sidebar preferences global, SHALL NOT write them into project files, and SHALL NOT introduce renderer filesystem authority. The stack SHALL provide only Terminay's vertical project-sidebar behaviour and SHALL NOT reproduce a general-purpose SplitView API, snapping modes, or an unrelated workbench layout system.

#### Scenario: Controller inputs

- **WHEN** the layout controller resolves a layout
- **THEN** it uses only pane identity, title geometry, expansion state, preferred size, and resize constraints

#### Scenario: No filesystem authority

- **WHEN** sidebar preferences are stored
- **THEN** they are not written into project files, are not global, and introduce no renderer filesystem authority
