## ADDED Requirements

### Requirement: Recorded dimensions match the terminal

A recording's cast header SHALL carry the terminal's size at the moment recording starts. Every resize the terminal applies while recording, whichever client or path requested it, SHALL be recorded as an `r` event placed before the output the program draws for the new size.

#### Scenario: Recording a terminal that was never resized
- **WHEN** a terminal created at 132×41 starts recording
- **THEN** the cast header records 132 columns and 41 rows

#### Scenario: A client resizes the terminal while recording
- **WHEN** a client resizes a recording terminal to 150×50 through the terminal protocol
- **THEN** the cast holds an `r` event of `150x50` before the output that follows the resize

### Requirement: Replay chunks transfer at any recorded size

A replay read SHALL deliver any chunk the server reads within its replay chunk limit, however much escaping its content contains. A client that asks for replay content outside the protocol frame header SHALL receive it there, and a client or server that does not use that form SHALL still exchange content inline.

#### Scenario: Escape-heavy output
- **WHEN** a user replays a recording whose first 64 KiB is dense with colour codes, quotes, and backslashes
- **THEN** every chunk loads and the replay plays

### Requirement: Timeline shows the server's current recordings

The recordings timeline SHALL read the server rather than a cached result when it opens, when a user refreshes it, when it returns to the screen, and periodically while it is on screen. It SHALL show when it last read the server. A recording deleted from the timeline or from its replay SHALL no longer be listed.

#### Scenario: Refreshing
- **WHEN** a recording finishes elsewhere and the user selects refresh
- **THEN** the timeline lists it and shows that it was updated just now

#### Scenario: Deleting from a replay
- **WHEN** a user deletes a recording from its replay tab and returns to the timeline
- **THEN** the recording is not listed

#### Scenario: Deleting from the timeline
- **WHEN** a user deletes a recording from its timeline row and confirms
- **THEN** the row disappears without leaving the timeline
