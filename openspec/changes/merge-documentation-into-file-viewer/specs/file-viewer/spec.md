## ADDED Requirements

### Requirement: View selection when opening Markdown and MDX

Opening a Markdown (`.md`) or MDX (`.mdx`) file SHALL always show it in the file viewer. The view SHALL be chosen by the file type and the requested view, never by which surface made the request. A request that names a view (Document, Preview, Tasks, Text, HEX, or Diff) SHALL open the canonical panel on that view. When a new panel is opened by a request that names no view, it SHALL open on the file's default view. When a request that names no view targets a file that already has a panel, that panel SHALL be focused and SHALL keep its current view. Every view SHALL share one canonical panel, file session, and draft.

#### Scenario: Opened from the Documentation pane

- **WHEN** a user opens a Markdown or MDX file that has no panel from the Documentation pane
- **THEN** a file viewer panel opens on the Document view

#### Scenario: Opened from Explorer

- **WHEN** a user opens a Markdown or MDX file that has no panel from Explorer
- **THEN** a file viewer panel opens on the Document view

#### Scenario: Opened from a Folder tab or by drag

- **WHEN** a user opens a Markdown or MDX file that has no panel from a Folder tab, or drags it onto the tab area
- **THEN** a file viewer panel opens on the Document view

#### Scenario: Opened from a rendered document link

- **WHEN** a user follows a project-relative link to a Markdown or MDX file from a rendered Markdown or MDX document
- **THEN** the linked file opens in the file viewer on the Document view

#### Scenario: Opened in a linked folder

- **WHEN** a user opens a Markdown file that has no panel from a linked worktree folder
- **THEN** a file viewer panel opens on the Document view and edits that worktree's file

#### Scenario: A view is requested

- **WHEN** a Markdown or MDX file is opened with a requested view, such as Diff from Git changes, Text from go-to-definition, or Tasks from a task card
- **THEN** the canonical panel shows that view
- **AND** no second file session or draft is created

#### Scenario: Reopening a panel without a requested view

- **WHEN** a Markdown file already showing Text is opened again from Explorer
- **THEN** the existing panel is focused and stays on Text

### Requirement: Document view

The file viewer SHALL offer a Document view for Markdown (`.md`) and MDX (`.mdx`) files, and for no other file. The Document view SHALL be the rich MDXEditor surface with its formatting toolbar, live preview, and one-second autosave, as specified by `documentation-sidebar-and-editor`. It SHALL edit the panel's own file session and draft through the same folder-scoped file authority that Text uses, so it edits the file the panel names in every folder, including linked worktree folders. Live execution of MDX components SHALL be offered only where the panel's folder may use the project-root MDX runtime; elsewhere the Document view SHALL still edit the file and SHALL show MDX component blocks without executing them.

#### Scenario: Formatting a Markdown file

- **WHEN** a Markdown file is open on the Document view
- **THEN** the formatting toolbar is shown and formatting changes edit the panel's draft

#### Scenario: Not offered for other files

- **WHEN** a file panel shows a file that is neither Markdown nor MDX
- **THEN** the view switcher offers no Document view

#### Scenario: MDX in a linked folder

- **WHEN** an MDX file in a linked worktree folder is open on the Document view
- **THEN** the document can be edited and saved to that worktree's file
- **AND** its MDX components are shown without being executed

## MODIFIED Requirements

### Requirement: View modes

The file viewer SHALL provide Preview, Text, HEX, and Diff modes, Tasks for Markdown, and Document for Markdown (`.md`) and MDX (`.mdx`). Document, Text, and HEX SHALL be editable; Preview, Tasks, and Diff SHALL be read-only. Document SHALL autosave; Text and HEX SHALL save explicitly. Switching modes SHALL NOT discard a draft, and leaving Document SHALL first flush its pending autosave. When a requested mode is unavailable, Terminay SHALL show the file's default view, SHALL keep the view switcher visible, and SHALL explain why the requested mode is unavailable.

#### Scenario: Default mode

- **WHEN** a file panel opens without a requested view
- **THEN** the selected mode is the default view for the file's type

#### Scenario: Switching modes with unsaved edits

