## MODIFIED Requirements

### Requirement: Explorer pane and project root presentation

The Explorer SHALL watch the root of the project's selected folder and SHALL
support refresh, collapse/expand, configurable default visibility and width, and
Git new/modified decoration. Files and Changes SHALL share the Explorer sidebar
group; Documentation and Agents SHALL occupy their own groups.

#### Scenario: Explorer shows the project root

- **WHEN** a project with a valid root is open with General selected
- **THEN** the Explorer presents that root's tree with refresh and
  collapse/expand controls
- **AND** entries carry Git new/modified decoration

#### Scenario: Explorer shows a linked folder's worktree

- **WHEN** a linked folder is selected
- **THEN** the Explorer presents that folder's worktree, with Git decoration
  taken from that worktree

#### Scenario: Configured default visibility and width apply

- **WHEN** the Explorer is first shown for a project
- **THEN** it opens at its configured default visibility and width
