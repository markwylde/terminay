## MODIFIED Requirements

### Requirement: Canonical Documentation panel identity

Selecting a document SHALL open or focus one canonical Documentation panel for that project file, and repeated opens SHALL NOT create duplicate Documentation panels. A normal File Viewer panel and a Documentation panel for the same canonical file SHALL NOT coexist. Opening the file through any surface SHALL focus the existing canonical file panel. If the request names a presentation or a File Viewer mode, the panel SHALL switch to it; if the request names neither, the panel SHALL keep its current presentation. A switch SHALL NOT replace the panel's server-owned file session or draft.

#### Scenario: Reopening a document
- **WHEN** a user selects an already open document
- **THEN** the existing Documentation panel is focused rather than duplicated

#### Scenario: Opening from Explorer
- **WHEN** a file already open in Documentation mode is opened from Explorer
- **THEN** the existing canonical file panel is focused and stays in Documentation mode

#### Scenario: Opening with a requested File Viewer mode
- **WHEN** a file already open in Documentation mode is opened with a requested File Viewer mode, such as Diff from Git changes
- **THEN** pending Documentation edits are flushed
- **AND** the existing canonical file panel switches to the File Viewer presentation in that mode, keeping its server-owned file session and draft

## ADDED Requirements

### Requirement: View source from a Documentation panel

The Documentation toolbar SHALL offer an accessible, keyboard-operable **View source** action. The action SHALL flush pending Documentation edits and switch the same canonical panel to the File Viewer presentation with its mode switcher, keeping the server-owned file session and draft. If the flush fails, the panel SHALL stay in the Documentation presentation and report the save failure.

#### Scenario: Viewing source
- **WHEN** a user activates View source in a Documentation panel
- **THEN** pending edits are flushed
- **AND** the same panel shows the File Viewer presentation, where Text, HEX, Diff, and (when available) Tasks can be selected

#### Scenario: Flush fails
- **WHEN** a user activates View source and flushing pending edits fails
- **THEN** the panel stays in the Documentation presentation and shows the save failure

#### Scenario: Narrow toolbar
- **WHEN** the Documentation panel is narrow
- **THEN** View source stays reachable through the toolbar's overflow with its accessible name
