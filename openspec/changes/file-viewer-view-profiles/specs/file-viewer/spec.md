## MODIFIED Requirements

### Requirement: View modes

The file viewer SHALL provide Preview, Text, HEX, and Diff modes, and Tasks for Markdown. Text and HEX SHALL be editable; Preview, Tasks, and Diff SHALL be read-only. Switching modes SHALL NOT discard a draft. When a requested mode is unavailable, Terminay SHALL show the file's default view, SHALL keep the view switcher visible, and SHALL explain why the requested mode is unavailable.

#### Scenario: Default mode

- **WHEN** a file panel opens without a requested view
- **THEN** the selected mode is the default view for the file's type

#### Scenario: Switching modes with unsaved edits

- **WHEN** a user switches between Preview, Text, HEX, and Diff while a draft exists
- **THEN** the draft is retained

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

## ADDED Requirements

### Requirement: Default view by file type

A file panel SHALL open in the view that suits the file's server-published classification, unless the open request names a view or a custom extension default applies. Text, including text recognised only by its content, SHALL open in Text. Markdown, images, and PDFs with a safe preview SHALL open in Preview. Binary data with no safe preview SHALL open in HEX. A custom extension default that names a view the file cannot show SHALL give way to the file's default view.

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

The view switcher SHALL list as tabs only the views that can show the file, ordered with the default view's family first: Text, Preview, Diff for text; Preview, Tasks, Text, Diff for Markdown; Preview, HEX for a previewable image or PDF; HEX for other binary data. A view that can show the file but is not listed as a tab SHALL be reachable from a More views menu beside the tabs; HEX is such a view for every text file. A view chosen from that menu SHALL appear as a tab for as long as it is selected. Diff SHALL remain listed for a text file with nothing to compare, disabled, with the reason available from the tab. Views that cannot show the file SHALL NOT be listed.

#### Scenario: Text file tabs

- **WHEN** a source file with a safe preview is open
- **THEN** the switcher lists Text, Preview, and Diff
- **AND** HEX is offered from the More views menu

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

### Requirement: File panel chrome

A file panel SHALL carry no status bar of its own and SHALL NOT display the name of its text engine. Unsaved state SHALL be shown on the panel's tab. Text and Preview SHALL present the same file on the same surface colour with the same syntax palette and the same type size and line height.

#### Scenario: No in-panel status bar

- **WHEN** a file panel is open
- **THEN** the panel shows its view switcher and its content and no path, size, engine, or sync strip beneath them

#### Scenario: Switching between Preview and Text

- **WHEN** a user switches a source file between Preview and Text
- **THEN** the background, token colours, and text size are the same in both
