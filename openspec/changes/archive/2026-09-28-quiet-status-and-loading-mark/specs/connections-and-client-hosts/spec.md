## MODIFIED Requirements

### Requirement: Connection window loading state and startup phase line

A newly opened Desktop connection window SHALL remain in the normal loading state until its own local or remote server connection is ready. The loading state SHALL centre the Terminay mark in the window above a looping five-dot loading indicator, with five fixed, contrasting colours from the tab hue palette entering in sequence. Desktop packaging and browser metadata SHALL use the same square mark geometry: a pure-black background with even horizontal and vertical padding around the white glyph. The loading state SHALL draw the white glyph alone, with no background tile, at every stage from the native loading document through the server UI's initial document to the renderer, so no dark tile appears against the loading background. Beneath the indicator the loading state SHALL show a single short line: for local embedded-server startup it names the startup phase currently running, and for remote connections it carries that connection's short status message. The line SHALL be a bounded, product-authored string with no path, identifier, host, credential, or error detail, and it SHALL be visually subordinate to the mark and indicator. Native window controls SHALL never overlap the loading state.

#### Scenario: Remote loading shows a status message

- **WHEN** a remote connection window is loading
- **THEN** the mark, five-dot indicator, and a short status message are shown

#### Scenario: Local loading names the current phase

- **WHEN** the Local embedded server is starting
- **THEN** the mark and five-dot indicator are shown with a single short line naming the startup phase currently running
- **AND** that line carries no path, identifier, host, credential, or error detail

#### Scenario: Mark and indicator are unchanged by the line

- **WHEN** the phase line is shown, changes, or is absent
- **THEN** the mark geometry, the five dot colours, and their sequence are unaffected
- **AND** native window controls do not overlap the loading state
