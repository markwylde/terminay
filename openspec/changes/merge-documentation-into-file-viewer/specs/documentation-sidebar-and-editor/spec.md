## RENAMED Requirements

- FROM: `### Requirement: Flush on blur, presentation change, and close`
- TO: `### Requirement: Flush on blur, view change, and close`

## MODIFIED Requirements

### Requirement: Documentation capability scope

Each project SHALL expose a Documentation pane that recursively discovers Markdown and MDX files under the project root and presents them as a focused, folder-grouped document tree. Opening a document SHALL open it in the file viewer on the Document view: a rich MDXEditor editing surface with a formatting toolbar, live browser preview, and debounced autosave. The Document view SHALL be one view of the general-purpose file viewer and SHALL use its server-owned file identity, revision, draft, conflict, save, and watch guarantees. Executable previews SHALL use the isolated MDX browser runtime.

#### Scenario: Opening a document
- **WHEN** a user selects a document in the Documentation pane
- **THEN** a file viewer panel opens on the Document view with rich editing, live preview, and debounced autosave over the server-owned file session

### Requirement: Canonical Documentation panel identity

Selecting a document SHALL open or focus the one canonical file panel for that project file, and repeated opens SHALL NOT create duplicate panels. Opening the file through any surface SHALL focus the existing canonical file panel. If the request names a view, the panel SHALL switch to it; if the request names no view, the panel SHALL keep its current view. A switch SHALL NOT replace the panel's server-owned file session or draft.

#### Scenario: Reopening a document
- **WHEN** a user selects an already open document
- **THEN** the existing file panel is focused rather than duplicated

#### Scenario: Opening from Explorer
- **WHEN** a file already open on the Document view is opened from Explorer
- **THEN** the existing canonical file panel is focused and stays on the Document view

#### Scenario: Opening with a requested File Viewer mode
- **WHEN** a file already open on the Document view is opened with a requested view, such as Diff from Git changes
- **THEN** pending Document edits are flushed
- **AND** the existing canonical file panel switches to that view, keeping its server-owned file session and draft

### Requirement: Link handling

Project-relative `.md` and `.mdx` links SHALL open the target in the file viewer on the Document view. External links SHALL use the normal external-link policy.

#### Scenario: Following a relative document link
- **WHEN** a user follows a project-relative `.md` or `.mdx` link
- **THEN** the target opens on the Document view

#### Scenario: Following an external link
- **WHEN** a user follows an external link
- **THEN** the normal external-link policy applies

### Requirement: Documentation autosave debounce

The Document view SHALL autosave after one second without an editor change. Continued typing SHALL reset the debounce and SHALL NOT create overlapping saves. Autosave SHALL use the panel's server-owned file session and SHALL declare the expected disk and draft revisions, preserving atomic-write, canonical-path, size, authorization, and environment guarantees from the file viewer.

#### Scenario: Pausing typing
- **WHEN** a user stops editing on the Document view for one second
- **THEN** an autosave runs against the panel's server-owned file session declaring expected disk and draft revisions

#### Scenario: Continuous typing
- **WHEN** a user keeps typing
- **THEN** the debounce resets and no overlapping saves are issued

### Requirement: Flush on blur, view change, and close

Blur, a change away from the Document view, and an attempted close SHALL request an immediate flush of a pending debounce. Closing SHALL wait for the bounded in-flight result; a failure or conflict SHALL keep the draft and SHALL ask whether to keep the panel open or close while retaining the server-owned draft. A failed flush on a view change SHALL keep the panel on the Document view and report the failure.

#### Scenario: Closing with pending changes
- **WHEN** a user closes a panel on the Document view with a pending debounce
- **THEN** the save flushes immediately and the close waits for the bounded in-flight result

#### Scenario: Close-time save failure
- **WHEN** the flushed save fails or conflicts on close
- **THEN** the draft is retained and the user is asked whether to keep the panel open or close

#### Scenario: View change flush fails
- **WHEN** a user selects Text while a Document autosave is pending and the flush fails
- **THEN** the panel stays on the Document view and shows the save failure

### Requirement: Autosave scope and failure retry

Text and HEX views SHALL save explicitly. Leaving the Document view SHALL flush its pending autosave before the view changes and SHALL NOT turn Text or HEX editing into autosave. Autosave failure SHALL use bounded retry with visible status and user-triggered retry and SHALL NEVER run an unbounded write loop or silently drop a draft.

#### Scenario: Leaving Documentation mode
- **WHEN** a panel switches away from the Document view
- **THEN** the pending autosave flushes first and the new view keeps explicit save

#### Scenario: Repeated autosave failure
- **WHEN** autosave keeps failing
- **THEN** retry stays bounded with visible status and a user-triggered retry, and the draft is not dropped

## REMOVED Requirements

### Requirement: View source from a Documentation panel

**Reason**: The rich editor is the Document view of the file viewer, so the view switcher above it already reaches Text, HEX, Diff, and Tasks.
**Migration**: Select Text (or another view) in the view switcher. Leaving the Document view flushes pending edits as View source did.
