## ADDED Requirements

### Requirement: File adapter identity binding
Metadata, ranged byte and text reads, atomic save, reload, and keep-local
SHALL be served only through the bounded `ServerFileAdapter` protocol commands.
Each command SHALL revalidate the canonical path and the exact server, project,
and session authorization before performing work.

#### Scenario: Operation for another project's session
- **WHEN** a client issues a file-session command whose session id does not
  belong to the authenticated server and project
- **THEN** the server rejects the command and performs no filesystem work

#### Scenario: Path revalidated per operation
- **WHEN** a second operation reuses a previously validated session
- **THEN** the server resolves and revalidates the canonical path again for
  that operation

### Requirement: Shared draft session
The server SHALL own canonical file-session state comprising the disk revision,
the draft revision, dirty state, conflict state, and watch state, and SHALL
serve that state to every authorized client of the same session.

#### Scenario: Dirty draft survives disconnect
- **WHEN** the client holding a dirty draft disconnects
- **THEN** the server retains the draft and releases it only through the
  documented panel lifecycle

#### Scenario: Second client attaches
- **WHEN** another authorized client opens the same file session
- **THEN** it observes the same canonical disk revision, draft revision, and
  conflict state

### Requirement: Bounded session metadata response
A file-session metadata query SHALL return canonical bounded metadata,
including optional host metadata, ordered revisions, and conflict state, and
SHALL NOT return file content.

#### Scenario: Metadata requested
- **WHEN** a client queries session metadata
- **THEN** the response contains revisions, conflict state, and bounded
  metadata only, with no content bytes

### Requirement: Authoritative draft revisions
A save SHALL be rejected when the submitted revision is not the server's
current disk or draft revision, so a stale client or an external change cannot
be overwritten silently.

#### Scenario: Stale save
- **WHEN** a client saves against a revision older than the server's current
  revision
- **THEN** the server rejects the save with a structured conflict result and
  leaves the file unchanged

### Requirement: Bounded capability snapshot
The server SHALL publish bounded, content-free preview capability metadata for
text, Markdown, image, PDF, binary/HEX fallback, and large-file mode selection,
and viewer mode selection SHALL be determined by that server-authorized
snapshot.

#### Scenario: Server-denied mode requested
- **WHEN** a client requests a viewer mode the capability snapshot does not
  authorize
- **THEN** the client disables that mode and resolves to the server-authorized
  fallback mode

### Requirement: Bounded content surface
Ranged text and HEX reads and capped Markdown, image, and PDF preview bytes
SHALL be served through a canonical bounded content surface with typed size and
path offsets, cancellation, a concurrent-read limit, and an explicit decoded
image pixel cap.

#### Scenario: Concurrent read limit reached
- **WHEN** a client exceeds the server's concurrent-read limit
- **THEN** the server rejects the additional read with a bounded typed error

#### Scenario: Oversized decoded image
- **WHEN** an image would exceed the decoded pixel cap
- **THEN** the server refuses the decoded preview rather than decoding it

### Requirement: Resumable ranged transfer
Image, PDF, Markdown asset, HEX, and large text content SHALL be transferred as
sequential bounded chunks with resumable offsets, cancellation, and contiguous
response validation.

#### Scenario: Interrupted transfer
- **WHEN** a content stream is interrupted and the client resumes from its last
  acknowledged offset
- **THEN** the server continues the transfer from that exact offset

#### Scenario: Non-contiguous chunk
- **WHEN** a received chunk is not contiguous with the previously received bytes
- **THEN** the client rejects the stream rather than assembling the content

### Requirement: Large-file engine choice
Monaco engine selection SHALL be bounded by the shared 128 MiB rich-editor
budget. A text file above that budget SHALL resolve directly to the ranged
Performant engine.

#### Scenario: Oversized text file opened
- **WHEN** a text file larger than the rich-editor budget is opened
- **THEN** the viewer opens the ranged Performant engine and Monaco is not
  offered

#### Scenario: Sparse draft promoted to Monaco
- **WHEN** a Performant sparse text draft within the budget is switched into
  Monaco
- **THEN** the edited projection is materialized and its dirty state is
  preserved
