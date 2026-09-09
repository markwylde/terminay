## MODIFIED Requirements

### Requirement: Restoring a non-empty repository

A non-empty repository SHALL restore its projects and non-terminal panels. A
terminal panel describes a process owned by the server process that created it,
so a restart MUST NOT restore terminal tabs: the server SHALL remove their stale
panels and sessions and SHALL create one fresh terminal in each restored project
with a valid root before the workspace is shown. Previous tab counts MUST NOT be
restored. A This-server project whose persisted root is missing SHALL instead
stay represented with its recoverable error until repaired.

This restore SHALL be performed by the server for every host. A connection host
SHALL NOT decide what a restored workspace contains, so Desktop and a browser
reaching a standalone server SHALL observe the same restored workspace for the
same repository.

#### Scenario: Server restart

- **WHEN** a server restarts with restored projects
- **THEN** stale terminal panels and sessions are removed and one fresh terminal
  is created in each restored project with a valid root before the workspace is
  shown

#### Scenario: Local Desktop restart

- **WHEN** Desktop restarts with restored Local projects
- **THEN** stale terminal panels and sessions are removed and one fresh terminal
  is created in each restored project with a valid root before the workspace is
  shown

#### Scenario: The host does not change the outcome

- **WHEN** the same repository is restored under an embedded Desktop server and
  under a standalone server reached from a browser
- **THEN** both restore the same projects, remove the same stale terminal panels,
  and seed replacement terminals the same way

#### Scenario: Restored project with a missing root

- **WHEN** a restored This-server project's persisted root is missing
- **THEN** it stays represented with its recoverable error and receives no
  replacement terminal until repaired

### Requirement: First-run initialization

A new server data root SHALL be initialized through the canonical repository,
not by a renderer or host adapter. Initialization SHALL atomically commit one
workspace view, one This server project rooted at the server-authorized home,
one terminal panel, and its terminal session before reporting the workspace
ready. Initialization SHALL be idempotent: a client reload, additional native
window, or reconnect MUST NOT create another default project or terminal.

The server SHALL seed that first terminal on the same startup path that restores
a non-empty repository, so a host cannot make first-run and restart behave
differently by seeding on only one of them.

#### Scenario: New data root

- **WHEN** a new server data root is initialized
- **THEN** exactly one workspace view, This server project, terminal panel, and
  terminal session are committed before any client renders the workspace as ready

#### Scenario: Reload after initialization

- **WHEN** a client reloads, opens another native window, or reconnects
- **THEN** no additional default project or terminal is created
