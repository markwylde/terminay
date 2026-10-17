## ADDED Requirements

### Requirement: Every running terminal has a place

Every running terminal session SHALL belong to a project and SHALL have a
panel in it. On restart, a shell the session holder still has that is running
and that the workspace does not name SHALL be recovered rather than ended: the
server SHALL give it a panel in a new project named "Recovered terminals" in
the first workspace view and SHALL adopt it there. A held shell that has
already ended, or that the workspace names for another server, SHALL be ended.
On a freshly initialised workspace, the one session about to be created SHALL
NOT be treated as recovered.

#### Scenario: A running shell the workspace lost

- **WHEN** the server restarts and the holder has a running shell the workspace does not name
- **THEN** that shell is running in a "Recovered terminals" project with its retained output, and every client shows its tab

#### Scenario: An ended shell the workspace lost

- **WHEN** the server restarts and the holder has an ended shell the workspace does not name
- **THEN** it is ended and no project is created for it
