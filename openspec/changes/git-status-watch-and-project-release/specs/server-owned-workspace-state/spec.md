## ADDED Requirements

### Requirement: Closing a project releases its server-held resources

When `project.close` is applied, the server SHALL release every resource it
holds for that project: its terminal sessions, its Git binding and watches, its
file observations, its file, documentation, and content catalogs, its MDX
runtime, and its agent directory scope. The release SHALL run whether or not
the project had terminal sessions. A closed project's identifier SHALL NOT be
resolvable by later file, Git, documentation, or agent requests.

A project move between views or windows is not a close and SHALL NOT release
anything.

#### Scenario: Resources after close

- **WHEN** a project is closed
- **THEN** the server holds no binding, watcher, catalog, or runtime keyed by
  that project
- **AND** a later file or Git request naming that project is rejected as
  unavailable

#### Scenario: Close with no terminals

- **WHEN** a project with no terminal sessions is closed
- **THEN** its server-held resources are released

#### Scenario: Move is not close

- **WHEN** a project is moved to another view or window
- **THEN** none of its server-held resources are released
