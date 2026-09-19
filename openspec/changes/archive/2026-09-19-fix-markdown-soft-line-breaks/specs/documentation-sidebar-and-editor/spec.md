## ADDED Requirements

### Requirement: Soft line break rendering

The rich text surface SHALL render a Markdown soft line break — a single newline
inside a paragraph, list item, heading, table cell, or block quote — as a space,
matching the live preview and standard Markdown rendering. A hard line break
SHALL continue to render as a line break. Whitespace a user types SHALL remain
significant: consecutive spaces and a trailing space at the end of a line SHALL
stay visible and editable in the rich text surface.

#### Scenario: Paragraph wrapped across source lines
- **WHEN** a document contains a paragraph whose source is wrapped over several lines separated by single newlines
- **THEN** the rich text surface shows it as continuous prose with a space at each wrap, breaking only where the surface itself runs out of width
- **AND** the live preview and the rich text surface show the same paragraph breaks

#### Scenario: Blank line between paragraphs
- **WHEN** two blocks of text are separated by a blank line
- **THEN** the rich text surface shows them as separate paragraphs

#### Scenario: Hard line break
- **WHEN** a paragraph contains a hard line break
- **THEN** the rich text surface shows a line break at that point

#### Scenario: Code keeps its own line breaks
- **WHEN** a document contains a fenced code block, or is shown in source or diff mode
- **THEN** every line break in it is preserved exactly as written

#### Scenario: Typing significant whitespace
- **WHEN** a user types consecutive spaces, or a space at the end of a line
- **THEN** that whitespace remains visible and the caret stays where the user put it

#### Scenario: Caret movement across a wrap
- **WHEN** a user moves the caret, selects, or deletes across a point where the source wraps
- **THEN** the text behaves as a single continuous paragraph

### Requirement: Reading a document never rewrites it

The rich text surface SHALL report the normalization it performs when it parses
a document, and the Documentation panel SHALL NOT treat that report as an edit.
Opening, reading, and closing a document without typing SHALL leave its bytes on
disk unchanged and SHALL NOT put the document into an unsaved state.

#### Scenario: Opening a hand-wrapped document
- **WHEN** a user opens a document whose paragraphs are wrapped over several source lines and does not type
- **THEN** the file on disk is unchanged after the autosave delay has passed
- **AND** the document is not reported as having unsaved changes

#### Scenario: Closing without typing
- **WHEN** a user opens a document and closes it without typing
- **THEN** no save is performed and the file on disk is unchanged

### Requirement: Saving writes the document as the rich text surface holds it

When a user edits a document, the save SHALL write the whole document as the
rich text surface holds it, in which a paragraph wrapped over several source
lines is one paragraph on one line. The words SHALL be unchanged; only the line
wrapping of the prose SHALL differ.

#### Scenario: Editing a hand-wrapped document
- **WHEN** a user types into a document whose paragraphs are wrapped over several source lines
- **THEN** the saved file holds each of those paragraphs on a single line with the same words

#### Scenario: Structure is not reflowed
- **WHEN** such a document is saved
- **THEN** its headings, lists, tables, code blocks, and blank-line paragraph boundaries are still present and separate
