## MODIFIED Requirements

### Requirement: Presentation selection for Markdown and MDX

The presentation of a Markdown (`.md`) or MDX (`.mdx`) file panel SHALL be chosen by the file type and the requested mode, never by which surface made the request. Every request SHALL either name a presentation, name a File Viewer mode, or name neither. A request that names a presentation SHALL use it. A request that names a File Viewer mode (Preview, Tasks, Text, HEX, or Diff) SHALL use the File Viewer presentation in that mode. When a new panel is opened by a request that names neither, a Markdown or MDX file SHALL use the Documentation presentation and any other file SHALL use the File Viewer presentation. When a request that names neither targets a file that already has a panel, the panel SHALL be focused and keep its current presentation. Both presentations SHALL share one canonical panel, file session, and draft; they SHALL NOT create competing file sessions or drafts.

#### Scenario: Opened from Documentation

- **WHEN** a user opens a Markdown or MDX file from the Documentation surface
- **THEN** the canonical panel uses the Documentation presentation with the same file session and draft lifecycle

#### Scenario: Opened from Explorer

- **WHEN** a user opens a Markdown or MDX file that has no panel from Explorer
- **THEN** a panel opens in the Documentation presentation

#### Scenario: Opened from a Folder tab or by drag

- **WHEN** a user opens a Markdown or MDX file that has no panel from a Folder tab, or drags it onto the tab area
- **THEN** a panel opens in the Documentation presentation

#### Scenario: Opened from a Markdown preview link

- **WHEN** a user follows a project-relative link to a Markdown or MDX file from a rendered Markdown preview
- **THEN** the linked file opens in the Documentation presentation

#### Scenario: Non-Markdown file from Explorer

- **WHEN** a user opens a file that is neither Markdown nor MDX from Explorer
- **THEN** a panel opens in the File Viewer presentation

#### Scenario: A File Viewer mode is requested

- **WHEN** a Markdown or MDX file is opened with a requested File Viewer mode, such as Diff from Git changes, Text from go-to-definition, or Tasks from a task card
- **THEN** the canonical panel uses the File Viewer presentation in that mode
- **AND** no second file session or draft is created

#### Scenario: Reopening a panel without a requested mode

- **WHEN** a Markdown file already open in the File Viewer presentation is opened again from Explorer
- **THEN** the existing panel is focused and stays in the File Viewer presentation

## ADDED Requirements

### Requirement: Switching a Markdown file panel into Documentation

The File Viewer toolbar SHALL offer an accessible **Open as document** action for Markdown and MDX files, and for no other file. The action SHALL switch the same canonical panel to the Documentation presentation. The panel SHALL keep its server-owned file session, draft, and dirty state.

#### Scenario: Switching to the document view

- **WHEN** a user activates Open as document on a Markdown file panel in the File Viewer presentation
- **THEN** the same panel shows the Documentation presentation with its existing draft

#### Scenario: Not offered for other files

- **WHEN** a File Viewer panel shows a file that is neither Markdown nor MDX
- **THEN** the toolbar offers no Open as document action
