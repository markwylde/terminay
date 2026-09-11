## ADDED Requirements

### Requirement: TypeScript and JavaScript React files highlight as their base language

Text mode SHALL highlight `.tsx` files with the TypeScript grammar and `.jsx` files with the JavaScript grammar, because those grammars cover JSX syntax.

#### Scenario: TypeScript React file

- **WHEN** a `.tsx` file opens in Text mode
- **THEN** it is highlighted with the TypeScript grammar, including its JSX syntax

#### Scenario: JavaScript React file

- **WHEN** a `.jsx` file opens in Text mode
- **THEN** it is highlighted with the JavaScript grammar, including its JSX syntax

### Requirement: The workspace bundle carries no client language workers

The server-served workspace UI bundle SHALL contain no TypeScript, CSS, HTML, or JSON language worker and no language mode that starts one. Only the editor's base worker SHALL be emitted. A build check SHALL fail when any such language worker or language mode is emitted into the bundle.

#### Scenario: Language worker emitted into the bundle

- **WHEN** a build emits a TypeScript, CSS, HTML, or JSON language worker or language mode into the workspace UI bundle
- **THEN** the build check fails

## MODIFIED Requirements

### Requirement: Text mode engines

Text mode SHALL provide a Monaco engine for normal files and an explicitly selected rich large-file path, and a Performant engine for ranged, virtualized access. Monaco SHALL provide language detection, syntax highlighting, and standard editing for a complete bounded text model through language tokenizers. No language service SHALL run in the client: the editor SHALL compute no diagnostics, completions, hovers, signature help, or semantic analysis.

#### Scenario: Normal file in Text mode

- **WHEN** a normal-sized file opens in Text mode
- **THEN** Monaco provides language detection, syntax highlighting, and standard editing over a complete bounded text model

#### Scenario: Source file with project-level references

- **WHEN** a source file that references other files, packages, or compiler configuration opens in Text mode
- **THEN** it is tokenized and highlighted
- **AND** the client computes no diagnostics, completions, hovers, signature help, or semantic analysis for it

### Requirement: File viewer non-goals

The file viewer SHALL NOT run a language service in the client, nor provide an IDE contract beyond the editor's built-in highlighting and editing features, editing in Preview or Diff, simultaneous collaborative editing, a remembered large-file engine choice, or a redesigned full file tree.

#### Scenario: Language server requested

- **WHEN** diagnostics, completions, hovers, signature help, or other language-service features are expected from the file viewer
- **THEN** the file viewer itself provides no language service and the client does not compute them

#### Scenario: Two users editing one file

- **WHEN** two clients edit the same file at once
- **THEN** they are coordinated by ordered draft revisions and conflicts, not by simultaneous collaborative editing
