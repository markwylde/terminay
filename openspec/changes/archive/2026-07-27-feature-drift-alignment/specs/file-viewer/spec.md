## ADDED Requirements

### Requirement: Performant text engine behaviour
The Performant text engine SHALL present a large file through a ranged line model rather
than a single truncated range. It SHALL index incrementally within a per-request bound, make
the first page accessible before the complete scan finishes, and support sparse saves that
change file length without rewriting untouched regions.

#### Scenario: First page before full index
- **WHEN** a file larger than the Monaco threshold is opened
- **THEN** the first page of lines is readable before incremental indexing completes
- **AND** indexing work per request stays within its declared bound

#### Scenario: Encoding boundaries
- **WHEN** ranged text crosses a BOM, a CRLF pair, or a multibyte UTF-8 sequence
- **THEN** the returned lines and logical offsets remain correct

#### Scenario: Sparse length-changing save
- **WHEN** an edit changes the byte length of a region in a large file
- **THEN** the projection and logical offsets stay consistent and the save is atomic

### Requirement: Server-generated diff contract
The privileged side SHALL normalize raw patch output into bounded structured hunks and
return an explicit size result. Raw Git command output SHALL NOT reach the renderer.

#### Scenario: Structured hunks only
- **WHEN** a diff is requested for a tracked file
- **THEN** the renderer receives bounded structured hunks and a size result
- **AND** no raw Git command output is delivered

### Requirement: Diff mode
Diff mode SHALL render distinct virtualized rows in both unified and side-by-side layouts,
support selection across lines, and remain bounded for large files.

#### Scenario: Both layouts virtualized
- **WHEN** a large diff is displayed in unified and then side-by-side layout
- **THEN** both layouts render virtualized rows rather than one preformatted patch
- **AND** cross-line selection works in each layout

### Requirement: HEX mode
HEX mode SHALL support ranged reads, byte edits on ordinary files, range selection, and a
configurable row width.

#### Scenario: Ranged large-file byte edit
- **WHEN** a byte is edited inside a ranged view of a large file
- **THEN** the edit is applied to the correct logical offset and remains bounded

### Requirement: Shared draft session
Text and HEX modes SHALL share one draft session for a file. Switching between modes, or
between the Performant and Monaco engines, SHALL preserve the dirty draft and SHALL NOT
change the file on disk until an explicit Save.

#### Scenario: Mode transitions preserve the draft
- **WHEN** a dirty file is switched Text to HEX to Text, or Performant to Monaco
- **THEN** the draft is preserved and the file on disk is unchanged
- **AND** the file changes only after an explicit Save

#### Scenario: Stale draft rejection
- **WHEN** a save is attempted against a stale revision or a replaced path
- **THEN** the save is rejected and the on-disk file is unchanged
