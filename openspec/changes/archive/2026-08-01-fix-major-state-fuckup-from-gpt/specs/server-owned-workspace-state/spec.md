## MODIFIED Requirements

### Requirement: Canonical model ownership and client role

Terminay Server SHALL own the canonical workspace model and every privileged
service acting on its own host or a bound project environment. Desktop and
browser clients SHALL render that model, submit validated commands, and keep
only device-local presentation and connection state. The model SHALL preserve
the current project, panel, and immutable terminal-session boundaries while
allowing multiple clients to observe one server, and process lifetime MUST NOT
be tied to any renderer.

#### Scenario: Multiple clients observe one server

- **WHEN** two clients connect to the same server
- **THEN** both observe the same canonical project, panel, and terminal-session
  identities

#### Scenario: Renderer lifetime is independent

- **WHEN** every renderer disconnects
- **THEN** the server's workspace state and terminal processes continue

### Requirement: Optimistic UI limits

Optimistic UI SHALL be allowed only when rollback is deterministic. Destructive
filesystem, Git, secret, recording, and terminal-lifecycle actions SHALL wait for
server confirmation.

#### Scenario: Destructive action awaits confirmation

- **WHEN** a destructive filesystem, Git, secret, recording, or terminal
  lifecycle action is invoked
- **THEN** the UI waits for the server result before presenting it as complete

### Requirement: Command-first terminal panel close

Closing a canonical terminal panel SHALL be command-first: the renderer SHALL
wait for the server close result and a reconciled snapshot before completing the
UI action. Dockview removal SHALL be a projection of that confirmed state and
MUST NOT launch a second close command from a stale revision. Busy PTY teardown
and snapshot convergence SHALL share a bounded 10-second lifecycle budget.

#### Scenario: Closing a busy terminal panel

- **WHEN** the user closes a terminal panel whose PTY is busy
- **THEN** the renderer waits for the server close result and reconciled snapshot
  within the shared 10-second budget before removing the panel

#### Scenario: No duplicate close command

- **WHEN** the projection removes a closed terminal panel
- **THEN** no second close command is issued from a stale revision

### Requirement: Cross-client convergence for panel changes

When either client creates, closes, or moves a panel, the other client SHALL
reach the same workspace revision and panel and session identities without
polling, reload, or an independently manufactured renderer panel.

#### Scenario: One client moves a panel

- **WHEN** one client creates, closes, or moves a panel
- **THEN** the other client converges to the same revision and panel and session
  identities without polling or reload

### Requirement: Disconnect and restart lifecycle

Client disconnect MUST NOT delete projects, close panels, or kill PTYs. Terminal
exit SHALL update all referencing panels and connected clients once. A
successful-exit close decision SHALL use the terminal surface's already-observed
setting at the exit boundary and MUST NOT wait for another settings request after
the session has ended. Server restart SHALL reload durable workspace state and
SHALL mark formerly live PTYs interrupted unless the process can be safely
reattached.

#### Scenario: Client disconnects

- **WHEN** a client disconnects
- **THEN** its projects, panels, and PTYs are unaffected

#### Scenario: Terminal exits successfully

- **WHEN** a terminal exits successfully
- **THEN** all referencing panels and connected clients update once, using the
  already-observed close setting at the exit boundary

#### Scenario: Server restart with unreattachable PTYs

- **WHEN** the server restarts and a formerly live PTY cannot be safely
  reattached
- **THEN** durable workspace state reloads and that session is marked interrupted
