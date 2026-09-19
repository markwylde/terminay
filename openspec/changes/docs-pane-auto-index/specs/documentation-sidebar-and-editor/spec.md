## ADDED Requirements

### Requirement: Documentation pane auto-expands on first visit

Selecting the Documentation sidebar group SHALL expand the Documentation pane the first time that group is shown for a project in an app session, and SHALL start catalog indexing if no catalog has been built yet. Once the user collapses the pane themselves, selecting the group again SHALL leave it collapsed for the rest of that app session. A later app session SHALL again expand it on first visit.

#### Scenario: First visit in a session
- **WHEN** a user selects the Documentation sidebar group for the first time in an app session and the pane's stored state is collapsed
- **THEN** the pane expands and catalog indexing starts

#### Scenario: Manual collapse within the session
- **WHEN** a user collapses the Documentation pane and later returns to the Documentation sidebar group in the same app session
- **THEN** the pane stays collapsed

#### Scenario: Next app session
- **WHEN** the app is restarted and the user selects the Documentation sidebar group
- **THEN** the pane expands again on that first visit

### Requirement: Background catalog indexing owned by the project

Catalog indexing SHALL be a background activity scoped to the project rather than to the visibility of the Documentation pane. Once started, an in-flight catalog build and its root observation subscription SHALL survive switching sidebar groups, hiding the sidebar, and collapsing the Documentation pane, and SHALL continue to completion. They SHALL be torn down only when the project, root, or server changes, or when the user stops the build.

#### Scenario: Switching sidebar group mid-index
- **WHEN** a catalog build is in flight and the user switches to another sidebar group or hides the sidebar
- **THEN** the build continues and its result is available when the pane is shown again

#### Scenario: Collapsing the pane mid-index
- **WHEN** a catalog build is in flight and the user collapses the Documentation pane
- **THEN** the build continues rather than being cancelled

#### Scenario: Project scope ends
- **WHEN** the project, root, or server changes
- **THEN** the in-flight build and the root observation subscription are cancelled

### Requirement: Indexing progress and cancellation in the pane header

While a catalog build is in flight the Documentation pane header SHALL show a progress indicator in place of the refresh control, together with an accessibly labelled stop control. Activating stop SHALL cancel the in-flight build, retain the previously loaded catalog — an empty tree when none had loaded — and restore the refresh control. The header SHALL return to the refresh control when a build completes or fails.

#### Scenario: Build in flight
- **WHEN** a catalog build is in flight
- **THEN** the pane header shows a progress indicator in place of the refresh control and an accessibly labelled stop control beside it

#### Scenario: Stopping a build
- **WHEN** a user activates the stop control during a build
- **THEN** the build is cancelled, the previously loaded catalog is retained, and the refresh control returns

#### Scenario: Build settles
- **WHEN** a catalog build completes or fails
- **THEN** the progress indicator and stop control are replaced by the refresh control

## MODIFIED Requirements

### Requirement: Documentation pane placement and persistence

Documentation SHALL live in the Documentation sidebar group as a collapsible, vertically resizable pane. Additional panes in that group SHALL be reorderable with it, and its height and collapse state SHALL persist with the project, subject to the pane auto-expanding on its first visit in an app session. The pane SHALL appear for every project, and its order, height, collapse state, and folder expansion state SHALL persist with that project without changing project files or another project's sidebar.

#### Scenario: Resizing and collapsing
- **WHEN** a user resizes, collapses, or reorders the Documentation pane
- **THEN** the choice persists with that project and does not change project files or another project's sidebar

#### Scenario: Every project has the pane
- **WHEN** any project is opened
- **THEN** the Documentation pane is present in its Documentation sidebar group

### Requirement: Tree row behaviour

Folder rows SHALL expand and collapse without opening a tab. Document rows SHALL expose their project-relative location accessibly when the display title differs from the filename. A manual refresh SHALL be available whenever no catalog build is in flight, so that the tree can be rescanned when filesystem observation is unavailable or when the user wants an immediate rescan.

#### Scenario: Expanding a folder
- **WHEN** a user expands or collapses a folder row
- **THEN** no tab opens

#### Scenario: Title differs from filename
- **WHEN** a document's display title differs from its filename
- **THEN** its project-relative location is exposed accessibly

#### Scenario: Manual refresh
- **WHEN** observation is unavailable or a user requests a rescan, and no catalog build is in flight
- **THEN** manual refresh is available
