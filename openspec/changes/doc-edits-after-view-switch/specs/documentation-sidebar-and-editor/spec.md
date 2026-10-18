## ADDED Requirements

### Requirement: Changing views is not an edit and never swallows one

Changing the rich editor between its rich text, source, and diff views SHALL NOT by itself be treated as an edit: a change of views that only respells the document SHALL leave its bytes on disk unchanged and SHALL NOT put it into an unsaved state. Every edit SHALL be saved however soon after a change of views it is made. Words that reach the document because the views changed, such as text typed into an admonition's body just before switching, SHALL be saved as an edit. Whether a report of the document is an edit SHALL NOT depend on how much time has passed since a change of views.

#### Scenario: Switching views without typing

- **WHEN** a user opens a document containing an empty admonition and switches between rich text, source, and diff without typing
- **THEN** the file on disk is unchanged
- **AND** the document is not reported as having unsaved changes

#### Scenario: Typing straight after a change of views

- **WHEN** a user switches to rich text and types immediately
- **THEN** the panel reports unsaved changes and autosave writes the typed text to disk

#### Scenario: Typing into an admonition before a change of views

- **WHEN** a user types into an admonition's body and switches views without first moving focus out of the admonition
- **THEN** autosave writes the typed text to disk
