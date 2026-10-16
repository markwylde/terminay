## ADDED Requirements

### Requirement: Column widths shared across projects

The Folders tree SHALL have one width and the project sidebar SHALL have one width, and every project in a window SHALL be presented with those widths. Finishing a resize of either column in one project SHALL resize that column in every project, while the other column keeps its width. The device SHALL remember each width as device presentation state that never travels through a server, and SHALL restore both after a restart or reload. A device that has no remembered width for a column SHALL present that column at its built-in default width. A width SHALL be stored as a whole number of pixels and SHALL still be clamped to the space available whenever it is presented.

#### Scenario: Resizing one project's sidebar

- **WHEN** a user resizes the sidebar in one project and then switches to another project
- **THEN** the other project's sidebar has the same width

#### Scenario: Columns are remembered independently

- **WHEN** a user resizes the Folders tree
- **THEN** the sidebar's width is unchanged in every project

#### Scenario: Restarting the device

- **WHEN** a user resizes either column and later restarts or reloads the client on the same device
- **THEN** every project presents that column at the width last chosen on the device

#### Scenario: Another device is unaffected

- **WHEN** a user resizes a column on one device
- **THEN** no workspace command is sent and another device connected to the same server keeps its own widths

#### Scenario: First use on a device

- **WHEN** a device has never resized a column
- **THEN** that column is presented at its built-in default width

## MODIFIED Requirements

### Requirement: Preview and commit boundary for resizing

Pointer movement SHALL be presentation-local preview state. It SHALL NOT submit workspace commands, publish workspace revisions, or allow an incoming canonical snapshot to fight the in-progress drag. Completing a pointer or keyboard resize SHALL commit the final normalized preference vector for every visible expanded pane in the active group once, through one project-scoped sidebar update, preserving the rendered boundary when the local preview yields to controlled state; collapsed panes SHALL retain their stored body preference. Cancelling a resize SHALL restore the pre-drag presentation and SHALL NOT commit it. Sidebar width SHALL follow the same preview boundary, with live pointer movement local; when resizing finishes, the final width SHALL be remembered once on the device and SHALL NOT produce a workspace command.

#### Scenario: Resize in progress

- **WHEN** a user is dragging a separator or the sidebar width handle
- **THEN** no canonical sidebar commands are produced and no workspace revision is published

#### Scenario: Resize completed

- **WHEN** a pointer or keyboard resize completes
- **THEN** exactly one project-scoped command commits the final normalized preference vector for every visible expanded pane
- **AND** collapsed panes retain their stored body preference

#### Scenario: Sidebar width resize completed

- **WHEN** a sidebar width resize completes
- **THEN** the final width is remembered on the device once and no workspace command is produced

#### Scenario: Resize cancelled

- **WHEN** a resize is cancelled
- **THEN** the pre-drag presentation is restored and no command is produced

### Requirement: Pointer gesture handling

Resize handling SHALL support pointer capture, SHALL prevent text selection and native dragging, and SHALL keep window-level listeners for the gesture. This SHALL apply to every resize separator in the sidebar, including the sidebar width separator, whose handle also moves with its preview. Losing capture because the separator moved with the preview SHALL NOT cancel the resize, and pointer-up SHALL still commit it. `pointercancel`, window blur, hidden visibility, and unmount SHALL cancel it.

#### Scenario: Capture lost by preview movement

- **WHEN** the separator moves with the preview and pointer capture is lost
- **THEN** the resize continues and pointer-up still commits it

#### Scenario: Sidebar width capture lost mid-drag

- **WHEN** pointer capture is lost during a sidebar width drag while the pointer is still held
- **THEN** the sidebar keeps following the pointer, and releasing it remembers the dragged width on the device once

#### Scenario: Gesture aborted

- **WHEN** `pointercancel`, window blur, hidden visibility, or unmount occurs during a resize
- **THEN** the resize is cancelled

#### Scenario: Text selection suppressed

- **WHEN** a resize gesture is in progress
- **THEN** text selection and native dragging are prevented