- **WHEN** a user switches between Document, Preview, Text, HEX, and Diff while a draft exists
- **THEN** the draft is retained

#### Scenario: Leaving Document with a pending autosave

- **WHEN** a user switches from Document to Text before the autosave debounce elapses
- **THEN** the pending autosave flushes before Text is shown
- **AND** Text keeps explicit save

#### Scenario: Requested mode unavailable

- **WHEN** a requested mode is unavailable for the file
- **THEN** Terminay shows the file's default view, keeps the view switcher visible, and explains why the requested mode is unavailable

#### Scenario: Diff requested for a text file with nothing to compare

- **WHEN** a text file is opened for its diff and no diff is available
- **THEN** the file opens in Text
- **AND** HEX is not shown

#### Scenario: Read-only modes

- **WHEN** a user attempts to edit in Preview or Diff
- **THEN** the mode accepts no edits

### Requirement: Default view by file type

A file panel SHALL open in the view that suits the file's server-published classification, unless the open request names a view or a custom extension default applies. Markdown (`.md`) and MDX (`.mdx`) files SHALL open in Document. Text, including text recognised only by its content, SHALL open in Text. Other Markdown, images, and PDFs with a safe preview SHALL open in Preview. Binary data with no safe preview SHALL open in HEX. A custom extension default that names a view the file cannot show SHALL give way to the file's default view.

#### Scenario: Markdown file

- **WHEN** a user opens `README.md`
- **THEN** Document is the selected view

#### Scenario: MDX file

- **WHEN** a user opens an `.mdx` file
- **THEN** Document is the selected view

#### Scenario: Source file

- **WHEN** a user opens a TypeScript file
- **THEN** Text is the selected view

#### Scenario: Text with no recognised extension

- **WHEN** a user opens a file named `Dockerfile` whose content is valid text
- **THEN** Text is the selected view

#### Scenario: Image

- **WHEN** a user opens a PNG image
- **THEN** Preview is the selected view

#### Scenario: Unrecognised binary data

- **WHEN** a user opens a file whose content is binary and has no safe preview
- **THEN** HEX is the selected view

### Requirement: View switcher follows file type

The view switcher SHALL list as tabs only the views that can show the file, ordered with the default view's family first: Text, Preview, Diff for text; Document, Preview, Tasks, Text, Diff for Markdown (`.md`) and MDX (`.mdx`); Preview, Tasks, Text, Diff for other Markdown; Preview, HEX for a previewable image or PDF; HEX for other binary data. A view that can show the file but is not listed as a tab SHALL be reachable from a More views menu beside the tabs; HEX is such a view for every text file. A view chosen from that menu SHALL appear as a tab for as long as it is selected. Diff SHALL remain listed for a text file with nothing to compare, disabled, with the reason available from the tab. Views that cannot show the file SHALL NOT be listed.

#### Scenario: Text file tabs

- **WHEN** a source file with a safe preview is open
- **THEN** the switcher lists Text, Preview, and Diff
- **AND** HEX is offered from the More views menu

#### Scenario: Markdown file tabs

- **WHEN** a Git-tracked `.md` file is open
- **THEN** the switcher lists Document, Preview, Tasks, Text, and Diff, in that order, with Document selected

#### Scenario: Choosing HEX for a text file

- **WHEN** a user chooses HEX from the More views menu
- **THEN** HEX is shown and appears as the selected tab
- **AND** returning to Text removes the HEX tab

#### Scenario: Image tabs

- **WHEN** a PNG image is open
- **THEN** the switcher lists Preview and HEX only

#### Scenario: Nothing to compare

- **WHEN** a text file that Git does not track is open
- **THEN** Diff is listed, cannot be selected, and gives its reason

## REMOVED Requirements

### Requirement: Presentation selection for Markdown and MDX

**Reason**: There is one file viewer presentation. Rich editing is its Document view, so choosing a presentation becomes choosing a view.
**Migration**: Replaced by "View selection when opening Markdown and MDX". Requests that named the Documentation presentation now name the Document view, and a panel persisted with the Documentation presentation restores on the Document view.

### Requirement: Switching a Markdown file panel into Documentation

**Reason**: The Document tab in the view switcher does what Open as document did.
**Migration**: Select the Document tab.
