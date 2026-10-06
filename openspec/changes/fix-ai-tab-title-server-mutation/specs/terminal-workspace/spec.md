## ADDED Requirements

### Requirement: Server-owned terminal note

A terminal's note SHALL be part of the server-owned terminal panel. Adding, editing, or removing a note SHALL be a canonical server mutation, bounded in length by the server, and SHALL reach every authorized connected client. A client SHALL present the note from server workspace state. Editing a note SHALL advance the terminal's metadata revision.

#### Scenario: Note shared between clients

- **WHEN** a user edits a terminal's note on one client
- **THEN** every other authorized client presenting that terminal shows the same note

#### Scenario: Note survives a fresh client

- **WHEN** a client reloads or reconnects after a note was edited
- **THEN** it shows the note from server state

#### Scenario: Oversized note rejected

- **WHEN** a client submits a note longer than the server's note limit
- **THEN** the server rejects the mutation and the existing note is unchanged
