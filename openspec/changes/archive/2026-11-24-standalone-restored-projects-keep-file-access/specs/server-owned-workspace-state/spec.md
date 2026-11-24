## MODIFIED Requirements

### Requirement: Restoring a non-empty repository

A non-empty repository SHALL restore its projects and non-terminal panels. A
terminal panel whose session was not retained by its holder describes a process
that ended with the server process that created it, so a restart MUST NOT
restore those terminal tabs: the server SHALL remove their stale panels and
sessions and SHALL create one fresh terminal in each restored project with a
valid root and no running terminal before the workspace is shown. A session
retained by its holder SHALL be adopted with its panel instead. Previous tab
counts MUST NOT be restored. A project whose persisted root is missing on the server SHALL instead
stay represented with its recoverable error until repaired.

Before the workspace is shown, the server SHALL bind every restored project with a
valid root to that root in the current server process, exactly as creating the
project would. A restored project's file, Explorer, content, Documentation, and Git
operations SHALL therefore be authorized after a restart just as they were before
it. A restored project whose root cannot be resolved SHALL NOT prevent the
server from starting and SHALL hold no file or Git authority, including any the
server bound for it earlier in the same start, until its root is repaired. A
restored project awaiting its start choice has no root and SHALL be left
unbound.

This restore SHALL be performed by the server for every host. A connection host
SHALL NOT decide what a restored workspace contains, so Desktop and a browser
reaching a standalone server SHALL observe the same restored workspace for the
same repository.

#### Scenario: Server restart

- **WHEN** a server restarts with restored projects
- **THEN** stale terminal panels and sessions are removed and one fresh terminal
  is created in each restored project with a valid root before the workspace is
  shown

#### Scenario: Retained sessions survive a restart

- **WHEN** a server restarts and a project's session was retained by its holder
- **THEN** that session is adopted with its panel, and the project receives no
  additional replacement terminal

#### Scenario: Local Desktop restart

- **WHEN** Desktop restarts with restored Local projects
- **THEN** stale terminal panels and sessions are removed and one fresh terminal
  is created in each restored project with a valid root before the workspace is
  shown

#### Scenario: A restored project's files are reachable after a restart

- **WHEN** a standalone server or Desktop restarts with a restored project whose
  root is valid, and a client lists that project's folder in Explorer
- **THEN** the listing succeeds, and the server does not refuse it as outside the
  authorized project
- **AND** reading a file in that project and querying its Git status also succeed

#### Scenario: The host does not change the outcome

- **WHEN** the same repository is restored under an embedded Desktop server and
  under a standalone server reached from a browser
- **THEN** both restore the same projects, remove the same stale terminal panels,
  seed replacement terminals the same way, and authorize the same restored
  projects' file and Git operations

#### Scenario: Restored project with a missing root

- **WHEN** a restored project's persisted root is missing on the server
- **THEN** the server still starts, and the project stays represented with its
  recoverable error and receives no replacement terminal until repaired
- **AND** file operations for that project are refused until its root is
  repaired, while its sibling projects stay reachable

#### Scenario: Repairing a restored project's missing root

- **WHEN** a restored project's root was missing at start and its root is then
  updated to an existing directory
- **THEN** that project's file operations succeed

#### Scenario: A restored project awaiting its start choice

- **WHEN** a server restarts with a restored project awaiting its start choice
- **THEN** the server starts and the project still awaits its start choice
