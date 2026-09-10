## ADDED Requirements

### Requirement: Text mode consumes server language features

Text mode SHALL present the server's language intelligence for the open file. `language.diagnostics` events SHALL be applied as editor markers keyed by the document revision they were computed against. Completion, hover, and definition SHALL be provided through the editor's provider hooks, which SHALL call a language gateway that is the only client code naming the language operations. Every request SHALL carry the current draft revision, and a result for a stale revision SHALL be dropped rather than applied. When no provider serves the file, or the language session is unavailable, Text mode SHALL fall back to highlighting and editing with no error surfaced. Choosing a definition result SHALL open the target file through the ordinary file-viewer open path.

#### Scenario: Diagnostics arrive

- **WHEN** a `language.diagnostics` event arrives for the open file at the current draft revision
- **THEN** its diagnostics are applied as editor markers

#### Scenario: Stale result

- **WHEN** a completion, hover, definition, or diagnostics result names a revision older than the current draft revision
- **THEN** the result is dropped and the editor is left unchanged

#### Scenario: Go to definition

- **WHEN** the user follows a definition result that names another project file
- **THEN** that file opens through the ordinary file-viewer open path

## MODIFIED Requirements

### Requirement: File viewer non-goals

The file viewer SHALL NOT run a language service in the client, nor provide an IDE contract beyond the editor's built-in highlighting and editing features together with the language features the server provides, editing in Preview or Diff, simultaneous collaborative editing, a remembered large-file engine choice, or a redesigned full file tree.

#### Scenario: Language server requested

- **WHEN** diagnostics, completions, hovers, or definitions are expected from the file viewer
- **THEN** they come from the server's language intelligence capability when a contributed language server serves the file, and are absent otherwise
- **AND** the client runs no language service of its own

#### Scenario: Two users editing one file

- **WHEN** two clients edit the same file at once
- **THEN** they are coordinated by ordered draft revisions and conflicts, not by simultaneous collaborative editing
