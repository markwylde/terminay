## ADDED Requirements

### Requirement: Host-mediated file saves

Desktop SHALL let a server-bundled renderer save bytes to the local filesystem only through a host save under the `osIntegration` capability, never through a browser-initiated download. The renderer SHALL supply a suggested file name, never a path; the user SHALL choose the destination in a native save dialog that confirms replacing an existing file; and the renderer SHALL receive an opaque token or a cancellation, never the destination. Bytes SHALL arrive in chunks of at most 1 MiB, one write at a time per save, into a temporary file beside the destination that is moved into place only when the renderer finishes the save. Every host save error returned to the renderer SHALL be generic and SHALL contain no path.

#### Scenario: Saved whole

- **WHEN** a renderer opens a host save, the user picks a destination, and the renderer writes its chunks and finishes
- **THEN** the destination holds exactly those bytes, and the renderer is told only that the save completed

#### Scenario: Cancelled dialog

- **WHEN** the user cancels the save dialog
- **THEN** the renderer is told the save was cancelled and nothing is written

#### Scenario: Replacing a file

- **WHEN** the user confirms replacing an existing file and the save completes
- **THEN** the file holds the new bytes

#### Scenario: Oversized chunk

- **WHEN** a renderer sends a chunk whose decoded size is larger than 1 MiB
- **THEN** the host refuses the action before writing anything

#### Scenario: Write fails

- **WHEN** a write or the final move fails
- **THEN** the renderer receives an error that names no path, the save ends, no temporary file is left, and an existing destination keeps its original contents

### Requirement: Host save lifetime and limits

A host save SHALL belong to the document that opened it. A token from another window or an earlier document SHALL be refused. Every open save, and any save whose dialog is still showing, SHALL end without writing when its document reloads, switches server, or closes, when its window closes, when the renderer abandons it, or after 5 minutes without a write. An ended save SHALL leave no temporary file and SHALL refuse every later action. A document SHALL have at most 4 open saves.

#### Scenario: Abandoned save

- **WHEN** a renderer abandons a host save, or its document reloads, before finishing
- **THEN** no file is left at the destination or beside it, and the token is refused afterwards

#### Scenario: Window closes during the dialog

- **WHEN** the window closes while the save dialog is still showing and the user then picks a destination
- **THEN** nothing is written

#### Scenario: Token from another window

- **WHEN** a renderer writes to or finishes a save token that another window opened
- **THEN** the host refuses the action and the other window's save is unaffected

#### Scenario: Too many saves

- **WHEN** a document already has 4 open saves and opens another
- **THEN** the host refuses it without showing a dialog
