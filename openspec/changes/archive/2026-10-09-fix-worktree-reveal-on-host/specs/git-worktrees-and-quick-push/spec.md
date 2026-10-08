## ADDED Requirements

### Requirement: Worktree reveal runs on the server host

The server SHALL reveal a worktree in the operating system's file manager on its
own host, resolving the worktree's path from opaque repository and worktree IDs.
Each worktree listing SHALL state whether reveal is available to the requesting
client, and it SHALL be available only to clients the server accepted as its own
host's windows. Clients SHALL offer a worktree reveal action only when the
listing says it is available.

#### Scenario: Desktop window on the embedded server

- **WHEN** a Desktop window connected to its embedded server opens a worktree's
  actions
- **THEN** **Reveal in OS** is offered
- **AND** choosing it shows the worktree in the host's file manager

#### Scenario: Browser or remote client

- **WHEN** a browser, remote, or paired client lists worktrees
- **THEN** the listing reports reveal as unavailable and the client omits
  **Reveal in OS**
- **AND** a reveal request from that client is refused without touching the
  host's file manager

#### Scenario: Reveal fails

- **WHEN** the server cannot reveal a worktree
- **THEN** the client reports the failure to the user
