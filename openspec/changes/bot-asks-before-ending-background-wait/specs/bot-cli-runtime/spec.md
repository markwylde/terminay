## MODIFIED Requirements

### Requirement: Native execution termination confirms process cleanup

Every terminal path SHALL revoke tools and confirm supervised process cleanup before releasing credential/work leases. Stop SHALL allow ten seconds for cancellation, then terminate and kill remaining group processes after five seconds. PID/start-time/nonce checks SHALL protect unrelated reused groups. Restart SHALL interrupt unfinished work without replay. Success SHALL require a valid terminal protocol outcome and successful exit, except that an execution whose done answer has been accepted (`bot-background-wait`) does not depend on its exit status; failures SHALL retain bounded redacted diagnostics.

#### Scenario: CLI exits but a tool remains

- **WHEN** a CLI exits while a command in its supervised process group still runs
- **THEN** the group is cleaned up before the execution's lease is released

#### Scenario: Agent is ended after saying it is done

- **WHEN** an agent whose done answer was accepted does not exit and its process group is ended
- **THEN** the execution is completed, subject to the usual cleanup rules

#### Scenario: Server restarts

- **WHEN** the server restarts during a native execution
- **THEN** its group is cleaned up, pending permissions are cancelled, and the record becomes interrupted without resuming the CLI
