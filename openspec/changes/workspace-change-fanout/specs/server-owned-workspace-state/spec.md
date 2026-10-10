## MODIFIED Requirements

### Requirement: Snapshot, revision, and named commands

The server SHALL publish a complete initial snapshot with a monotonically
increasing workspace revision. Durable mutations SHALL be named commands such as
create, move, rename, and close rather than replacement uploads of an opaque
Dockview JSON document. A command SHALL declare the object ids and expected
revision it depends on. The server SHALL validate authorization and invariants,
commit once, assign the next revision, and publish one ordered result event.
That event SHALL carry the commit's change record, so that a client holding the
preceding revision advances without requesting anything.

#### Scenario: Committed command yields one ordered result

- **WHEN** a client commits a workspace command
- **THEN** the server validates it, commits once, assigns the next revision, and
  publishes one ordered result event to every connected client

#### Scenario: Layout is not uploaded wholesale

- **WHEN** a client changes panel layout
- **THEN** it submits named commands rather than an opaque layout document

#### Scenario: Result event is enough to advance

- **WHEN** a client holding revision N receives the result event of the commit
  that produced revision N+1
- **THEN** it presents revision N+1 without sending a workspace query

### Requirement: Workspace delta envelope

A workspace delta SHALL have one versioned wire shape containing the ordered
change records since the requested revision, each scoped to what the requesting
connection may see, and the revision they lead to. When the server no longer
holds the records since the requested revision, it SHALL answer with a complete
project-scoped snapshot instead. Clients SHALL validate the envelope and every
record in it, advance atomically to the resulting revision, and MUST NOT parse
the envelope itself as a complete workspace snapshot.

#### Scenario: Delta applied atomically

- **WHEN** a client receives a valid delta
- **THEN** it advances atomically to the revision the delta leads to

#### Scenario: Malformed delta

- **WHEN** a malformed, stale, or incompatible delta arrives
- **THEN** the client projection is not partially mutated

#### Scenario: Delta carries only what changed

- **WHEN** a client requests a delta across a revision in which one panel was
  renamed
- **THEN** the delta carries that panel and no other project, folder, panel,
  view, or session

#### Scenario: History no longer reaches the requested revision

- **WHEN** a client requests a delta from a revision older than the server's
  retained change records
- **THEN** it receives a complete project-scoped snapshot

### Requirement: Excluded from the persistence contract

The persistence contract MUST NOT include unbounded terminal scrollback, live
PTY serialization, transient search text, open modal state, hover state,
in-progress drag geometry, which project tab or terminal panel is active in a
connected presentation, or any value taken from terminal output, including a
title a program sets.

#### Scenario: Active tab is not durable server state

- **WHEN** a client changes its active project tab or active terminal
- **THEN** no durable workspace state records that choice

#### Scenario: Program-set title is not durable server state

- **WHEN** a program sets its terminal's title
- **THEN** no durable workspace state records that title

## ADDED Requirements

### Requirement: Change records

Each committed command SHALL produce one change record: the revision it starts
from, the revision it produces, the command type, and for each of the views,
projects, folders, panels, and terminal sessions collections the objects the
commit created or replaced, by id and in full, and the ids it removed. A record
SHALL name every object whose content differs between the two revisions and no
object whose content is the same. A record delivered to a connection SHALL
contain only objects that connection may read in a snapshot. Where a record
cannot be scoped exactly for a connection, the server SHALL tell that connection
to request a delta and SHALL NOT send it a wider record.

#### Scenario: Rename

- **WHEN** a panel is renamed
- **THEN** the change record carries that panel and nothing else

#### Scenario: Move between projects

- **WHEN** a terminal panel is moved to another project
- **THEN** the change record carries the panel, the folders and projects whose
  membership changed, and the session that was re-homed

#### Scenario: Close

- **WHEN** a panel is closed
- **THEN** the change record names the panel's id as removed

#### Scenario: Project-scoped connection

- **WHEN** a commit changes a panel of a project a project-scoped connection
  may not see
- **THEN** that connection's record carries no object of that project

#### Scenario: Object enters a connection's scope

