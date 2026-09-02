## ADDED Requirements

### Requirement: Native project-host window binding

A native project-host window SHALL be bound to exactly one canonical workspace
view id. That bound id SHALL be carried through window creation and the host
preload boundary as a bound value, and SHALL NOT confer generic workspace
authority on the renderer. Moving a project between views SHALL preserve its
canonical project, panel, and terminal session identities.

#### Scenario: Binding crosses the preload boundary narrowly

- **WHEN** a native window is created for a workspace view
- **THEN** the renderer receives that view's id
- **AND** it gains no capability to address another view

#### Scenario: Cross-view move preserves identity

- **WHEN** a project is moved from one workspace view to another
- **THEN** its project, panel, and terminal session ids are unchanged
