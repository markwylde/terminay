## MODIFIED Requirements

### Requirement: Project tab editing surface

Double-clicking a project tab SHALL open project-tab editing in the current host's auxiliary-route presentation: Desktop MAY use a native modal window and web SHALL use an in-page edit-tab surface. Saving SHALL update the server-owned project name, root, colour, and icon; cancel SHALL leave project state unchanged.

A client SHALL apply its saves of one project in submission order, finishing the server writes of one save before starting those of the next. A save whose root field was not changed SHALL NOT change the project's committed root, including when another client changed that root after the editor opened. A save refused because the workspace revision is stale SHALL rebuild its request from the refreshed workspace and try again, up to four attempts. A save that exhausts those attempts, meets any other conflict, or cannot refresh SHALL fail visibly, and later saves of that project SHALL still run. Closing an editor SHALL return focus to the project's terminal only when no newer editor has been opened.

#### Scenario: Saving an edit
- **WHEN** a user saves project-tab editing
- **THEN** the server-owned project name, root, colour, and icon are updated

#### Scenario: Cancelling an edit
- **WHEN** a user cancels project-tab editing
- **THEN** project state is unchanged

#### Scenario: Reopening the editor just after a save
- **WHEN** a user saves project-tab editing and opens the editor again before terminal focus has been restored
- **THEN** the open editor keeps focus and nothing typed into it reaches the terminal

#### Scenario: Two saves in quick succession
- **WHEN** a user saves a new root and saves a second new root before the first save has finished
- **THEN** the project ends on the second root

#### Scenario: A rename opened before a root change landed
- **WHEN** an edit opened with an older root changes only the name, and the server has since committed a newer root
- **THEN** the project takes the new name and keeps the newer root

#### Scenario: Another client changes the root during a retry
- **WHEN** a save that did not change the root is refused as stale because another client committed a new root
- **THEN** the retry keeps that new root and applies the save's other values

#### Scenario: The workspace keeps changing during a save
- **WHEN** the workspace revision advances during a save and a later attempt is accepted
- **THEN** the save's values are applied

#### Scenario: A save cannot be applied
- **WHEN** a save exhausts its stale-revision attempts, meets another conflict, or cannot refresh the workspace
- **THEN** the user sees that the save failed, the committed project is not partly overwritten by a retry, and the next save of that project still runs
