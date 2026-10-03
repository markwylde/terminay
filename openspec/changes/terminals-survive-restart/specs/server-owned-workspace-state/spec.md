## MODIFIED Requirements

### Requirement: Disconnect and restart lifecycle

Client disconnect MUST NOT delete projects, close panels, or kill PTYs. The
lifecycle of each connection SHALL be independent: a connection that drops,
reconnects, or fails authorization SHALL leave every other connection of the same
window connected and operable. Terminal exit SHALL update all referencing panels
and connected clients once. A successful-exit close decision SHALL use the
terminal surface's already-observed setting at the exit boundary and MUST NOT wait
for another settings request after the session has ended. Server restart SHALL
reload durable workspace state, SHALL reattach every PTY that is still running,
and SHALL mark every formerly live PTY that is no longer running as ended.

#### Scenario: Client disconnects

- **WHEN** a client disconnects
- **THEN** its projects, panels, and PTYs are unaffected

#### Scenario: Terminal exits successfully

- **WHEN** a terminal exits successfully
- **THEN** all referencing panels and connected clients update once, using the
  already-observed close setting at the exit boundary

#### Scenario: Server restart with running PTYs

- **WHEN** the server restarts and a formerly live PTY is still running
- **THEN** durable workspace state reloads and that session is running under
  its original identity

#### Scenario: Server restart with unreattachable PTYs

- **WHEN** the server restarts and a formerly live PTY is no longer running
- **THEN** durable workspace state reloads and that session is marked ended

#### Scenario: One connection of several drops

- **WHEN** one attached connection of a window drops or restarts
- **THEN** the window's other connections stay connected and operable, and their
  projects, panels, and terminals are untouched

### Requirement: Restoring a non-empty repository

A non-empty repository SHALL restore its projects and every panel, including
terminal panels, with their order, splits, titles, and appearance. A terminal
panel whose session is still running SHALL be restored attached to that session.
A terminal panel whose session is no longer running SHALL be restored as an
ended session and MUST NOT be replaced by a new process. A restored project with
a valid root and no terminal panel SHALL receive one fresh terminal before the
workspace is shown. A project whose persisted root is missing on the server
SHALL instead stay represented with its recoverable error until repaired.

This restore SHALL be performed by the server for every host. A connection host
SHALL NOT decide what a restored workspace contains, so Desktop and a browser
reaching a standalone server SHALL observe the same restored workspace for the
same repository.

#### Scenario: Server restart

- **WHEN** a server restarts with restored projects whose terminal sessions are
  still running
- **THEN** each project shows the same terminal panels in the same layout,
  attached to the same sessions, before the workspace is shown

#### Scenario: Local Desktop restart

- **WHEN** Desktop restarts with restored Local projects whose terminal sessions
  are still running
- **THEN** each project shows the same terminal panels in the same layout,
  attached to the same sessions, before the workspace is shown

#### Scenario: Session no longer running

- **WHEN** a restored terminal panel's session is no longer running
- **THEN** the panel is restored in place as an ended session and no new process
  is started for it

#### Scenario: Project with no terminal panel

- **WHEN** a restored project with a valid root has no terminal panel
- **THEN** one fresh terminal is created in it before the workspace is shown

#### Scenario: The host does not change the outcome

- **WHEN** the same repository is restored under an embedded Desktop server and
  under a standalone server reached from a browser
- **THEN** both restore the same projects and terminal panels, and treat running
  and ended sessions the same way

#### Scenario: Restored project with a missing root

- **WHEN** a restored project's persisted root is missing on the server
- **THEN** it stays represented with its recoverable error and receives no
  replacement terminal until repaired