- **WHEN** a commit moves a panel into the project a project-scoped connection
  may see, from one it may not
- **THEN** that connection either receives the panel in full or is told to
  request a delta

### Requirement: A client applies change records in order

A client SHALL apply a change record only when the record starts from the
revision the client holds. A record that starts from any other revision SHALL
leave the projection unchanged, and the client SHALL request a delta from the
revision it holds. A record for a revision the client has already reached SHALL
be ignored.

#### Scenario: Missed event

- **WHEN** a client holding revision N receives a record that starts from N+1
- **THEN** its projection stays at N and it requests a delta from N

#### Scenario: Duplicate event

- **WHEN** a client holding revision N+1 receives the record that produced N+1
  again
- **THEN** its projection is unchanged and it requests nothing

### Requirement: Unchanged objects keep their identity in a client projection

When a client projection advances, every view, project, folder, panel, and
terminal session whose content is the same in the new revision SHALL be
presented to the client's interface as the same object as before. This SHALL
hold whether the client advanced by a change record, a delta, or a complete
snapshot.

#### Scenario: One panel renamed

- **WHEN** one panel is renamed in a workspace of several projects
- **THEN** every other panel, and every project and folder that does not
  contain it, is the same object in the client projection as before

#### Scenario: Snapshot after reconnect

- **WHEN** a client reconnects and receives a complete snapshot in which one
  project changed
- **THEN** every unchanged project, folder, panel, and session is the same
  object in the client projection as before

### Requirement: Presentation work follows the change

A client SHALL do presentation work for a workspace change only for what the
change record names. A change to one terminal panel SHALL NOT re-render another
terminal's panel or tab, and SHALL NOT cause a project the change does not
concern to re-run its file, Git, documentation, or agent queries or to re-open
their subscriptions. A client SHALL NOT treat the workspace revision advancing
as a reason, on its own, to reload anything.

#### Scenario: Rename beside other terminals

- **WHEN** one terminal is renamed while others are open in the same and in
  other projects
- **THEN** no other terminal's panel or tab is rendered again, and no project
  that does not hold the renamed terminal renders its workspace again

#### Scenario: Change in another project

- **WHEN** a panel changes in one project while another project is on screen
- **THEN** the project on screen sends no file, Git, documentation, or agent
  query because of it

### Requirement: Terminal output does not commit workspace state

Nothing a program writes to its terminal SHALL commit a workspace command,
advance the workspace revision, or write the server's persisted workspace state.
A fact the server takes from terminal output SHALL be published as live state
for that terminal.

#### Scenario: Program animates its title

- **WHEN** a program rewrites its terminal's title once a second for a minute
- **THEN** the workspace revision is the same at the end as at the start and
  the persisted workspace state was not written

### Requirement: A commit copies the state once and is durable before it is published

Committing a workspace command SHALL copy the workspace state at most once.
Reading the committed state, and observing that a commit happened, SHALL NOT
copy it. A commit SHALL be durable in the server's persisted state before its
result event is published. State the server hands to a reader SHALL be
read-only.

#### Scenario: Commit with observers

- **WHEN** a command commits while the server's own observers of workspace
  changes are attached
- **THEN** the workspace state is copied once in total

#### Scenario: Reader cannot change committed state

- **WHEN** code that read the committed state attempts to change it
- **THEN** the committed state is unchanged

#### Scenario: Write fails

- **WHEN** persisting a commit fails
- **THEN** no result event is published and the workspace stays at its previous
  revision

### Requirement: Remembered command outcomes are bounded in size

The outcomes the server remembers in order to answer a duplicated command id
SHALL be bounded both in number and in total bytes, and SHALL NOT each retain a
copy of the workspace state. When either bound is reached the oldest outcome
SHALL be dropped first.

#### Scenario: Many commands on a large workspace

- **WHEN** more commands commit than the byte bound has room for
- **THEN** the oldest outcomes are dropped and the retained total stays within
  the bound

#### Scenario: Duplicate within the bound

- **WHEN** a client resends a command id whose outcome is still remembered
- **THEN** the recorded outcome is returned and the mutation is not applied
  again
