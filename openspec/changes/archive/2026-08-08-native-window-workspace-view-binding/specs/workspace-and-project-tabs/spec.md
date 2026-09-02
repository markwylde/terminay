## ADDED Requirements

### Requirement: One workspace view per project-host window

Each native project-host window SHALL be bound to exactly one canonical
server-owned workspace view and SHALL render only that view's ordered projects.
A window SHALL NOT flatten other workspace views into its project tab bar.

#### Scenario: Window shows only its bound view

- **WHEN** a server owns more than one workspace view
- **THEN** each native window shows only the projects of the view it is bound to

#### Scenario: Refresh reproduces the split

- **WHEN** either renderer is refreshed
- **THEN** the same project and view split is reproduced from the server
  snapshot

### Requirement: Project tear-off is an identity-preserving move

Tearing a project off into a new native window SHALL create a destination
workspace view and commit a project move. The project id, panel ids, terminal
session ids, and active panel SHALL be preserved. The operation SHALL NOT copy
renderer presentation state, SHALL NOT assign a synthetic project id, and SHALL
NOT be reported or executed as a project close.

#### Scenario: Identities survive the tear-off

- **WHEN** a project is torn off into a new window
- **THEN** it retains its project id, panel ids, terminal session ids, and
  active panel

#### Scenario: Source window loses only the moved project

- **WHEN** the tear-off completes
- **THEN** the source window contains only the source view's remaining projects

#### Scenario: Destination never shows an unrelated project

- **WHEN** the destination window is created and reconciled
- **THEN** it contains only the moved project's view
- **AND** it never momentarily commits an unrelated project as destination state

#### Scenario: Moving is not closing

- **WHEN** a project with a running foreground process is moved
- **THEN** no close warning is prompted
- **AND** no project close is recorded

### Requirement: Tear-off failure rolls back cleanly

If destination view creation or the move fails, the project SHALL remain usable
in its original view, and any unusable destination window or view SHALL be
closed or cleaned up rather than left empty.

#### Scenario: Failed move leaves the source intact

- **WHEN** the move command fails
- **THEN** the project stays in its original view and remains usable
- **AND** no empty destination view is stranded

### Requirement: Torn-off window activation

A ready destination window SHALL be activated so that the first click on a
terminal control within it performs that control's action rather than being
consumed by window activation.

#### Scenario: First click creates a terminal

- **WHEN** the first terminal-tab add control is clicked in a newly torn-off
  window
- **THEN** the next terminal is created without requiring a second click
