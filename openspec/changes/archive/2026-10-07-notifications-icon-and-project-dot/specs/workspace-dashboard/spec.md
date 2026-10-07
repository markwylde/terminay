## MODIFIED Requirements

### Requirement: Workspace panel inventory

Each project SHALL publish an inventory of every panel it holds — terminal, file, and folder panels alike — carrying panel identity, project identity, title, panel kind, presentation colour and emoji, and status, whether or not that panel is currently notable. The inventory SHALL be republished when a panel is added, removed, renamed, or moved, and when a panel's status changes. Surfaces that show only notable panels SHALL derive their contents by filtering that inventory rather than by receiving a separate publication.

#### Scenario: Idle panel is inventoried

- **WHEN** a project holds an idle terminal and an open file panel
- **THEN** both appear in that project's inventory with their kind and status

#### Scenario: Panel added or renamed

- **WHEN** a panel is added, removed, renamed, or moved between projects
- **THEN** the affected projects republish their inventory

#### Scenario: Notable-only surfaces

- **WHEN** the header Notifications list and project tab dots render
- **THEN** their contents are a filter over the inventory and unchanged from what they would show for the same panels
